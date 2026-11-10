"""Walking-Pad-Schritte (z. B. PitPat → Apple Health → iPhone-Kurzbefehl) in die Daten übernehmen.

Der Kurzbefehl schickt die Schritt-Einträge von PitPat aus Apple Health als Text, eine Zeile pro
Eintrag: ``Start;Ende;Schritte``. Datumsformate: ISO 8601 oder die deutschen Standardformate des
iPhones (``09.11.26, 14:05`` / ``9. Nov. 2026 um 14:05``).

Doppelt gezählt wird nichts: Für jede Walking-Pad-Einheit wird abgezogen, was die Uhr in derselben
Zeit schon gezählt hat (aus Garmins 15-Minuten-Schritten). Hinzu kommt nur der Rest.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any
from zoneinfo import ZoneInfo

SLOT_S = 15 * 60
SLOTS = 96
MERGE_GAP_S = 5 * 60
MAX_STEPS = 100_000

MONTHS = {
    "jan": 1, "feb": 2, "mär": 3, "mrz": 3, "mar": 3, "apr": 4, "mai": 5, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "dez": 12, "dec": 12,
}

_DE_NUM = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_DE_TEXT = re.compile(r"^(\d{1,2})\.\s*([A-Za-zÄäÖöÜü]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_EN_TEXT = re.compile(r"^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$")


def parse_when(text: Any, tz: ZoneInfo, now: dt.datetime | None = None) -> dt.datetime | None:
    """Zeitpunkt aus dem Kurzbefehl lesen. Ohne Zeitzone gilt die Zeitzone des Nutzers."""
    if not isinstance(text, str):
        return None
    t = text.replace(" ", " ").replace("\xa0", " ").strip()
    t = re.sub(r"\s+(um|at)\s+", " ", t)
    t = re.sub(r"\s*Uhr$", "", t).strip()
    t = re.sub(r"^(Mo|Di|Mi|Do|Fr|Sa|So|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[A-Za-z]*\.?,\s*", "", t)  # Wochentag
    if not t:
        return None
    when: dt.datetime | None = None
    rel = re.match(r"^(heute|gestern|today|yesterday),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$", t, re.I)
    if rel:
        base = (now or dt.datetime.now(tz)).date()
        if rel.group(1).lower() in ("gestern", "yesterday"):
            base -= dt.timedelta(days=1)
        when = _safe(base.year, base.month, base.day, int(rel.group(2)), int(rel.group(3)), int(rel.group(4) or 0))
    if when is None:
        try:
            when = dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
        except ValueError:
            pass
    if when is None and (m := _DE_NUM.match(t)):
        d, mo, y, h, mi, s = m.groups()
        year = int(y) + (2000 if len(y) == 2 else 0)
        when = _safe(year, int(mo), int(d), int(h), int(mi), int(s or 0))
    if when is None and (m := _DE_TEXT.match(t)):
        d, mon, y, h, mi, s = m.groups()
        mo = MONTHS.get(mon[:3].lower())
        when = _safe(int(y), mo, int(d), int(h), int(mi), int(s or 0)) if mo else None
    if when is None and (m := _EN_TEXT.match(t)):
        mon, d, y, h, mi, s, ampm = m.groups()
        mo = MONTHS.get(mon[:3].lower())
        hour = int(h)
        if ampm:
            hour = hour % 12 + (12 if ampm.lower() == "pm" else 0)
        when = _safe(int(y), mo, int(d), hour, int(mi), int(s or 0)) if mo else None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=tz)
    return when.astimezone(tz)


def _safe(*parts: Any) -> dt.datetime | None:
    try:
        return dt.datetime(*parts)
    except (TypeError, ValueError):
        return None


def parse_steps(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        n = float(value)
    elif isinstance(value, str):
        t = re.sub(r"[^\d.,'’  \xa0]", "", value).strip()
        t = re.sub(r"[  \xa0]", "", t)
        if not t:
            return None
        if re.fullmatch(r"\d{1,3}([.,'’]\d{3})+", t):
            t = re.sub(r"[.,'’]", "", t)
        else:
            t = t.replace(",", ".")
        try:
            n = float(t)
        except ValueError:
            return None
    else:
        return None
    n = round(n)
    return n if 0 < n <= MAX_STEPS else None


_DIST = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(km|m|meter|metern)\s*$", re.I)


def parse_km(value: Any) -> float | None:
    """Strecke mit Einheit („2,4 km“, „850 m“) in Kilometern; ohne Einheit ist es keine Strecke."""
    if not isinstance(value, str):
        return None
    m = _DIST.match(value.replace("\xa0", " "))
    if not m:
        return None
    x = float(m.group(1).replace(",", "."))
    km = x if m.group(2).lower() == "km" else x / 1000
    return km if 0 < km <= 60 else None


REF_SPEED = 5.0  # km/h: Garmins Tages-Schrittlänge stammt überwiegend aus normalem Gehen


def personal_stride(store: dict, today: dt.date, days: int = 30) -> float:
    """Schrittlänge in Metern: Garmins Tagesdistanz ÷ Tagesschritte der letzten Wochen
    (Garmin rechnet mit deiner Größe und Kalibrierung), sonst 41,5 % der Körpergröße."""
    steps = dist = 0.0
    for date, rec in (store.get("days") or {}).items():
        try:
            age = (today - dt.date.fromisoformat(date)).days
        except ValueError:
            continue
        st = (rec or {}).get("stats") or {}
        n, d = st.get("steps"), st.get("dist")
        if 0 <= age <= days and isinstance(n, (int, float)) and isinstance(d, (int, float)) and n >= 2000 and d > 0:
            steps += n
            dist += d
    if steps >= 20000:
        return min(0.95, max(0.5, dist / steps))
    height = ((store.get("profile") or {}).get("height")) or 0
    if isinstance(height, (int, float)) and 120 <= height <= 230:
        return min(0.95, max(0.5, height * 0.00415))
    return 0.72


def steps_from_km(km: float, minutes: float | None, stride: float) -> int:
    """Kilometer → Schritte. Langsamer gehen = kürzere Schritte (Schrittlänge ~ Tempo^0,5)."""
    s = stride
    if minutes and minutes > 0:
        speed = min(7.0, max(2.0, km / (minutes / 60)))
        s = stride * (speed / REF_SPEED) ** 0.5
    return int(round(km * 1000 / s))


def parse_input(text: Any, tz: ZoneInfo, stride: float = 0.72) -> list[dict[str, Any]]:
    """Text oder JSON vom Kurzbefehl -> Liste von Einträgen {date, s, e, n} (Sekunden ab Mitternacht).
    Der Wert ist eine Schrittzahl oder eine Strecke mit Einheit („2,4 km“) – die wird mit deiner
    Schrittlänge umgerechnet (PitPat zeigt nur Kilometer)."""
    if not isinstance(text, str) or not text.strip():
        return []
    rows: list[tuple[Any, Any, Any]] = []
    stripped = text.strip()
    if stripped[:1] in "[{":
        try:
            data = json.loads(stripped)
        except ValueError:
            data = None
        if isinstance(data, dict):
            data = data.get("samples") or data.get("walk") or []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    km = item.get("km")
                    value = f"{km} km" if isinstance(km, (int, float)) else item.get("steps", item.get("value"))
                    rows.append((item.get("start"), item.get("end"), value))
    blocks = [b.strip() for b in re.split(r"##|[;|\t]", stripped)]
    if not rows and len(blocks) == 3 and any("\n" in b for b in blocks):
        # Kurzbefehl ohne Schleife: alle Startzeiten ; alle Endzeiten ; alle Werte (je eine Zeile pro Eintrag)
        cols = [[x.strip() for x in re.split(r"[\r\n]+", b) if x.strip()] for b in blocks]
        rows = list(zip(*cols))
    if not rows:
        for line in re.split(r"[\r\n]+", text):
            parts = [p.strip() for p in re.split(r"[;|\t]", line)]
            if len(parts) >= 3:
                rows.append((parts[0], parts[1], parts[2]))
            elif len(parts) == 2:
                rows.append((parts[0], None, parts[1]))

    out = []
    for start_raw, end_raw, steps_raw in rows:
        start = parse_when(start_raw, tz)
        end = parse_when(end_raw, tz) if end_raw and start is not None else None
        if start is not None and (end is None or end < start):
            end = start
        km = parse_km(steps_raw)
        if km is not None and start is not None:
            minutes = (end - start).total_seconds() / 60 if end > start else None
            n = steps_from_km(km, minutes, stride)
            n = n if 0 < n <= MAX_STEPS else None
        elif isinstance(steps_raw, str) and _DIST.match(steps_raw.replace("\xa0", " ")):
            n = None  # Strecke, aber unplausibel: nicht als Schrittzahl lesen
        else:
            n = parse_steps(steps_raw)
        if start is None or end is None or n is None:
            continue
        day = start.date()
        midnight = dt.datetime.combine(day, dt.time(), tz)
        s = int((start - midnight).total_seconds())
        e = int(min((end - midnight).total_seconds(), 86400))
        out.append({"date": day.isoformat(), "s": s, "e": max(e, s), "n": n})
    return out


def merge(store: dict, samples: list[dict[str, Any]]) -> int:
    """Neue Einträge zu den Tagen hinzufügen (gleiche Start- und Endzeit = derselbe Eintrag)."""
    changed = 0
    by_day: dict[str, list[dict[str, Any]]] = {}
    for x in samples:
        by_day.setdefault(x["date"], []).append(x)
    for date, items in by_day.items():
        record = store["days"].setdefault(date, {})
        pad = dict(record.get("pad") or {})
        known = {(a[0], a[1]): a[2] for a in pad.get("samples") or [] if isinstance(a, list) and len(a) == 3}
        before = dict(known)
        for x in items:
            known[(x["s"], x["e"])] = x["n"]
        if known != before:
            changed += 1
        pad["samples"] = [[s, e, n] for (s, e), n in sorted(known.items())]
        record["pad"] = pad
    return changed


def sessions(samples: list[list[int]]) -> list[list[int]]:
    """Einträge, die zeitlich zusammenhängen, zu Einheiten zusammenfassen."""
    out: list[list[int]] = []
    for s, e, n in sorted(samples):
        if out and s <= out[-1][1] + MERGE_GAP_S:
            out[-1][1] = max(out[-1][1], e)
            out[-1][2] += n
        else:
            out.append([s, e, n])
    return out


def watch_steps(buckets: list[int], s: int, e: int) -> float:
    """Schritte, die die Uhr zwischen s und e gezählt hat (anteilig aus 15-Minuten-Werten)."""
    e = max(e, s + 60)
    total = 0.0
    for slot in range(max(0, s // SLOT_S), min(SLOTS, e // SLOT_S + 1)):
        lo, hi = slot * SLOT_S, (slot + 1) * SLOT_S
        overlap = min(hi, e) - max(lo, s)
        if overlap > 0 and slot < len(buckets):
            total += (buckets[slot] or 0) * overlap / SLOT_S
    return total


def refresh(store: dict, today: dt.date, detail_days: int) -> None:
    """Für jeden Tag mit Walking-Pad: Summe, Einheiten und den zusätzlichen Anteil berechnen."""
    for date, record in store["days"].items():
        pad = record.get("pad")
        if not isinstance(pad, dict) or not pad.get("samples"):
            continue
        units = sessions(pad["samples"])
        total = sum(u[2] for u in units)
        buckets = record.get("stepsDay")
        recent = (today - dt.date.fromisoformat(date)).days < detail_days
        if isinstance(buckets, list) or recent:
            b = buckets if isinstance(buckets, list) else []
            add = sum(max(0.0, n - watch_steps(b, s, e)) for s, e, n in units)
            pad["add"] = int(round(add))
        elif "add" not in pad or pad.get("total") != total:
            pad["add"] = total  # keine Vergleichsdaten mehr: Uhr hat vermutlich nichts gezählt
        pad["total"] = total
        pad["units"] = [[round(s / 60), round(e / 60), n] for s, e, n in units]
        pad["min"] = round(sum(max(e - s, 60) for s, e, _ in units) / 60)


def describe_format(text: Any) -> str:
    """Form der Eingabe fürs Log, ohne Werte: Ziffern werden zu 9 (hilft bei Formatproblemen)."""
    if not isinstance(text, str):
        return "-"
    sample = re.sub(r"\d", "9", text.strip()[:60]).replace("\n", " ⏎ ")
    return f"{len(text)} Zeichen, Muster: {sample}"
