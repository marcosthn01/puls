"""Verdichtet die Garmin-Antworten auf das, was die App braucht.

Alle Funktionen hier sind rein (kein Netzwerk) und werden in tests/test_garmin_data.py
mit Beispielantworten geprüft. Fehlt ein Feld, wird es einfach weggelassen.

Zeitangaben für den Schlaf sind Minuten relativ zu Mitternacht des Aufwachtags:
-48 = 23:12 am Vorabend, 418 = 06:58.
"""

from __future__ import annotations

import datetime as dt
import statistics
from typing import Any
from zoneinfo import ZoneInfo

HR_BIN_START = 30
HR_BIN_WIDTH = 5
HR_BINS = 39  # 30 … 224 bpm
SERIES_STEP_MIN = 10
MAX_GAP_MS = 5 * 60 * 1000

SLEEP_LEVELS = {0: 0, 1: 1, 2: 2, 3: 3}  # 0 Tief, 1 Leicht, 2 REM, 3 Wach


def num(value: Any) -> float | int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value:  # NaN
            return None
        return value
    return None


def rnd(value: Any, digits: int = 1) -> float | int | None:
    v = num(value)
    if v is None:
        return None
    return int(round(v)) if digits == 0 else round(float(v), digits)


def compact(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v != [] and v != {}}


def local_dt(ms: float, tz: ZoneInfo) -> dt.datetime:
    return dt.datetime.fromtimestamp(ms / 1000, tz)


def minutes_rel(local: dt.datetime, day: dt.date) -> int:
    """Minuten zwischen Mitternacht von ``day`` und ``local`` (Wanduhrzeit)."""
    wall = local.replace(tzinfo=None)
    return round((wall - dt.datetime.combine(day, dt.time())).total_seconds() / 60)


def parse_gmt(text: str) -> dt.datetime | None:
    """'2026-11-08T22:10:00.0' -> UTC-datetime."""
    if not isinstance(text, str) or len(text) < 19:
        return None
    try:
        return dt.datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=dt.timezone.utc
        )
    except ValueError:
        return None


def _find_skin_temp(*sources: dict[str, Any]) -> float | None:
    for src in sources:
        if not isinstance(src, dict):
            continue
        for key, value in src.items():
            k = key.lower()
            if "skintemp" in k and ("deviation" in k or "delta" in k) and num(value) is not None:
                v = float(value)
                if -5 < v < 5:
                    return round(v, 2)
    return None


