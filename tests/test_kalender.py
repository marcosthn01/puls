"""Tests für den Trainingskalender (ICS-Abo mit Push/Pull/Cardio als ganztägige Ereignisse)."""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))

import kalender  # noqa: E402

TZ = ZoneInfo("Europe/Berlin")
NOW = dt.datetime(2026, 11, 10, 9, 0, tzinfo=TZ)


def gym(i, name="Krafttraining"):
    return {"id": i, "type": "strength_training", "name": name, "start": "18:30", "dur": 3900}


def store():
    return {
        "days": {
            "2026-11-02": {"acts": [gym(101)]},
            "2026-11-03": {"acts": [{"id": 102, "type": "road_biking", "name": "Köln Radfahren", "start": "17:00", "dur": 4500}]},
            "2026-11-04": {"acts": [gym(103)]},
            "2026-11-05": {"acts": [{"id": 104, "type": "walking", "name": "Spaziergang", "start": "12:00", "dur": 1800}]},
            "2026-11-06": {"acts": [gym(105)]},
            "2026-11-07": {"acts": [{"id": 106, "type": "indoor_cycling", "name": "Indoor Radfahren", "start": "08:00", "dur": 2700}]},
            "2026-11-09": {"acts": [gym(107), {"id": 108, "type": "strength_training", "name": "Kurz", "start": "20:00", "dur": 300}]},
        },
        "labels": {"105": "pull"},
    }


def test_token_wie_in_der_app():
    expected = hmac.new(b"mein-geheimes-passwort", b"puls-kalender-v1", hashlib.sha256).hexdigest()[:24]
    assert kalender.calendar_token("mein-geheimes-passwort") == expected
    assert len(expected) == 24


def test_arten():
    assert kalender.activity_kind({"type": "strength_training"}) == "gym"
    assert kalender.activity_kind({"type": "indoor_cycling"}) == "bike"
    assert kalender.activity_kind({"type": "road_biking"}) == "bike"
    assert kalender.activity_kind({"type": "other", "name": "Pull"}) == "gym"
    assert kalender.activity_kind({"type": "running"}) == "run"
    # Garmins Sportart schlägt den Namen: Indoor-Rad im Studio „Gym“ bleibt Rad
    assert kalender.activity_kind({"type": "indoor_cycling", "name": "Gym"}) == "bike"
    assert kalender.activity_kind({"type": "road_biking", "name": "Push"}) == "bike"
    assert kalender.activity_kind({"type": "fitness_equipment", "name": "Indoor-Rad"}) == "bike"
    assert kalender.activity_kind({"type": "fitness_equipment", "name": "Push"}) == "gym"


def test_push_pull_im_wechsel_ab_einer_markierung():
    s = store()
    splits = kalender.effective_splits(s, s["labels"])
    # 105 = Pull (markiert) → 103 Push, 101 Pull (rückwärts), 107 Push (vorwärts)
    assert splits == {"101": "pull", "103": "push", "105": "pull", "107": "push"}


def test_ohne_markierung_bleibt_es_gym():
    s = store()
    s["labels"] = {}
    assert kalender.effective_splits(s, {}) == {}
    ics = kalender.build_ics(s, NOW)
    assert "SUMMARY:Gym" in ics


def test_kalender_ganztaegig_ohne_gesundheitswerte():
    ics = kalender.build_ics(store(), NOW)
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n")
    assert ics.count("BEGIN:VEVENT") == 6  # Spaziergang und 5-Minuten-Einheit fehlen
    assert "DTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261107" in ics
    assert "SUMMARY:Pull" in ics and "SUMMARY:Push" in ics
    # Sportart genau wie auf der Uhr gewählt
    assert "SUMMARY:Cardio · Rennrad" in ics and "SUMMARY:Cardio · Indoor-Rad" in ics
    assert "UID:puls-105@puls" in ics
    assert "TRANSP:TRANSPARENT" in ics
    assert "Spaziergang" not in ics
    assert "avgHr" not in ics and "bpm" not in ics
    for line in ics.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75, line


def test_markierungen_uebernehmen():
    merged = kalender.merge_labels({"1": "push", "2": "quatsch"}, '{"3": "pull", "x": "push", "4": "nix"}')
    assert merged == {"1": "push", "3": "pull"}
    assert kalender.merge_labels(None, "kaputt") == {}


def test_datei_mit_token_und_alte_weg(tmp_path):
    (tmp_path / "kal-alt.ics").write_text("x")
    path = kalender.write_calendar(store(), tmp_path, "mein-geheimes-passwort", NOW)
    assert path.name == f"kal-{kalender.calendar_token('mein-geheimes-passwort')}.ics"
    assert not (tmp_path / "kal-alt.ics").exists()
    assert path.read_bytes().count(b"\r\n") > 10


ICS_SICK = """BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20260820\r
DTEND;VALUE=DATE:20260824\r
SUMMARY:Krank\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20260919\r
DTEND;VALUE=DATE:20260925\r
SUMMARY:Erkältung – zu\r
 hause\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20261003T080000Z\r
DTEND:20261003T090000Z\r
SUMMARY:Arzt wegen Fieber\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20261005\r
DTEND;VALUE=DATE:20261006\r
SUMMARY:Krank\r
STATUS:CANCELLED\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20261010\r
DTEND;VALUE=DATE:20261011\r
SUMMARY:Geburtstag Oma\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20270101\r
SUMMARY:Krank (Zukunft)\r
END:VEVENT\r
END:VCALENDAR\r
"""


def test_sick_episodes_from_ical():
    eps = kalender.sick_episodes(ICS_SICK, dt.date(2026, 11, 10))
    assert eps == [
        {"s": "2026-08-20", "e": "2026-08-23"},  # ganztägig: Ende exklusiv
        {"s": "2026-09-19", "e": "2026-09-24"},  # gefaltete Zeile, „Erkältung“
        {"s": "2026-10-03", "e": "2026-10-03"},  # Termin mit Uhrzeit, „Fieber“
    ]


def test_korrigierte_sportart_gilt_ueberall():
    # Garmin hat „Krafttraining“ gespeichert, du warst aber auf dem Indoor-Rad
    labels = kalender.merge_labels({"1": "push"}, '{"7": "sport:indoor_cycling", "8": "sport:DROP TABLE", "9": "sport:x"}')
    assert labels == {"1": "push", "7": "sport:indoor_cycling"}
    st = {"labels": labels, "days": {"2026-11-10": {"acts": [{"id": 7, "type": "strength_training", "name": "Krafttraining", "start": "15:31", "dur": 1974}]}}}
    assert kalender.apply_sport_labels(st) == 1
    a = st["days"]["2026-11-10"]["acts"][0]
    assert a["type"] == "indoor_cycling" and a["typeGarmin"] == "strength_training"
    assert kalender.activity_kind(a) == "bike" and kalender.title_of(a, {}) == "Cardio · Indoor-Rad"
    # zweimal anwenden ändert nichts; „wie Garmin“ nimmt die Korrektur zurück
    kalender.apply_sport_labels(st)
    assert a["typeGarmin"] == "strength_training"
    st["labels"] = kalender.merge_labels(st["labels"], '{"7": "sport:garmin"}')
    assert st["labels"] == {"1": "push"}
    kalender.apply_sport_labels(st)
    assert a["type"] == "strength_training" and "typeGarmin" not in a
