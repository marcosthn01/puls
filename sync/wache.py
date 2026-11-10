"""Morgenwache: wartet, bis die neue Nacht bei Garmin angekommen ist.

Läuft in GitHub Actions (``.github/workflows/wache.yml``), wenn ein Abruf morgens noch keine Nacht
gefunden hat. Fragt alle paar Minuten nur die Schlafdaten von heute ab (eine kleine Anfrage) und
meldet ``found=true``, sobald sie da sind – dann startet der Workflow den normalen Abruf, der die
Daten veröffentlicht und die Morgen-Benachrichtigung schickt.

Meldet sich nur mit gespeicherten Tokens an (nie mit Passwort), damit Garmin keine Codes verschickt.
Ins Log kommen keine Gesundheitswerte.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

from crypto_box import CryptoError, check_passphrase  # noqa: E402
from garmin_auth import AuthProblem, connect  # noqa: E402
from garmin_data import normalize_sleep  # noqa: E402

START_MIN = 4 * 60  # ab 04:00 Uhr
END_MIN = 12 * 60 + 30  # bis 12:30 Uhr
INTERVAL_S = 180
BUDGET_S = 5 * 3600 + 40 * 60  # GitHub beendet Jobs nach 6 Std. – vorher an eine neue Wache übergeben


def log(msg: str) -> None:
    print(msg, flush=True)


def in_window(now: dt.datetime) -> bool:
    m = now.hour * 60 + now.minute
    return START_MIN <= m < END_MIN


def night_ready(raw: Any, day: dt.date, tz: ZoneInfo) -> bool:
    """Ist die Nacht, die heute endet, vollständig bei Garmin?"""
    return normalize_sleep(raw, day, tz, keep_levels=False) is not None


def watch(
    check: Callable[[], bool],
    now: Callable[[], dt.datetime],
    sleep: Callable[[float], None],
    elapsed: Callable[[], float],
    interval: float = INTERVAL_S,
    budget: float = BUDGET_S,
) -> str:
    """Prüft im Abstand ``interval``, bis die Nacht da ist.

    Ergebnis: ``found`` (Nacht da), ``window`` (Morgen-Fenster vorbei) oder ``budget``
    (Laufzeit fast aufgebraucht – eine neue Wache soll übernehmen).
    """
    n = 0
    while True:
        if not in_window(now()):
            log("Morgen-Fenster vorbei – die Wache endet.")
            return "window"
        if elapsed() > budget:
            log("Laufzeit fast aufgebraucht – eine neue Wache übernimmt.")
            return "budget"
        n += 1
        try:
            if check():
                log(f"Nacht ist da (Prüfung {n}).")
                return "found"
        except Exception as e:  # Netzwerk, Garmin kurz weg: einfach weiter warten
            log(f"Prüfung {n}: Garmin antwortet nicht ({type(e).__name__}).")
        else:
            log(f"Prüfung {n}: Nacht noch nicht bei Garmin.")
        sleep(interval)


def set_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", default=".puls-cache")
    args = parser.parse_args(argv)

    set_output("found", "false")
    set_output("again", "false")
    tz = ZoneInfo(os.environ.get("PULS_TIMEZONE") or "Europe/Berlin")
    clock = lambda: dt.datetime.now(tz)  # noqa: E731
    if not in_window(clock()):
        log("Außerhalb des Morgen-Fensters (04:00–12:30) – nichts zu tun.")
        return 0
    try:
        passphrase = check_passphrase(os.environ.get("DATA_PASSPHRASE"))
    except CryptoError as e:
        log(f"FEHLER: {e}")
        return 0

    import garminconnect  # erst hier, damit die Tests ohne Netzwerk laufen

    try:
        api = connect(
            garminconnect.Garmin,
            cache_dir=Path(args.cache),
            passphrase=passphrase,
            email=None,  # nur Tokens – kein Passwort-Login aus der Wache
            password=None,
            secret_tokens=os.environ.get("GARMIN_TOKENS") or None,
            mfa_code=None,
            manual_run=False,
            errors=garminconnect,
            log=log,
        )
    except AuthProblem as e:
        log(f"Wache: keine Anmeldung möglich ({e}). Der nächste normale Abruf meldet sich neu an.")
        return 0

    def check() -> bool:
        today = clock().date()
        return night_ready(api.get_sleep_data(today.isoformat()), today, tz)

    t0 = time.monotonic()
    result = watch(check, clock, time.sleep, lambda: time.monotonic() - t0)
    set_output("found", "true" if result == "found" else "false")
    set_output("again", "true" if result == "budget" else "false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
