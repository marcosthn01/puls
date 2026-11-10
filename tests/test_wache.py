"""Tests für die Morgenwache (wartet morgens auf die neue Nacht bei Garmin)."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))

import wache  # noqa: E402

TZ = ZoneInfo("Europe/Berlin")
DAY = dt.date(2026, 11, 10)


class Clock:
    """Uhr zum Vorspulen: ``sleep`` rückt die Zeit weiter statt zu warten."""

    def __init__(self, hour: int, minute: int = 0):
        self.t = dt.datetime(2026, 11, 10, hour, minute, tzinfo=TZ)
        self.slept = 0.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept += s
        self.t += dt.timedelta(seconds=s)

    def elapsed(self):
        return self.slept


def sleep_raw(minutes: int | None):
    return {"dailySleepDTO": {"sleepTimeSeconds": None if minutes is None else minutes * 60}}


def test_fenster():
    assert not wache.in_window(dt.datetime(2026, 11, 10, 3, 59, tzinfo=TZ))
    assert wache.in_window(dt.datetime(2026, 11, 10, 4, 0, tzinfo=TZ))
    assert wache.in_window(dt.datetime(2026, 11, 10, 12, 29, tzinfo=TZ))
    assert not wache.in_window(dt.datetime(2026, 11, 10, 12, 30, tzinfo=TZ))


def test_nacht_erkannt():
    assert not wache.night_ready(None, DAY, TZ)
    assert not wache.night_ready(sleep_raw(None), DAY, TZ)
    assert not wache.night_ready(sleep_raw(20), DAY, TZ)  # kurzer Nickerchen-Schnipsel zählt nicht
    assert wache.night_ready(sleep_raw(7 * 60), DAY, TZ)


def test_findet_die_nacht_nach_einigen_pruefungen():
    clock = Clock(6, 30)
    answers = iter([False, False, True])
    result = wache.watch(lambda: next(answers), clock.now, clock.sleep, clock.elapsed, interval=180)
    assert result == "found"
    assert clock.slept == 360  # zweimal gewartet, beim dritten Mal da


def test_garmin_fehler_bricht_nicht_ab():
    clock = Clock(7)
    calls = {"n": 0}

    def check():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("weg")
        return True

    assert wache.watch(check, clock.now, clock.sleep, clock.elapsed) == "found"


def test_endet_mit_dem_fenster():
    clock = Clock(12, 20)
    assert wache.watch(lambda: False, clock.now, clock.sleep, clock.elapsed, interval=180) == "window"
    assert clock.now().hour == 12 and clock.now().minute >= 30


def test_uebergabe_vor_dem_zeitlimit():
    clock = Clock(4)
    result = wache.watch(lambda: False, clock.now, clock.sleep, clock.elapsed, interval=180, budget=3600)
    assert result == "budget"
    assert 3600 <= clock.slept <= 3600 + 180


def test_ohne_fenster_nichts_zu_tun(monkeypatch, tmp_path, capsys):
    out = tmp_path / "out.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))

    class Late(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime(2026, 11, 10, 15, 0, tzinfo=tz)

    monkeypatch.setattr(wache.dt, "datetime", Late)
    assert wache.main(["--cache", str(tmp_path)]) == 0
    assert "found=false" in out.read_text() and "again=false" in out.read_text()
    assert "nichts zu tun" in capsys.readouterr().out
