"""Trainings als Kalender-Abo (ICS): jede Garmin-Aktivität als ganztägiges Ereignis.

So sieht man in Google Kalender (oder Apple Kalender) im Wochenüberblick, wann man trainiert hat –
„Push“, „Pull“, „Cardio · Rad“ … wie von Hand eingetragen.

Die Datei liegt unter einer geheimen Adresse: ``kal-<token>.ics``. Der Token ist ein HMAC aus dem
Daten-Passwort – nicht erratbar, und die App kann ihn selbst ausrechnen, um dir den Link zu zeigen.
Inhalt: nur Datum, Art und Dauer der Einheit, keine Puls- oder Gesundheitswerte.

Push/Pull: Garmin nennt Gym-Einheiten meist nur „Krafttraining“. Puls nimmt deine Markierungen aus der
App (``labels``) und ergänzt die übrigen im Wechsel Push → Pull → … – genau wie die App (training.js).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import re
from pathlib import Path
from typing import Any

SPLITS = {"push": "Push", "pull": "Pull", "legs": "Beine", "upper": "Oberkörper", "lower": "Unterkörper", "full": "Ganzkörper"}
TOKEN_MSG = b"puls-kalender-v1"
SKIP_TYPES = re.compile(r"walking|casual|breathwork|meditation")


def calendar_token(passphrase: str) -> str:
    return hmac.new(passphrase.encode("utf-8"), TOKEN_MSG, hashlib.sha256).hexdigest()[:24]


def activity_kind(a: dict[str, Any]) -> str:
    t = str(a.get("type") or "").lower()
    n = str(a.get("name") or "").lower()
    if re.search(r"strength|weight|krafttraining|fitness_equipment|hiit|functional|gym", t) or re.search(
        r"\b(push|pull|gym|kraft|beine|legs|oberkörper|unterkörper)\b", n
    ):
        return "gym"
    if re.search(r"cycl|bik|ride|spinning|gravel|mountain", t) or re.search(r"\b(rad|radtour|bike|spinning|rennrad|mtb)\b", n):
        return "bike"
    if re.search(r"run|lauf", t):
        return "run"
    return "other"


def split_of(a: dict[str, Any], labels: dict[str, str]) -> str | None:
    if a.get("id") is not None and labels.get(str(a["id"])) in SPLITS:
        return labels[str(a["id"])]
    n = str(a.get("name") or "").lower()
    if re.search(r"push|drück|brust|chest|schulter", n):
        return "push"
    if re.search(r"pull|zieh|rücken|back|bizeps", n):
        return "pull"
    if re.search(r"bein|leg|lower|unterkörper", n):
        return "legs"
    if re.search(r"oberkörper|upper", n):
        return "upper"
    if re.search(r"ganzkörper|full", n):
        return "full"
    return None


def merge_labels(old: Any, raw: Any) -> dict[str, str]:
    """Markierungen aus der App übernehmen (nur bekannte Splits, höchstens 1000 Einträge)."""
    out = {str(k): v for k, v in (old or {}).items() if v in SPLITS} if isinstance(old, dict) else {}
    try:
        new = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        new = None
    if isinstance(new, dict):
        for k, v in new.items():
            if v in SPLITS and re.fullmatch(r"\d{1,20}", str(k)):
                out[str(k)] = v
    return dict(list(out.items())[-1000:])


def sessions(store: dict, min_minutes: int = 10) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for date in sorted(store.get("days") or {}):
        for a in (store["days"][date] or {}).get("acts") or []:
            if (a.get("dur") or 0) >= min_minutes * 60:
                out.append((date, a))
    return out


def effective_splits(store: dict, labels: dict[str, str]) -> dict[str, str]:
    """Split je Gym-Einheit: bekannt aus Markierung/Name, sonst im Wechsel ergänzt (vor- und rückwärts)."""
    seq = [a for _, a in sessions(store) if activity_kind(a) == "gym" and a.get("id") is not None]
    split = [split_of(a, labels) for a in seq]
    kinds = {s for s in split if s}
    if "legs" in kinds:
        order = ["push", "pull", "legs"]
    elif kinds & {"upper", "lower"}:
        order = ["upper", "lower"]
    else:
        order = ["push", "pull"]

    def step(sp: str | None, d: int) -> str | None:
        return order[(order.index(sp) + d) % len(order)] if sp in order else None

    for k in range(1, len(seq)):
        if not split[k] and split[k - 1]:
            split[k] = step(split[k - 1], 1)
    for k in range(len(seq) - 2, -1, -1):
        if not split[k] and split[k + 1]:
            split[k] = step(split[k + 1], -1)
    return {str(a["id"]): s for a, s in zip(seq, split) if s}


def title_of(a: dict[str, Any], splits: dict[str, str]) -> str | None:
    kind = activity_kind(a)
    if kind == "gym":
        sp = splits.get(str(a.get("id")))
        return SPLITS[sp] if sp else "Gym"
    if kind == "bike":
        return "Cardio · Rad"
    if kind == "run":
        return "Cardio · Laufen"
    if SKIP_TYPES.search(str(a.get("type") or "").lower()):
        return None
    name = str(a.get("name") or a.get("type") or "Training").strip()
    return name[:40]


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """ICS-Zeilen höchstens 75 Bytes, Fortsetzung mit Leerzeichen (ohne UTF-8-Zeichen zu teilen)."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode("utf-8")) > (75 if not out else 74):
            out.append(cur)
            cur = ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n ".join(out)


