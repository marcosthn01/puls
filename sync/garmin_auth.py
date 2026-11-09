"""Anmeldung bei Garmin – auch mit Bestätigungscode (MFA) komplett aus der Cloud.

Ablauf:
1. Gespeicherte Tokens aus dem Zwischenspeicher (verschlüsselt) → kein Login nötig.
2. Optional: Tokens aus dem Secret GARMIN_TOKENS.
3. Login mit GARMIN_EMAIL + GARMIN_PASSWORD.
   Verlangt Garmin einen Code, wird der halbe Login verschlüsselt gemerkt. Du startest den
   Workflow dann noch einmal mit dem Code (in der App oder auf GitHub) und er wird fertig.

Garmin erneuert die Tokens regelmäßig. Deshalb werden sie am Ende jedes Laufs wieder
gespeichert (``save_tokens``).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from crypto_box import CryptoError, decrypt_json, encrypt_json

TOKEN_FILE = "garmin_tokens.enc.json"
PENDING_FILE = "garmin_mfa_pending.enc.json"
MFA_FLAG = "garmin_needs_mfa"
PENDING_MAX_AGE_S = 30 * 60


class AuthProblem(Exception):
    """Anmeldung nicht möglich – die Nachricht erklärt, was zu tun ist."""


class MfaRequired(AuthProblem):
    pass


def _read_enc(path: Path, passphrase: str) -> Any:
    if not path.exists():
        return None
    try:
        return decrypt_json(json.loads(path.read_text()), passphrase)
    except (CryptoError, ValueError):
        return None


def _write_enc(path: Path, obj: Any, passphrase: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(encrypt_json(obj, passphrase, iterations=200_000)))


def save_tokens(api: Any, cache_dir: Path, passphrase: str) -> None:
    try:
        tokens = api.client.dumps()
    except Exception:
        return
    _write_enc(cache_dir / TOKEN_FILE, {"tokens": tokens, "saved": int(time.time())}, passphrase)


def connect(
    garmin_cls: Callable[..., Any],
    *,
    cache_dir: Path,
    passphrase: str,
    email: str | None,
    password: str | None,
    secret_tokens: str | None,
    mfa_code: str | None,
    manual_run: bool,
    errors: Any,
    log: Callable[[str], None] = print,
) -> Any:
    """Gibt eine angemeldete Garmin-Instanz zurück oder wirft ``AuthProblem``.

    ``errors`` ist das Modul ``garminconnect`` (für die Fehlerklassen), damit die Tests
    eine Attrappe einsetzen können.
    """
    too_many = errors.GarminConnectTooManyRequestsError
    pending_path = cache_dir / PENDING_FILE
    flag_path = cache_dir / MFA_FLAG

    # 1) Login mit Code abschließen
    if mfa_code:
        pending = _read_enc(pending_path, passphrase)
        if not pending:
            raise AuthProblem(
                "Es wartet kein Garmin-Login auf einen Code. Starte den Sync einmal ohne Code; "
                "Garmin schickt dir dann einen neuen."
            )
        if time.time() - pending.get("ts", 0) > PENDING_MAX_AGE_S:
            pending_path.unlink(missing_ok=True)
            raise AuthProblem(
                "Der Garmin-Code ist abgelaufen (älter als 30 Min.). Starte den Sync ohne Code neu."
            )
        api = garmin_cls(email, password, return_on_mfa=True)
        try:
            api.resume_login(pending["state"], mfa_code.strip())
        except too_many:
            raise AuthProblem("Garmin blockt gerade zu viele Login-Versuche. Warte 30 Minuten.")
        except Exception as e:
            raise AuthProblem(f"Der Garmin-Code wurde nicht akzeptiert ({type(e).__name__}).") from e
        pending_path.unlink(missing_ok=True)
        flag_path.unlink(missing_ok=True)
        save_tokens(api, cache_dir, passphrase)
        log("Garmin: Anmeldung mit Code erfolgreich.")
        return api

    # 2) Gespeicherte Tokens
    cached = _read_enc(cache_dir / TOKEN_FILE, passphrase)
    sources = [("Zwischenspeicher", (cached or {}).get("tokens")), ("Secret GARMIN_TOKENS", secret_tokens)]
    for label, tokens in sources:
        if not tokens:
            continue
        api = garmin_cls(return_on_mfa=True)
        try:
            api.login(tokenstore=tokens)
            save_tokens(api, cache_dir, passphrase)
            log(f"Garmin: angemeldet über {label}.")
            return api
        except too_many:
            raise AuthProblem("Garmin blockt gerade zu viele Anfragen. Der nächste Lauf versucht es wieder.")
        except Exception as e:
            log(f"Garmin: {label} nicht mehr gültig ({type(e).__name__}).")

    # 3) Login mit E-Mail und Passwort
    if not email or not password:
        raise AuthProblem(
            "Keine gültige Garmin-Anmeldung. Lege die Secrets GARMIN_EMAIL und GARMIN_PASSWORD an."
        )
    if flag_path.exists() and not manual_run:
        raise AuthProblem(
            "Garmin verlangt einen Bestätigungscode. Starte den Sync einmal von Hand "
            "(App → Einstellungen → 'Jetzt synchronisieren' oder GitHub → Actions → Run workflow)."
        )

    api = garmin_cls(email, password, return_on_mfa=True)
    try:
        status, state = api.login()
    except too_many:
        raise AuthProblem("Garmin blockt gerade zu viele Login-Versuche. Warte 30 Minuten.")
    except Exception as e:
        raise AuthProblem(
            f"Garmin-Login fehlgeschlagen ({type(e).__name__}). Stimmen E-Mail und Passwort?"
        ) from e

    if status == "needs_mfa":
        _write_enc(pending_path, {"state": state, "ts": int(time.time())}, passphrase)
        flag_path.parent.mkdir(parents=True, exist_ok=True)
        flag_path.write_text("1")
        raise MfaRequired(
            "Garmin hat dir gerade einen Bestätigungscode geschickt (E-Mail oder App). "
            "Starte den Sync innerhalb von 30 Minuten erneut und gib dabei den Code ein."
        )

    flag_path.unlink(missing_ok=True)
    save_tokens(api, cache_dir, passphrase)
    log("Garmin: Anmeldung mit E-Mail und Passwort erfolgreich.")
    return api
