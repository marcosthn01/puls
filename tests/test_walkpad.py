"""Tests für die Walking-Pad-Schritte vom iPhone-Kurzbefehl."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))

import walkpad  # noqa: E402

TZ = ZoneInfo("Europe/Berlin")


def at(text):
    w = walkpad.parse_when(text, TZ)
    return w and w.strftime("%Y-%m-%d %H:%M")


def test_date_formats_from_iphone():
    assert at("2026-11-09T14:05:00+01:00") == "2026-11-09 14:05"
    assert at("2026-11-09T13:05:00Z") == "2026-11-09 14:05"
    assert at("2026-11-09 14:05") == "2026-11-09 14:05"
    assert at("09.11.26, 14:05") == "2026-11-09 14:05"
    assert at("9.11.2026 14:05:30") == "2026-11-09 14:05"
    assert at("9. Nov. 2026 um 14:05") == "2026-11-09 14:05"
    assert at("9. März 2026, 08:00") == "2026-03-09 08:00"
    assert at("Nov 9, 2026 at 2:05 PM") == "2026-11-09 14:05"
    assert at("Montag, 9. November 2026 um 14:05") == "2026-11-09 14:05"
    now = dt.datetime(2026, 11, 9, 20, 0, tzinfo=TZ)
    assert walkpad.parse_when("Gestern, 18:30", TZ, now).strftime("%Y-%m-%d %H:%M") == "2026-11-08 18:30"
    assert walkpad.parse_when("Heute um 07:15", TZ, now).strftime("%Y-%m-%d %H:%M") == "2026-11-09 07:15"
    assert at("gestern") is None
    assert at("31.02.26, 10:00") is None


def test_step_values():
    assert walkpad.parse_steps("4210") == 4210
    assert walkpad.parse_steps("4.210") == 4210
    assert walkpad.parse_steps("4 210 Schritte") == 4210
    assert walkpad.parse_steps("12,6") == 13
    assert walkpad.parse_steps(950.4) == 950
    assert walkpad.parse_steps("0") is None
    assert walkpad.parse_steps("viele") is None
    assert walkpad.parse_steps(True) is None


def test_parse_lines_and_json():
    text = "09.11.26, 14:00;09.11.26, 14:30;3.000\n\nkaputt\n2026-11-08T23:50:00+01:00|2026-11-09T00:20:00+01:00|900"
    rows = walkpad.parse_input(text, TZ)
    assert rows == [
        {"date": "2026-11-09", "s": 14 * 3600, "e": 14 * 3600 + 1800, "n": 3000},
        {"date": "2026-11-08", "s": 23 * 3600 + 3000, "e": 86400, "n": 900},  # über Mitternacht: gekappt
    ]
    js = '[{"start": "2026-11-09T10:00:00+01:00", "end": "2026-11-09T09:00:00+01:00", "value": 500}]'
    assert walkpad.parse_input(js, TZ) == [{"date": "2026-11-09", "s": 36000, "e": 36000, "n": 500}]
    assert walkpad.parse_input("", TZ) == []
    assert walkpad.parse_input(None, TZ) == []


def test_minute_samples_become_one_session():
    samples = [[14 * 3600 + 60 * k, 14 * 3600 + 60 * (k + 1), 100] for k in range(30)]
    samples.append([16 * 3600, 16 * 3600 + 600, 1000])
    assert walkpad.sessions(samples) == [[50400, 52200, 3000], [57600, 58200, 1000]]


def test_watch_steps_are_subtracted_per_session():
    store = {"days": {"2026-11-09": {"stepsDay": [0] * 56 + [600, 600, 600, 600] + [0] * 36}}}
    walkpad.merge(store, walkpad.parse_input("2026-11-09 14:00;2026-11-09 14:30;3000", TZ))
    walkpad.refresh(store, dt.date(2026, 11, 9), 14)
    pad = store["days"]["2026-11-09"]["pad"]
    assert pad["add"] == 3000 - 1200 and pad["total"] == 3000 and pad["min"] == 30
    # Uhr hat alles gezählt (Arme geschwungen): nichts hinzu
    store["days"]["2026-11-09"]["stepsDay"][56:58] = [2000, 2000]
    walkpad.refresh(store, dt.date(2026, 11, 9), 14)
    assert pad["add"] == 0


def test_without_watch_data_everything_counts_and_old_days_keep_their_value():
    store = {"days": {"2026-11-09": {}, "2026-10-01": {"pad": {"samples": [[0, 600, 700]], "add": 300, "total": 700}}}}
    walkpad.merge(store, walkpad.parse_input("2026-11-09 08:00;2026-11-09 08:20;2000", TZ))
    walkpad.refresh(store, dt.date(2026, 11, 9), 14)
    assert store["days"]["2026-11-09"]["pad"]["add"] == 2000
    assert store["days"]["2026-10-01"]["pad"]["add"] == 300


def test_merge_is_idempotent_and_adds_new_samples():
    store = {"days": {}}
    rows = walkpad.parse_input("2026-11-09 08:00;2026-11-09 08:20;2000", TZ)
    assert walkpad.merge(store, rows) == 1
    assert walkpad.merge(store, rows) == 0
    more = walkpad.parse_input("2026-11-09 08:00;2026-11-09 08:20;2000\n2026-11-09 12:00;2026-11-09 12:10;800", TZ)
    assert walkpad.merge(store, more) == 1
    assert len(store["days"]["2026-11-09"]["pad"]["samples"]) == 2