def build_ics(store: dict, now: dt.datetime, days: int = 400) -> str:
    labels = store.get("labels") or {}
    splits = effective_splits(store, labels)
    since = (now.date() - dt.timedelta(days=days)).isoformat()
    stamp = now.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Puls//Training//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Puls Training",
        "X-WR-CALDESC:Deine Trainings aus Garmin – automatisch von Puls",
        "X-WR-TIMEZONE:Europe/Berlin",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for n, (date, a) in enumerate(sessions(store)):
        if date < since:
            continue
        title = title_of(a, splits)
        if not title:
            continue
        start = dt.date.fromisoformat(date)
        uid = f"puls-{a.get('id') or f'{date}-{n}'}@puls"
        minutes = round((a.get("dur") or 0) / 60)
        what = str(a.get("name") or "Training")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(start + dt.timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{_esc(title)}",
            f"DESCRIPTION:{_esc(f'{what} · {minutes} Min. – aus Garmin, eingetragen von Puls')}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


def write_calendar(store: dict, cache_dir: Path, passphrase: str, now: dt.datetime) -> Path:
    """Schreibt ``kal-<token>.ics`` in den Zwischenspeicher (alte Dateien mit anderem Token weg)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = f"kal-{calendar_token(passphrase)}.ics"
    for old in cache_dir.glob("kal-*.ics"):
        if old.name != name:
            old.unlink(missing_ok=True)
    path = cache_dir / name
    path.write_text(build_ics(store, now), encoding="utf-8", newline="")
    return path


# ---------------------------------------------------------------- Krank-Einträge aus deinem Kalender
#
# Wer „Krank“ in den Google Kalender schreibt, bringt Puls damit bei, wann Infekte waren. Gelesen wird
# die private iCal-Adresse (liegt verschlüsselt im Speicher); übernommen werden nur Termine, deren Titel
# nach Krankheit klingt – sonst nichts aus dem Kalender.

SICK = re.compile(r"krank|erk(ä|ae)lt|grippe|infekt|fieber|corona|covid|angeschlagen|\bsick\b", re.I)


def _ics_date(value: str) -> dt.date | None:
    m = re.match(r"\s*(\d{4})(\d{2})(\d{2})", value or "")
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def sick_episodes(text: str, today: dt.date, max_days: int = 730) -> list[dict[str, str]]:
    """Krank-Phasen aus einer iCal-Datei: [{s, e}] (ganztägige Enden sind exklusiv → einen Tag abziehen)."""
    unfolded = re.sub(r"\r?\n[ \t]", "", text or "")
    out: dict[str, str] = {}
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", unfolded, re.S):
        props: dict[str, tuple[str, str]] = {}
        for line in block.splitlines():
            if ":" not in line:
                continue
            head, value = line.split(":", 1)
            props.setdefault(head.split(";")[0].strip().upper(), (head.upper(), value.strip()))
        if not SICK.search(props.get("SUMMARY", ("", ""))[1]) or props.get("STATUS", ("", ""))[1].upper() == "CANCELLED":
            continue
        head, raw_start = props.get("DTSTART", ("", ""))
        start = _ics_date(raw_start)
        if not start or start > today or start < today - dt.timedelta(days=max_days):
            continue
        all_day = "VALUE=DATE" in head or len(raw_start) == 8
        end = _ics_date(props.get("DTEND", ("", ""))[1]) or start
        if all_day and end > start:
            end -= dt.timedelta(days=1)
        end = max(start, end)
        key = start.isoformat()
        out[key] = max(out.get(key, key), end.isoformat())
    return [{"s": s, "e": e} for s, e in sorted(out.items())][-200:]


def fetch_ics(url: str, timeout: float = 20) -> str:
    """iCal-Datei laden (nur https). Fehlertexte enthalten die Adresse nicht."""
    import urllib.request

    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("keine https-Adresse")
    req = urllib.request.Request(url, headers={"User-Agent": "Puls/1.0 (Kalender-Abgleich)"})
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 – nur https, Adresse vom Nutzer
        return res.read(5_000_000).decode("utf-8", "replace")