def normalize_sleep(
    raw: dict[str, Any] | None, day: dt.date, tz: ZoneInfo, keep_levels: bool
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    dto = raw.get("dailySleepDTO") or {}
    duration = num(dto.get("sleepTimeSeconds"))
    if not duration or duration < 30 * 60:
        return None

    out: dict[str, Any] = {"dur": int(duration)}
    start_ms = num(dto.get("sleepStartTimestampGMT"))
    end_ms = num(dto.get("sleepEndTimestampGMT"))
    if start_ms and end_ms and end_ms > start_ms:
        out["bed"] = minutes_rel(local_dt(start_ms, tz), day)
        out["wake"] = minutes_rel(local_dt(end_ms, tz), day)

    for key, src in (
        ("deep", "deepSleepSeconds"),
        ("light", "lightSleepSeconds"),
        ("rem", "remSleepSeconds"),
        ("awake", "awakeSleepSeconds"),
        ("nap", "napTimeSeconds"),
    ):
        v = num(dto.get(src))
        if v is not None:
            out[key] = int(v)

    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall") if isinstance(scores, dict) else None
    if isinstance(overall, dict):
        out["score"] = rnd(overall.get("value"), 0)

    out["awakeCount"] = rnd(dto.get("awakeCount"), 0)
    out["stress"] = rnd(dto.get("avgSleepStress"))
    out["resp"] = rnd(dto.get("averageRespirationValue"))
    out["spo2"] = rnd(dto.get("averageSpO2Value") or dto.get("avgSpO2"))
    out["rhr"] = rnd(raw.get("restingHeartRate"), 0)
    out["hrv"] = rnd(raw.get("avgOvernightHrv") or dto.get("avgSleepHRV"))
    out["bb"] = rnd(raw.get("bodyBatteryChange"), 0)
    out["skinTemp"] = _find_skin_temp(dto, raw)

    need = dto.get("sleepNeed")
    if isinstance(need, dict):
        out["need"] = rnd(need.get("baseline"), 0)
        out["needActual"] = rnd(need.get("actual"), 0)

    if keep_levels and start_ms:
        levels = []
        for item in raw.get("sleepLevels") or []:
            if not isinstance(item, dict):
                continue
            s, e = parse_gmt(item.get("startGMT")), parse_gmt(item.get("endGMT"))
            level = num(item.get("activityLevel"))
            if not s or not e or level is None or int(level) not in SLEEP_LEVELS:
                continue
            s_min = round((s.timestamp() * 1000 - start_ms) / 60000)
            e_min = round((e.timestamp() * 1000 - start_ms) / 60000)
            if e_min > s_min:
                levels.append([s_min, e_min, SLEEP_LEVELS[int(level)]])
        out["levels"] = levels

    return compact(out)


def normalize_hrv(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    summary = raw.get("hrvSummary") or {}
    avg = num(summary.get("lastNightAvg"))
    if not avg:
        return None
    baseline = summary.get("baseline") or {}
    return compact(
        {
            "avg": rnd(avg),
            "weekly": rnd(summary.get("weeklyAvg")),
            "peak": rnd(summary.get("lastNight5MinHigh")),
            "status": summary.get("status") if isinstance(summary.get("status"), str) else None,
            "low": rnd(baseline.get("balancedLow")),
            "high": rnd(baseline.get("balancedUpper")),
        }
    )


STATS_FIELDS = {
    "steps": ("totalSteps", 0),
    "stepGoal": ("dailyStepGoal", 0),
    "dist": ("totalDistanceMeters", 0),
    "kcal": ("totalKilocalories", 0),
    "activeKcal": ("activeKilocalories", 0),
    "floors": ("floorsAscended", 0),
    "imMod": ("moderateIntensityMinutes", 0),
    "imVig": ("vigorousIntensityMinutes", 0),
    "stress": ("averageStressLevel", 0),
    "stressMax": ("maxStressLevel", 0),
    "stressHigh": ("highStressDuration", 0),
    "stressMed": ("mediumStressDuration", 0),
    "stressLow": ("lowStressDuration", 0),
    "stressRest": ("restStressDuration", 0),
    "bbHigh": ("bodyBatteryHighestValue", 0),
    "bbLow": ("bodyBatteryLowestValue", 0),
    "bbNow": ("bodyBatteryMostRecentValue", 0),
    "bbWake": ("bodyBatteryAtWakeTime", 0),
    "bbCharged": ("bodyBatteryChargedValue", 0),
    "bbDrained": ("bodyBatteryDrainedValue", 0),
    "rhr": ("restingHeartRate", 0),
    "hrMin": ("minHeartRate", 0),
    "hrMax": ("maxHeartRate", 0),
    "respAwake": ("avgWakingRespirationValue", 1),
    "spo2": ("averageSpo2", 0),
}


def normalize_stats(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out = {}
    for key, (src, digits) in STATS_FIELDS.items():
        v = rnd(raw.get(src), digits)
        if v is not None and not (key.startswith("stress") and v < 0):
            out[key] = v
    return out or None


def normalize_heart(
    raw: dict[str, Any] | None, day: dt.date, tz: ZoneInfo, keep_series: bool
) -> dict[str, Any] | None:
    """Tagespuls als Histogramm (Minuten je 5-bpm-Bereich) und optional als 10-Minuten-Kurve.

    Das Histogramm reicht, um die Belastung (TRIMP) mit beliebigem Max-Puls zu berechnen.
    """
    if not isinstance(raw, dict):
        return None
    points = []
    for item in raw.get("heartRateValues") or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        ts, bpm = num(item[0]), num(item[1])
        if ts and bpm and 25 < bpm < 240:
            points.append((float(ts), float(bpm)))
    if len(points) < 10:
        return None
    points.sort()

    gaps = [b[0] - a[0] for a, b in zip(points, points[1:]) if b[0] > a[0]]
    typical = statistics.median(gaps) if gaps else 120_000
    typical = min(max(typical, 15_000), MAX_GAP_MS)

    hist = [0.0] * HR_BINS
    for i, (ts, bpm) in enumerate(points):
        gap = points[i + 1][0] - ts if i + 1 < len(points) else typical
        if gap <= 0 or gap > MAX_GAP_MS:  # Uhr nicht getragen: nicht hochrechnen
            gap = typical
        idx = min(max(int((bpm - HR_BIN_START) // HR_BIN_WIDTH), 0), HR_BINS - 1)
        hist[idx] += gap / 60_000

    out: dict[str, Any] = {
        "hist": [round(m, 1) for m in hist],
        "max": rnd(raw.get("maxHeartRate"), 0),
        "min": rnd(raw.get("minHeartRate"), 0),
        "rhr": rnd(raw.get("restingHeartRate"), 0),
    }

    if keep_series:
        buckets: dict[int, list[float]] = {}
        for ts, bpm in points:
            local = local_dt(ts, tz)
            if local.date() != day:
                continue
            minute = local.hour * 60 + local.minute
            buckets.setdefault(minute // SERIES_STEP_MIN, []).append(bpm)
        out["series"] = [
            [b * SERIES_STEP_MIN, round(sum(v) / len(v))] for b, v in sorted(buckets.items())
        ]
    return compact(out)


def _bucket_series(points: list[tuple[float, float]], day: dt.date, tz: ZoneInfo) -> list[list[int]]:
    buckets: dict[int, list[float]] = {}
    for ts, value in points:
        local = local_dt(ts, tz)
        if local.date() != day:
            continue
        buckets.setdefault((local.hour * 60 + local.minute) // SERIES_STEP_MIN, []).append(value)
    return [[b * SERIES_STEP_MIN, round(sum(v) / len(v))] for b, v in sorted(buckets.items())]


def normalize_stress(raw: dict[str, Any] | None, day: dt.date, tz: ZoneInfo) -> dict[str, Any] | None:
    """Stress (0–100) und Body Battery (0–100) im Tagesverlauf, als 10-Minuten-Werte."""
    if not isinstance(raw, dict):
        return None
    stress = []
    for item in raw.get("stressValuesArray") or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            ts, val = num(item[0]), num(item[1])
            if ts and val is not None and 0 <= val <= 100:  # -1/-2 = nicht messbar
                stress.append((float(ts), float(val)))
    battery = []
    for item in raw.get("bodyBatteryValuesArray") or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            ts = num(item[0])
            level = num(item[2]) if len(item) >= 3 and num(item[2]) is not None else num(item[1])
            if ts and level is not None and 0 <= level <= 100:
                battery.append((float(ts), float(level)))
    return compact({"stress": _bucket_series(stress, day, tz), "bb": _bucket_series(battery, day, tz)}) or None


def normalize_steps(raw: Any, day: dt.date, tz: ZoneInfo) -> list[int] | None:
    """Schritte je 15 Minuten (96 Werte, Ortszeit) – zum Abgleich mit dem Walking-Pad."""
    if not isinstance(raw, list):
        return None
    slots = [0] * 96
    seen = False
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = parse_gmt(item.get("startGMT"))
        steps = num(item.get("steps"))
        if start is None or steps is None:
            continue
        local = start.astimezone(tz)
        if local.date() != day:
            continue
        seen = True
        slots[(local.hour * 60 + local.minute) // 15] += int(steps)
    return slots if seen else None


def _exercises(raw: Any) -> list[dict[str, Any]] | None:
    """Übungen einer Kraft-Einheit (Garmin erkennt sie am Handgelenk): Kategorie, Sätze, Wiederholungen."""
    if not isinstance(raw, list):
        return None
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        cat = item.get("category")
        if not isinstance(cat, str) or not cat:
            continue
        ex = compact({"c": cat[:40], "s": rnd(item.get("sets"), 0), "r": rnd(item.get("reps"), 0)})
        if ex.get("s") or ex.get("r"):
            out.append(ex)
    return out[:20] or None


def normalize_activity(raw: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    start = raw.get("startTimeLocal")
    if not isinstance(start, str) or len(start) < 16:
        return None
    activity_type = raw.get("activityType") or {}
    if not isinstance(activity_type, dict):
        activity_type = {}
    zones = [rnd(raw.get(f"hrTimeInZone_{i}"), 0) for i in range(1, 6)]

    def first(*keys: str, digits: int = 0) -> float | int | None:
        for k in keys:
            v = rnd(raw.get(k), digits)
            if v is not None:
                return v
        return None

    act = compact(
        {
            "id": raw.get("activityId"),
            "name": raw.get("activityName") if isinstance(raw.get("activityName"), str) else None,
            # Sportart genau so, wie auf der Uhr gewählt (z. B. indoor_cycling) + übergeordnete Art
            "type": activity_type.get("typeKey"),
            "ptype": num(activity_type.get("parentTypeId")),
            "start": start[11:16],
            "dur": rnd(raw.get("duration"), 0),
            "moving": rnd(raw.get("movingDuration"), 0),
            "dist": rnd(raw.get("distance"), 0),
            "spd": rnd(raw.get("averageSpeed"), 2),
            "maxSpd": rnd(raw.get("maxSpeed"), 2),
            "elev": rnd(raw.get("elevationGain"), 0),
            "elevDn": rnd(raw.get("elevationLoss"), 0),
            "avgHr": rnd(raw.get("averageHR"), 0),
            "maxHr": rnd(raw.get("maxHR"), 0),
            "kcal": rnd(raw.get("calories"), 0),
            # Leistung und Trittfrequenz (Rad: U/min, Laufen: Schritte/min)
            "pwr": rnd(raw.get("avgPower"), 0),
            "maxPwr": rnd(raw.get("maxPower"), 0),
            "np": rnd(raw.get("normPower"), 0),
            "cad": first("averageBikingCadenceInRevPerMinute", "averageRunningCadenceInStepsPerMinute", "averageSwimCadenceInStrokesPerMinute"),
            "maxCad": first("maxBikingCadenceInRevPerMinute", "maxRunningCadenceInStepsPerMinute"),
            "steps": rnd(raw.get("steps"), 0),
            # Kraft: Sätze, Wiederholungen, von der Uhr erkannte Übungen
            "sets": first("activeSets", "totalSets"),
            "reps": rnd(raw.get("totalReps"), 0),
            "ex": _exercises(raw.get("summarizedExerciseSets")),
            # Schwimmen
            "lengths": rnd(raw.get("activeLengths"), 0),
            "swolf": rnd(raw.get("avgSwolf"), 0),
            "resp": rnd(raw.get("avgRespirationRate")),
            "load": rnd(raw.get("activityTrainingLoad"), 0),
            "te": rnd(raw.get("aerobicTrainingEffect")),
            "ate": rnd(raw.get("anaerobicTrainingEffect")),
            "zones": zones if any(z for z in zones) else None,
        }
    )
    if not act.get("dur"):
        return None
    return start[:10], act


def _weight_kg(value: Any) -> float | None:
    """Garmin speichert das Gewicht in Gramm."""
    v = num(value)
    if v is None or v <= 0:
        return None
    kg = v / 1000 if v > 500 else v
    return round(kg, 1) if 30 <= kg <= 300 else None


def normalize_profile(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    user = raw.get("userData") or {}
    sleep = raw.get("userSleep") or {}
    gender = user.get("gender")
    birth = user.get("birthDate")
    birth_year = None
    if isinstance(birth, str) and len(birth) >= 4 and birth[:4].isdigit():
        birth_year = int(birth[:4])
    return compact(
        {
            "sex": {"MALE": "male", "FEMALE": "female"}.get(gender) if isinstance(gender, str) else None,
            "birthYear": birth_year,
            "vo2max": rnd(user.get("vo2MaxRunning"), 0),
            "weight": _weight_kg(user.get("weight")),
            "height": rnd(user.get("height"), 0) if (num(user.get("height")) or 0) > 100 else None,
            "lthr": rnd(user.get("lactateThresholdHeartRate"), 0),
            "sleepTime": rnd(sleep.get("sleepTime"), 0),
            "wakeTime": rnd(sleep.get("wakeTime"), 0),
        }
    )


def build_day(
    *,
    day: dt.date,
    tz: ZoneInfo,
    detail: bool,
    sleep: dict[str, Any] | None,
    hrv: dict[str, Any] | None,
    stats: dict[str, Any] | None,
    heart: dict[str, Any] | None,
) -> dict[str, Any]:
    record = compact(
        {
            "sleep": normalize_sleep(sleep, day, tz, keep_levels=detail),
            "hrv": normalize_hrv(hrv),
            "stats": normalize_stats(stats),
            "hr": normalize_heart(heart, day, tz, keep_series=detail),
        }
    )
    return record


def strip_details(record: dict[str, Any]) -> dict[str, Any]:
    """Für ältere Tage nur noch Zusammenfassungen behalten (hält die Datei klein)."""
    out = dict(record)
    if isinstance(out.get("sleep"), dict) and "levels" in out["sleep"]:
        out["sleep"] = {k: v for k, v in out["sleep"].items() if k != "levels"}
    if isinstance(out.get("hr"), dict) and "series" in out["hr"]:
        out["hr"] = {k: v for k, v in out["hr"].items() if k != "series"}
    out.pop("stressDay", None)
    out.pop("stepsDay", None)
    return out
