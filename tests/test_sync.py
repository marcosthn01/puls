"""Tests für den Garmin-Sync ohne Netzwerk (Garmin wird durch eine Attrappe ersetzt)."""

from __future__ import annotations

import datetime as dt
import json
import sys
import types
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))

import crypto_box  # noqa: E402
import garmin_data as gd  # noqa: E402
import puls_sync  # noqa: E402

TZ = ZoneInfo("Europe/Berlin")
PASS = "ein-sehr-geheimes-passwort"


def ms(y, m, d, hh, mm):
    return int(dt.datetime(y, m, d, hh, mm, tzinfo=TZ).timestamp() * 1000)


def gmt(y, m, d, hh, mm):
    t = dt.datetime(y, m, d, hh, mm, tzinfo=TZ).astimezone(dt.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.0")


def sleep_payload(day: dt.date):
    prev = day - dt.timedelta(days=1)
    start = ms(prev.year, prev.month, prev.day, 23, 12)
    end = ms(day.year, day.month, day.day, 6, 58)
    return {
        "dailySleepDTO": {
            "calendarDate": day.isoformat(),
            "sleepTimeSeconds": 26100,
            "sleepStartTimestampGMT": start,
            "sleepEndTimestampGMT": end,
            "deepSleepSeconds": 5000,
            "lightSleepSeconds": 14000,
            "remSleepSeconds": 7100,
            "awakeSleepSeconds": 1860,
            "awakeCount": 2,
            "avgSleepStress": 14.3,
            "averageRespirationValue": 14.25,
            "averageSpO2Value": 95.0,
            "sleepScores": {"overall": {"value": 82, "qualifierKey": "GOOD"}},
            "sleepNeed": {"baseline": 480, "actual": 500},
        },
        "sleepLevels": [
            {"startGMT": gmt(prev.year, prev.month, prev.day, 23, 12), "endGMT": gmt(prev.year, prev.month, prev.day, 23, 40), "activityLevel": 1.0},
            {"startGMT": gmt(prev.year, prev.month, prev.day, 23, 40), "endGMT": gmt(day.year, day.month, day.day, 0, 30), "activityLevel": 0.0},
            {"startGMT": gmt(day.year, day.month, day.day, 0, 30), "endGMT": gmt(day.year, day.month, day.day, 1, 0), "activityLevel": 2.0},
        ],
        "restingHeartRate": 51,
        "avgOvernightHrv": 48.0,
        "bodyBatteryChange": 55,
    }


def heart_payload(day: dt.date):
    values = []
    t0 = ms(day.year, day.month, day.day, 0, 0)
    for i in range(720):  # alle 2 Minuten
        bpm = 52 if i < 210 else 75
        if 540 <= i < 570:  # 60 Minuten Training um 18 Uhr
            bpm = 150
        values.append([t0 + i * 120_000, bpm])
    values.append([t0 + 5, None])
    return {"heartRateValues": values, "maxHeartRate": 150, "minHeartRate": 52, "restingHeartRate": 52}


def test_crypto_roundtrip_and_wrong_password():
    box = crypto_box.encrypt_json({"a": [1, 2, "ä"]}, PASS, iterations=1000)
    assert crypto_box.decrypt_json(box, PASS) == {"a": [1, 2, "ä"]}
    with pytest.raises(crypto_box.CryptoError):
        crypto_box.decrypt_json(box, "falsches-passwort!")


def test_salt_is_reused_when_given():
    box1 = crypto_box.encrypt_json({}, PASS, iterations=1000)
    box2 = crypto_box.encrypt_json({}, PASS, salt=crypto_box.box_salt(box1), iterations=1000)
    assert box1["salt"] == box2["salt"] and box1["iv"] != box2["iv"]


def test_short_passphrase_rejected():
    with pytest.raises(crypto_box.CryptoError):
        crypto_box.check_passphrase("kurz")


def test_normalize_sleep():
    day = dt.date(2026, 11, 8)
    s = gd.normalize_sleep(sleep_payload(day), day, TZ, keep_levels=True)
    assert s["bed"] == -48 and s["wake"] == 418
    assert s["dur"] == 26100 and s["deep"] == 5000 and s["score"] == 82
    assert s["hrv"] == 48.0 and s["rhr"] == 51
    assert s["resp"] in (14.2, 14.3)
    assert s["need"] == 480
    assert s["levels"][0] == [0, 28, 1] and s["levels"][1][2] == 0 and s["levels"][2][2] == 2


def test_normalize_sleep_without_levels_and_empty():
    day = dt.date(2026, 11, 8)
    assert "levels" not in gd.normalize_sleep(sleep_payload(day), day, TZ, keep_levels=False)
    assert gd.normalize_sleep({"dailySleepDTO": {}}, day, TZ, True) is None
    assert gd.normalize_sleep(None, day, TZ, True) is None


def test_normalize_hrv():
    raw = {"hrvSummary": {"lastNightAvg": 47, "weeklyAvg": 50, "status": "BALANCED", "lastNight5MinHigh": 70,
                          "baseline": {"balancedLow": 44, "balancedUpper": 58}}}
    assert gd.normalize_hrv(raw) == {"avg": 47.0, "weekly": 50.0, "peak": 70.0, "status": "BALANCED", "low": 44.0, "high": 58.0}
    assert gd.normalize_hrv({"hrvSummary": {}}) is None


def test_normalize_stats_drops_negative_stress():
    s = gd.normalize_stats({"totalSteps": 8123, "averageStressLevel": -1, "restingHeartRate": 53, "bodyBatteryHighestValue": 88})
    assert s == {"steps": 8123, "rhr": 53, "bbHigh": 88}


def test_normalize_heart_histogram_and_series():
    day = dt.date(2026, 11, 8)
    h = gd.normalize_heart(heart_payload(day), day, TZ, keep_series=True)
    assert len(h["hist"]) == gd.HR_BINS
    assert sum(h["hist"]) == pytest.approx(24 * 60, abs=3)
    bin150 = (150 - gd.HR_BIN_START) // gd.HR_BIN_WIDTH
    assert h["hist"][bin150] == pytest.approx(60, abs=0.5)
    assert len(h["series"]) == 144 and h["series"][108] == [1080, 150]


def test_normalize_stress():
    day = dt.date(2026, 11, 8)
    t0 = ms(2026, 11, 8, 9, 0)
    raw = {
        "stressValuesArray": [[t0, 30], [t0 + 180_000, 50], [t0 + 360_000, -1], [t0 + 900_000, 80]],
        "bodyBatteryValuesArray": [[t0, "MEASURED", 70, 3.0], [t0 + 600_000, "MEASURED", 66, 3.0]],
    }
    s = gd.normalize_stress(raw, day, TZ)
    assert s["stress"] == [[540, 40], [550, 80]]
    assert s["bb"] == [[540, 70], [550, 66]]
    assert gd.normalize_stress({}, day, TZ) is None


def test_normalize_activity():
    raw = {"activityId": 1, "activityName": "Lauf", "startTimeLocal": "2026-11-08 18:00:05",
           "activityType": {"typeKey": "running"}, "duration": 3600.4, "distance": 10012.3,
           "averageHR": 150, "maxHR": 171, "activityTrainingLoad": 120.6, "aerobicTrainingEffect": 3.4,
           "hrTimeInZone_1": 60, "hrTimeInZone_2": 600, "hrTimeInZone_3": 2000}
    date, act = gd.normalize_activity(raw)
    assert date == "2026-11-08" and act["start"] == "18:00" and act["dur"] == 3600 and act["load"] == 121
    assert act["zones"] == [60, 600, 2000, None, None]


def test_dates_to_fetch():
    today = dt.date(2026, 11, 9)
    assert len(puls_sync.dates_to_fetch({"days": {}}, today, 90, False)) == 90
    store = {"days": {(today - dt.timedelta(days=i)).isoformat(): {"x": 1} for i in range(40)}}
    assert puls_sync.dates_to_fetch(store, today, 90, False) == [today - dt.timedelta(days=i) for i in (2, 1, 0)]
    del store["days"][(today - dt.timedelta(days=10)).isoformat()]
    assert today - dt.timedelta(days=10) in puls_sync.dates_to_fetch(store, today, 90, False)


# --- Ende-zu-Ende mit Garmin-Attrappe -------------------------------------------------


class TooMany(Exception):
    pass


class AuthError(Exception):
    pass


def fake_module(needs_mfa=False, valid_tokens=("tok-1",)):
    calls = []

    class FakeClient:
        def __init__(self):
            self.token = None

        def dumps(self):
            return json.dumps({"di_token": self.token, "di_refresh_token": "r", "di_client_id": "c"})

    class Garmin:
        def __init__(self, email=None, password=None, return_on_mfa=False, **_):
            self.email, self.password = email, password
            self.client = FakeClient()

        def login(self, tokenstore=None):
            calls.append(("login", bool(tokenstore)))
            if tokenstore:
                tok = json.loads(tokenstore).get("di_token")
                if tok not in valid_tokens:
                    raise AuthError("bad token")
                self.client.token = tok
                return None, None
            if needs_mfa:
                return "needs_mfa", {"cookie": "x"}
            self.client.token = "tok-1"
            return None, None

        def resume_login(self, state, code):
            calls.append(("resume", code))
            if code != "123456":
                raise AuthError("wrong code")
            self.client.token = "tok-1"

        def get_user_profile(self):
            return {"userData": {"gender": "MALE", "birthDate": "1992-04-01", "weight": 82400.0, "height": 183.0}}

        def get_sleep_data(self, d):
            return sleep_payload(dt.date.fromisoformat(d))

        def get_hrv_data(self, d):
            return {"hrvSummary": {"lastNightAvg": 50}}

        def get_stats(self, d):
            return {"totalSteps": 9000, "restingHeartRate": 52}

        def get_heart_rates(self, d):
            return heart_payload(dt.date.fromisoformat(d))

        def get_stress_data(self, d):
            t0 = ms(*dt.date.fromisoformat(d).timetuple()[:3], 10, 0)
            return {"stressValuesArray": [[t0, 25]], "bodyBatteryValuesArray": [[t0, "MEASURED", 80, 3.0]]}

        def get_steps_data(self, d):
            day = dt.date.fromisoformat(d)
            # Uhr zählt 14:00–14:30 je 300 Schritte (Hände auf der Tastatur)
            return [{"startGMT": gmt(day.year, day.month, day.day, 14, m), "steps": 300} for m in (0, 15)]

        def get_activities_by_date(self, start, end):
            return [{"activityId": 7, "startTimeLocal": f"{end} 18:00:00", "duration": 3600, "averageHR": 150,
                     "activityType": {"typeKey": "running"}}]

    mod = types.SimpleNamespace(
        Garmin=Garmin,
        GarminConnectTooManyRequestsError=TooMany,
        GarminConnectAuthenticationError=AuthError,
    )
    return mod, calls


def run(tmp_path, mod, inputs=None, event="schedule", **env):
    base_env = {"DATA_PASSPHRASE": PASS, "GITHUB_EVENT_NAME": event, "BACKFILL_DAYS": "5"}
    base_env.update(env)
    return puls_sync.run(
        garmin_module=mod,
        cache_dir=tmp_path / "cache",
        site_url=None,
        out_dir=tmp_path / "site",
        env=base_env,
        inputs=inputs or {},
        now=dt.datetime(2026, 11, 9, 7, 30, tzinfo=TZ),
        pause=0,
    )


def read_store(tmp_path):
    box = json.loads((tmp_path / "site" / "data.enc.json").read_text())
    return crypto_box.decrypt_json(box, PASS)


def test_first_run_backfills_and_reuses_tokens(tmp_path):
    mod, calls = fake_module()
    assert run(tmp_path, mod, GARMIN_EMAIL="a@b.de", GARMIN_PASSWORD="pw") == 0
    store = read_store(tmp_path)
    assert len(store["days"]) == 5
    assert store["profile"] == {"sex": "male", "birthYear": 1992, "weight": 82.4, "height": 183}
    assert store["days"]["2026-11-09"]["acts"][0]["type"] == "running"
    assert "levels" in store["days"]["2026-11-09"]["sleep"]
    assert store["days"]["2026-11-09"]["stressDay"] == {"stress": [[600, 25]], "bb": [[600, 80]]}
    assert store["status"]["auth"] == "ok"
    first_salt = json.loads((tmp_path / "site" / "data.enc.json").read_text())["salt"]

    calls.clear()
    assert run(tmp_path, mod) == 0  # ohne Passwort: Tokens aus dem Zwischenspeicher
    assert calls == [("login", True)]
    assert json.loads((tmp_path / "site" / "data.enc.json").read_text())["salt"] == first_salt


def test_mfa_flow(tmp_path):
    mod, calls = fake_module(needs_mfa=True)
    creds = {"GARMIN_EMAIL": "a@b.de", "GARMIN_PASSWORD": "pw"}
    assert run(tmp_path, mod, event="workflow_dispatch", **creds) == 3
    assert read_store(tmp_path)["status"]["auth"] == "mfa"

    calls.clear()
    assert run(tmp_path, mod, event="schedule", **creds) == 1  # geplante Läufe lösen keine Code-Mails aus
    assert calls == []

    assert run(tmp_path, mod, inputs={"mfa_code": "123456"}, event="workflow_dispatch", **creds) == 0
    assert read_store(tmp_path)["status"]["auth"] == "ok"
    assert len(read_store(tmp_path)["days"]) == 5


def test_missing_passphrase(tmp_path):
    mod, _ = fake_module()
    assert run(tmp_path, mod, DATA_PASSPHRASE="") == 2


def test_no_credentials(tmp_path):
    mod, _ = fake_module()
    assert run(tmp_path, mod) == 1


def test_prune_strips_old_details():
    today = dt.date(2026, 11, 9)
    store = {"days": {
        "2026-10-01": {"sleep": {"dur": 1, "levels": [[0, 1, 1]]}, "hr": {"hist": [1], "series": [[0, 60]]}},
        "2026-11-08": {"sleep": {"dur": 1, "levels": [[0, 1, 1]]}},
        "2023-01-01": {"sleep": {"dur": 1}},
    }}
    puls_sync.prune(store, today)
    assert store["days"]["2026-10-01"] == {"sleep": {"dur": 1}, "hr": {"hist": [1]}}
    assert "levels" in store["days"]["2026-11-08"]["sleep"]
    assert "2023-01-01" not in store["days"]


WALK = "2026-11-09T14:00:00+01:00;2026-11-09T14:30:00+01:00;3000\n09.11.26, 9:00;09.11.26, 9:10;800"


def test_walkpad_steps_are_added_without_double_counting(tmp_path):
    mod, _ = fake_module()
    creds = {"GARMIN_EMAIL": "a@b.de", "GARMIN_PASSWORD": "pw"}
    assert run(tmp_path, mod, inputs={"walk": WALK}, event="workflow_dispatch", **creds) == 0
    day = read_store(tmp_path)["days"]["2026-11-09"]
    assert day["stepsDay"][56] == 300 and day["stepsDay"][57] == 300 and sum(day["stepsDay"]) == 600
    pad = day["pad"]
    assert pad["total"] == 3800
    assert pad["add"] == 3800 - 600  # was die Uhr in der Zeit schon gezählt hat, wird abgezogen
    assert pad["units"] == [[540, 550, 800], [840, 870, 3000]]
    assert pad["min"] == 40

    # derselbe Kurzbefehl noch einmal: nichts doppelt
    assert run(tmp_path, mod, inputs={"walk": WALK}, event="workflow_dispatch") == 0
    assert read_store(tmp_path)["days"]["2026-11-09"]["pad"]["total"] == 3800


def test_walkpad_saved_even_when_garmin_needs_code(tmp_path):
    mod, _ = fake_module(needs_mfa=True)
    creds = {"GARMIN_EMAIL": "a@b.de", "GARMIN_PASSWORD": "pw"}
    assert run(tmp_path, mod, inputs={"walk": WALK}, event="workflow_dispatch", **creds) == 3
    assert read_store(tmp_path)["days"]["2026-11-09"]["pad"]["total"] == 3800
    # danach normal: Garmin-Daten werden trotzdem vollständig nachgeladen
    assert run(tmp_path, mod, inputs={"mfa_code": "123456"}, event="workflow_dispatch", **creds) == 0
    assert len(read_store(tmp_path)["days"]) == 5


def test_prune_drops_step_buckets():
    store = {"days": {"2026-10-01": {"stepsDay": [0] * 96, "pad": {"samples": [[0, 60, 10]]}}}}
    puls_sync.prune(store, dt.date(2026, 11, 9))
    assert store["days"]["2026-10-01"] == {"pad": {"samples": [[0, 60, 10]]}}
