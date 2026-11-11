#!/usr/bin/env python3
"""Puls-Sync: holt deine Garmin-Daten, verdichtet sie und legt sie verschlüsselt ab.

Läuft automatisch in GitHub Actions (siehe .github/workflows/sync.yml).
Im Log stehen nie Gesundheitswerte oder Zugangsdaten – nur Anzahlen.

Lokal testen (Python 3.12+):
    pip install -r sync/requirements.txt
    DATA_PASSPHRASE=... GARMIN_EMAIL=... GARMIN_PASSWORD=... python sync/puls_sync.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

import crypto_box  # noqa: E402
from crypto_box import CryptoError, box_salt, check_passphrase, decrypt_json, encrypt_json, import_key, import_public, open_import  # noqa: E402
from garmin_auth import AuthProblem, MfaRequired, connect, save_tokens  # noqa: E402
from garmin_data import (  # noqa: E402
    normalize_activity,
    normalize_stress,
    normalize_heart,
    normalize_hrv,
    normalize_profile,
    normalize_sleep,
    normalize_stats,
    normalize_steps,
    strip_details,
)
import kalender  # noqa: E402
import walkpad  # noqa: E402

STORE_VERSION = 1
STORE_FILE = "data.enc.json"
DETAIL_DAYS = 14
MAX_DAYS = 730
REFRESH_DAYS = 3
REPAIR_WINDOW = 30
REPAIR_MAX = 15
HISTORY_CHUNK = 60  # ältere Tage je Lauf beim Nachladen des Verlaufs
HISTORY_EMPTY_STOP = 21  # so viele Tage ohne Uhr-Daten am Stück = Anfang erreicht
PAUSE_S = 0.35

FAILED = object()


def log(msg: str) -> None:
    print(msg, flush=True)


def event_inputs() -> dict[str, Any]:
    """Eingaben eines manuellen Starts direkt aus der Event-Datei lesen.

    So taucht der Garmin-Code nirgends in Umgebungsvariablen oder Log-Köpfen auf.
    """
    path = os.getenv("GITHUB_EVENT_PATH")
    if not path or not Path(path).exists():
        return {}
    try:
        return json.loads(Path(path).read_text()).get("inputs") or {}
    except (OSError, ValueError):
        return {}


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "ja"}


def load_store(cache_dir: Path, site_url: str | None, passphrase: str) -> tuple[dict, bytes | None]:
    """Bisherige Daten laden: erst Zwischenspeicher, dann die veröffentlichte Datei."""
    candidates: list[tuple[str, Callable[[], str | None]]] = [
        ("Zwischenspeicher", lambda: (cache_dir / STORE_FILE).read_text() if (cache_dir / STORE_FILE).exists() else None)
    ]
    if site_url:
        url = site_url.rstrip("/") + "/" + STORE_FILE + f"?t={int(time.time())}"

        def fetch() -> str | None:
            try:
                with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310 (eigene Seite)
                    return resp.read().decode("utf-8")
            except (urllib.error.URLError, TimeoutError, OSError):
                return None

        candidates.append(("Webseite", fetch))

    for label, read in candidates:
        text = read()
        if not text:
            continue
        try:
            box = json.loads(text)
            store = decrypt_json(box, passphrase)
        except (ValueError, CryptoError) as e:
            log(f"Bisherige Daten ({label}) nicht lesbar: {e}. Lade neu.")
            continue
        if isinstance(store, dict) and store.get("v") == STORE_VERSION:
            log(f"Bisherige Daten aus {label}: {len(store.get('days', {}))} Tage.")
            return store, box_salt(box)
    return {"v": STORE_VERSION, "days": {}}, None


def dates_to_fetch(store: dict, today: dt.date, backfill: int, full: bool) -> list[dt.date]:
    has_garmin = any(set(v) - {"pad"} for v in (store.get("days") or {}).values())
    if full or not has_garmin:
        return [today - dt.timedelta(days=i) for i in range(backfill - 1, -1, -1)]
    wanted = {today - dt.timedelta(days=i) for i in range(REFRESH_DAYS)}
    missing = [
        today - dt.timedelta(days=i)
        for i in range(REFRESH_DAYS, REPAIR_WINDOW)
        if (today - dt.timedelta(days=i)).isoformat() not in store["days"]
    ]
    wanted.update(missing[:REPAIR_MAX])
    return sorted(wanted)


def has_watch_data(record: dict | None) -> bool:
    """Hat die Uhr an dem Tag etwas gemessen (Schlaf, HRV, Schritte, Ruhepuls, Puls)?"""
    if not isinstance(record, dict):
        return False
    stats = record.get("stats") or {}
    return bool(record.get("sleep") or record.get("hrv") or record.get("hr") or (stats.get("steps") or 0) > 0 or stats.get("rhr"))


def history_batch(store: dict, today: dt.date, chunk: int) -> list[dt.date]:
    """Nächste ältere Tage für den Verlauf (neueste zuerst), bis der erste Tag deiner Uhr erreicht ist."""
    h = store.get("history") or {}
    if h.get("done"):
        return []
    if h.get("next"):
        start = dt.date.fromisoformat(h["next"])
    else:
        keys = sorted(k for k, v in (store.get("days") or {}).items() if has_watch_data(v))
        start = dt.date.fromisoformat(keys[0]) if keys else today
    limit = today - dt.timedelta(days=MAX_DAYS)
    out = []
    for i in range(1, max(1, chunk) + 1):
        day = start - dt.timedelta(days=i)
        if day <= limit:
            break
        out.append(day)
    return out


def advance_history(store: dict, day: dt.date, today: dt.date) -> None:
    """Fortschritt nach einem geholten Tag: nächster Starttag, Leerlauf-Zähler, Anfang erreicht?"""
    h = store.setdefault("history", {})
    if has_watch_data(store["days"].get(day.isoformat())):
        h["empty"] = 0
        h["first"] = day.isoformat()
    else:
        h["empty"] = int(h.get("empty") or 0) + 1
        store["days"].pop(day.isoformat(), None)
    h["next"] = day.isoformat()
    if h["empty"] >= HISTORY_EMPTY_STOP or day - dt.timedelta(days=1) <= today - dt.timedelta(days=MAX_DAYS):
        h["done"] = True


PROBE_DAYS = 120  # nach dem „Anfang“ noch so weit zurück stichprobenartig nachsehen (Lücken überbrücken)


def probe_older(fetch: Any, store: dict, today: dt.date) -> dt.date | None:
    """Gibt es vor der Lücke doch noch ältere Daten? Wöchentliche Stichproben + Aktivitäten-Liste."""
    h = store.get("history") or {}
    start = dt.date.fromisoformat(h.get("next") or today.isoformat())
    limit = today - dt.timedelta(days=MAX_DAYS)
    lo = max(limit + dt.timedelta(days=1), start - dt.timedelta(days=PROBE_DAYS))
    found: dt.date | None = None
    raw = fetch("get_activities_by_date", lo.isoformat(), (start - dt.timedelta(days=1)).isoformat())
    if isinstance(raw, list):
        for item in raw:
            parsed = normalize_activity(item)
            if parsed and (found is None or parsed[0] > found.isoformat()):
                found = dt.date.fromisoformat(parsed[0])
    day = start - dt.timedelta(days=7)
    while day >= lo:
        if found and day <= found:
            break
        probe = {}
        stats = fetch("get_stats", day.isoformat())
        if stats is not FAILED and (value := normalize_stats(stats)):
            probe["stats"] = value
        sleep = fetch("get_sleep_data", day.isoformat())
        if sleep is not FAILED and normalize_sleep(sleep, day, ZoneInfo(store.get("tz") or "Europe/Berlin"), keep_levels=False):
            probe["sleep"] = True
        if has_watch_data(probe):
            found = day
            break
        day -= dt.timedelta(days=7)
    return found


def set_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


class Fetcher:
    def __init__(self, api: Any, errors: Any, pause: float = PAUSE_S):
        self.api = api
        self.too_many = errors.GarminConnectTooManyRequestsError
        self.auth_error = errors.GarminConnectAuthenticationError
        self.pause = pause
        self.calls = 0
        self.failures = 0

    def __call__(self, name: str, *args: Any) -> Any:
        self.calls += 1
        try:
            return getattr(self.api, name)(*args)
        except (self.too_many, self.auth_error):
            raise
        except Exception as e:  # einzelne fehlende Tage sind normal
            self.failures += 1
            log(f"  {name}: keine Daten ({type(e).__name__})")
            return FAILED
        finally:
            if self.pause:
                time.sleep(self.pause)


def sync_days(fetch: Fetcher, store: dict, days: list[dt.date], today: dt.date, tz: ZoneInfo) -> int:
    updated = 0
    for day in days:
        key = day.isoformat()
        detail = (today - day).days < DETAIL_DAYS
        parts: dict[str, Callable[[Any], Any]] = {
            "sleep": lambda raw: normalize_sleep(raw, day, tz, keep_levels=detail),
            "hrv": normalize_hrv,
            "stats": normalize_stats,
            "hr": lambda raw: normalize_heart(raw, day, tz, keep_series=detail),
        }
        calls = {
            "sleep": "get_sleep_data",
            "hrv": "get_hrv_data",
            "stats": "get_stats",
            "hr": "get_heart_rates",
        }
        if detail:  # Verläufe (Stress, Body Battery, Schritte) nur für die letzten 14 Tage
            parts["stressDay"] = lambda raw: normalize_stress(raw, day, tz)
            calls["stressDay"] = "get_stress_data"
            parts["stepsDay"] = lambda raw: normalize_steps(raw, day, tz)
            calls["stepsDay"] = "get_steps_data"
        record = dict(store["days"].get(key) or {})
        for part, method in calls.items():
            raw = fetch(method, key)
            if raw is FAILED:
                continue  # alten Stand behalten
            value = parts[part](raw)
            if value:
                record[part] = value
            else:
                record.pop(part, None)
        if record:
            store["days"][key] = record
            updated += 1
    return updated


ACTS_VERSION = 2  # 2: Sportart + alle Messwerte (Leistung, Trittfrequenz, Sätze …) je Einheit


def refresh_all_activities(fetch: Fetcher, store: dict, today: dt.date) -> int | None:
    """Einmalig alle Einheiten seit dem ersten Tag neu holen, wenn Puls mehr Werte je Einheit speichert.

    Garmin liefert die Liste in einem Rutsch (eine Abfrage) – danach gilt store["actsV"]."""
    keys = sorted(k for k in store.get("days", {}) if _DATE.match(k))
    if not keys:
        store["actsV"] = ACTS_VERSION
        return 0
    first = dt.date.fromisoformat(keys[0])
    raw = fetch("get_activities_by_date", first.isoformat(), today.isoformat())
    if raw is FAILED or not isinstance(raw, list):
        return None
    days = [first + dt.timedelta(days=k) for k in range((today - first).days + 1)]
    n = _apply_activities(store, raw, days)
    store["actsV"] = ACTS_VERSION
    return n


def _apply_activities(store: dict, raw: list, days: list[dt.date]) -> int:
    grouped: dict[str, list[dict]] = {}
    for item in raw:
        parsed = normalize_activity(item)
        if parsed:
            date, act = parsed
            grouped.setdefault(date, []).append(act)
    for day in days:
        key = day.isoformat()
        acts = sorted(grouped.get(key, []), key=lambda a: a.get("start", ""))
        if acts:
            store["days"].setdefault(key, {})["acts"] = acts
        elif key in store["days"]:
            store["days"][key].pop("acts", None)
    return sum(len(v) for v in grouped.values())


def log_diagnosis(fetch: Fetcher, store: dict, today: dt.date, public_b64: str) -> None:
    """Fehlersuche: Garmins Rohangaben zu den Einheiten der letzten Tage – nur verschlüsselt für den
    übergebenen öffentlichen Schlüssel (X25519) ins Log, damit im öffentlichen Log nichts lesbar ist."""
    if not re.fullmatch(r"[A-Za-z0-9+/]{43}=", public_b64):
        log("Diagnose: Schlüssel ungültig.")
        return
    start = (today - dt.timedelta(days=3)).isoformat()
    raw = fetch("get_activities_by_date", start, today.isoformat())
    keep = ("activityId", "activityName", "startTimeLocal", "activityType", "eventType", "sportTypeId", "duration",
            "deviceId", "manufacturer", "parent", "favorite", "summarizedExerciseSets", "totalSets", "avgPower",
            "averageBikingCadenceInRevPerMinute", "distance")
    garmin = [{k: item.get(k) for k in keep if k in item} for item in raw] if isinstance(raw, list) else str(raw)
    stored = {d: (store.get("days", {}).get(d) or {}).get("acts") for d in sorted(store.get("days", {})) if d >= start}
    kinds = {d: [kalender.activity_kind(a) for a in (acts or [])] for d, acts in stored.items()}
    box = crypto_box.seal_import({"garmin": garmin, "stored": stored, "kinds": kinds, "labels": store.get("labels")}, public_b64)
    log("Diagnose (verschlüsselt): " + json.dumps(box))


def sync_activities(fetch: Fetcher, store: dict, days: list[dt.date]) -> int:
    start, end = min(days).isoformat(), max(days).isoformat()
    raw = fetch("get_activities_by_date", start, end)
    if raw is FAILED or not isinstance(raw, list):
        return 0
    return _apply_activities(store, raw, days)


_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_illness(data: Any) -> dict:
    """Nur bekannte Felder und Datumsangaben übernehmen (Infekte, Antworten „nicht krank“, Störfaktoren)."""
    if not isinstance(data, dict):
        raise ValueError("kein Objekt")
    pos = []
    for x in data.get("pos") or []:
        if isinstance(x, dict) and _DATE.match(str(x.get("s", ""))):
            item = {"s": x["s"], "src": str(x.get("src") or "user")[:12]}
            if _DATE.match(str(x.get("e", ""))):
                item["e"] = x["e"]
            pos.append(item)
    neg = sorted({str(x) for x in data.get("neg") or [] if _DATE.match(str(x))})
    conf = {}
    raw_conf = data.get("conf") if isinstance(data.get("conf"), dict) else {}
    for date in sorted(raw_conf)[-800:]:
        c = raw_conf[date]
        if not _DATE.match(str(date)) or not isinstance(c, dict):
            continue
        item = {}
        if isinstance(c.get("a"), (int, float)) and 0 < c["a"] <= 20:
            item["a"] = int(c["a"])
        if c.get("u"):
            item["u"] = 1
        if item:
            conf[date] = item
    return {"pos": pos[-200:], "neg": neg[-400:], "conf": conf}


def clean_cal(raw: Any) -> list[dict[str, str]]:
    """Kalender-Phasen [{s, e}] prüfen (nur Datumsangaben, höchstens 200)."""
    out = []
    for x in raw or []:
        if isinstance(x, dict) and _DATE.match(str(x.get("s", ""))):
            e = str(x.get("e", "")) if _DATE.match(str(x.get("e", ""))) and str(x.get("e")) >= x["s"] else x["s"]
            out.append({"s": x["s"], "e": e})
    return sorted(out, key=lambda x: x["s"])[-200:]


def clean_ics(raw: Any) -> str | None:
    """Private iCal-Adresse: nur https, ohne Leerzeichen; leer = entfernen."""
    url = str(raw or "").strip()
    if not url.startswith("https://") or len(url) > 600 or re.search(r"\s", url):
        return None
    return url


def prune(store: dict, today: dt.date) -> None:
    days = store["days"]
    for key in list(days):
        age = (today - dt.date.fromisoformat(key)).days
        if age > MAX_DAYS or not days[key]:
            del days[key]
        elif age >= DETAIL_DAYS:
            days[key] = strip_details(days[key])


def write_store(store: dict, cache_dir: Path, passphrase: str, salt: bytes | None, extra_out: Path | None) -> None:
    box = encrypt_json(store, passphrase, salt=salt)
    text = json.dumps(box, separators=(",", ":"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / STORE_FILE).write_text(text)
    if extra_out:
        extra_out.mkdir(parents=True, exist_ok=True)
        (extra_out / STORE_FILE).write_text(text)
    log(f"Gespeichert: {len(store['days'])} Tage, {len(text) // 1024} KB (verschlüsselt).")


def run(
    *,
    garmin_module: Any,
    cache_dir: Path,
    site_url: str | None,
    out_dir: Path | None,
    env: dict[str, str],
    inputs: dict[str, Any],
    now: dt.datetime | None = None,
    pause: float = PAUSE_S,
) -> int:
    try:
        passphrase = check_passphrase(env.get("DATA_PASSPHRASE"))
    except CryptoError as e:
        log(f"FEHLER: {e} Lege das Secret DATA_PASSPHRASE an (mind. 10 Zeichen).")
        return 2

    tz = ZoneInfo(env.get("PULS_TIMEZONE") or "Europe/Berlin")
    now = now or dt.datetime.now(tz)
    today = now.date()
    cache_dir.mkdir(parents=True, exist_ok=True)

    store, salt = load_store(cache_dir, site_url, passphrase)

    # Walking-Pad-Schritte vom iPhone-Kurzbefehl (werden auch gespeichert, wenn Garmin hakt)
    walk_raw = inputs.get("walk")
    if walk_raw:
        samples = walkpad.parse_input(str(walk_raw), tz, walkpad.personal_stride(store, today))
        changed = walkpad.merge(store, samples)
        log(f"Walking-Pad: {len(samples)} Einträge erkannt, {changed} Tag(e) aktualisiert.")
        if not samples and str(walk_raw).strip(" ;|#\n"):
            log(f"Walking-Pad: Format nicht erkannt ({walkpad.describe_format(str(walk_raw))}).")
    walkpad.refresh(store, today, DETAIL_DAYS)

    # Öffentlicher Import-Schlüssel (für Krank-Einträge aus dem Kalender, ohne dein Passwort zu kennen)
    ikey = import_key(store)
    (cache_dir / "import-key.json").write_text(json.dumps({"v": 1, "alg": "X25519-HKDF-SHA256-AES256GCM", "pub": import_public(ikey)}))
    log(f"Import-Schlüssel (öffentlich): {import_public(ikey)}")

    # Infekt-Lernen: deine Infekte, Antworten und Störfaktoren aus der App (verschlüsselt geschickt)
    if inputs.get("illness"):
        try:
            payload = decrypt_json(json.loads(str(inputs["illness"])), passphrase)
            old = store.get("illness") or {}
            new = clean_illness(payload)
            ics = clean_ics(payload.get("ics")) if "ics" in payload else old.get("ics")
            if ics:
                new["ics"] = ics
            if old.get("cal"):
                new["cal"] = old["cal"]
            store["illness"] = new
            log("Infekt-Lernen: Angaben aus der App übernommen.")
        except (CryptoError, ValueError, TypeError, AttributeError):
            log("Infekt-Lernen: Angaben nicht lesbar – übersprungen.")

    # Krank-Einträge aus deinem Kalender: verschlüsselt geschickt (Import) …
    if inputs.get("import"):
        try:
            data = open_import(json.loads(str(inputs["import"])), ikey)
            store.setdefault("illness", {})["cal"] = clean_cal(data.get("cal") if isinstance(data, dict) else None)
            log("Infekt-Lernen: Kalender-Einträge übernommen.")
        except (CryptoError, ValueError, TypeError, AttributeError):
            log("Import: nicht lesbar – übersprungen.")
    # … oder bei jedem Lauf direkt aus der privaten iCal-Adresse (in der App hinterlegt)
    ics_url = (store.get("illness") or {}).get("ics")
    if ics_url:
        try:
            store["illness"]["cal"] = kalender.sick_episodes(kalender.fetch_ics(ics_url), today)
            log("Kalender: Krank-Einträge abgeglichen.")
        except Exception as e:  # noqa: BLE001 – Netz/Format: letzter Stand bleibt
            log(f"Kalender: nicht lesbar ({type(e).__name__}) – letzter Stand bleibt.")

    # Push/Pull-Markierungen aus der App (für den Trainingskalender)
    if inputs.get("labels"):
        store["labels"] = kalender.merge_labels(store.get("labels"), inputs.get("labels"))

    try:
        api = connect(
            garmin_module.Garmin,
            cache_dir=cache_dir,
            passphrase=passphrase,
            email=env.get("GARMIN_EMAIL") or None,
            password=env.get("GARMIN_PASSWORD") or None,
            secret_tokens=env.get("GARMIN_TOKENS") or None,
            mfa_code=str(inputs.get("mfa_code") or "").strip() or None,
            manual_run=env.get("GITHUB_EVENT_NAME", "workflow_dispatch") != "schedule",
            errors=garmin_module,
        )
    except MfaRequired as e:
        log(f"AKTION NÖTIG: {e}")
        store.setdefault("status", {})["auth"] = "mfa"
        store["status"]["checked"] = now.isoformat(timespec="seconds")
        write_store(store, cache_dir, passphrase, salt, out_dir)
        return 3
    except AuthProblem as e:
        log(f"FEHLER: {e}")
        store.setdefault("status", {})["auth"] = "error"
        store["status"]["checked"] = now.isoformat(timespec="seconds")
        write_store(store, cache_dir, passphrase, salt, out_dir)
        return 1

    backfill = int(env.get("BACKFILL_DAYS") or 90)
    full = truthy(inputs.get("full_refresh"))
    days = dates_to_fetch(store, today, backfill, full)
    log(f"Hole {len(days)} Tag(e): {days[0]} bis {days[-1]}.")

    fetch = Fetcher(api, garmin_module, pause=pause)
    status = "ok"
    try:
        profile = fetch("get_user_profile")
        if profile is not FAILED:
            normalized = normalize_profile(profile)
            if normalized:
                store["profile"] = normalized
        updated = sync_days(fetch, store, days, today, tz)
        n_acts = sync_activities(fetch, store, days)
        log(f"Aktualisiert: {updated} Tage, {n_acts} Aktivitäten, {fetch.calls} Abfragen.")
        if store.get("actsV") != ACTS_VERSION:
            n_all = refresh_all_activities(fetch, store, today)
            log("Einheiten: alle Messwerte je Sportart neu geholt." if n_all is not None else "Einheiten: Neuabruf klappt beim nächsten Mal.")
        if inputs.get("diag"):
            log_diagnosis(fetch, store, today, str(inputs["diag"]).strip())
    except garmin_module.GarminConnectTooManyRequestsError:
        log("WARNUNG: Garmin bremst gerade (zu viele Anfragen). Gespeichert wird, was schon da ist.")
        status = "partial"
    except garmin_module.GarminConnectAuthenticationError:
        log("WARNUNG: Garmin hat die Anmeldung während des Abrufs abgelehnt.")
        status = "partial"

    # Verlauf nachladen: ältere Tage in Etappen, bis der erste Tag deiner Uhr erreicht ist
    want_history = str(inputs.get("history") or "").strip().lower()
    if status == "ok" and want_history and want_history not in ("0", "false", "nein"):
        chunk = int(want_history) if want_history.isdigit() else HISTORY_CHUNK
        batch = history_batch(store, today, min(chunk, 120))
        done_days: list[dt.date] = []
        try:
            for day in batch:
                sync_days(fetch, store, [day], today, tz)
                advance_history(store, day, today)
                done_days.append(day)
                if store["history"].get("done"):
                    break
            if done_days:
                sync_activities(fetch, store, done_days)
        except garmin_module.GarminConnectTooManyRequestsError:
            log("Verlauf: Garmin bremst – geht beim nächsten Mal weiter, wo es aufgehört hat.")
            status = "partial"
        h = store.get("history") or {}
        # „Anfang“ erreicht? Einmal weiter zurück nachsehen, ob vor einer Lücke noch ältere Daten liegen
        if h.get("done") and not h.get("probed") and status == "ok":
            try:
                older = probe_older(fetch, store, today)
                h["probed"] = True
                if older:
                    h.update({"done": False, "empty": 0, "next": (older + dt.timedelta(days=1)).isoformat()})
                    log(f"Verlauf: vor einer Lücke gibt es ältere Daten (um {older.isoformat()}) – es geht dort weiter.")
                    done_days = done_days or [older]
                store["history"] = h
            except garmin_module.GarminConnectTooManyRequestsError:
                status = "partial"
        if h.get("done"):
            log(f"Verlauf vollständig: deine Daten reichen zurück bis {h.get('first') or '–'} (davor bis {PROBE_DAYS} Tage stichprobenartig geprüft).")
        elif done_days:
            log(f"Verlauf: ältere Tage bis {h.get('next')} geladen – es geht weiter.")
        set_output("history_more", "true" if not h.get("done") and status == "ok" and done_days else "false")

    save_tokens(api, cache_dir, passphrase)
    walkpad.refresh(store, today, DETAIL_DAYS)
    prune(store, today)
    store["v"] = STORE_VERSION
    store["tz"] = str(tz)
    store["generated"] = now.isoformat(timespec="seconds")
    store["status"] = {"auth": "ok", "sync": status, "checked": store["generated"]}
    write_store(store, cache_dir, passphrase, salt, out_dir)
    try:
        kalender.write_calendar(store, cache_dir, passphrase, now)
        log("Trainingskalender aktualisiert.")
    except Exception as e:  # der Kalender darf den Abruf nie stören
        log(f"Trainingskalender nicht geschrieben ({type(e).__name__}).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", default=".puls-cache", help="Ordner für Zwischenspeicher")
    parser.add_argument("--site-url", default=os.getenv("PULS_SITE_URL"), help="URL der App (Fallback für alte Daten)")
    parser.add_argument("--out", default=None, help="Zusätzlich hierhin schreiben (z. B. _site)")
    args = parser.parse_args(argv)

    import garminconnect  # erst hier, damit die Tests ohne Netzwerk laufen

    return run(
        garmin_module=garminconnect,
        cache_dir=Path(args.cache),
        site_url=args.site_url or None,
        out_dir=Path(args.out) if args.out else None,
        env=dict(os.environ),
        inputs=event_inputs(),
    )


if __name__ == "__main__":
    sys.exit(main())
