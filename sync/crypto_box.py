"""Verschlüsselung der Gesundheitsdaten (AES-256-GCM, Schlüssel per PBKDF2 aus deinem Passwort).

Das Format ist so gewählt, dass die App es im Browser mit WebCrypto entschlüsseln kann
(siehe app/crypto.js). Die Datei auf der Webseite ist ohne Passwort nur Datensalat.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 600_000
MIN_PASSPHRASE_LENGTH = 10

_key_cache: dict[tuple[str, bytes, int], bytes] = {}


class CryptoError(Exception):
    """Entschlüsseln fehlgeschlagen (falsches Passwort oder kaputte Datei)."""


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def check_passphrase(passphrase: str | None) -> str:
    if not passphrase or len(passphrase) < MIN_PASSPHRASE_LENGTH:
        raise CryptoError(
            f"DATA_PASSPHRASE fehlt oder ist kürzer als {MIN_PASSPHRASE_LENGTH} Zeichen."
        )
    return passphrase


def derive_key(passphrase: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    cache_key = (passphrase, salt, iterations)
    if cache_key not in _key_cache:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations
        )
        _key_cache[cache_key] = kdf.derive(passphrase.encode("utf-8"))
    return _key_cache[cache_key]


def encrypt_json(
    obj: Any,
    passphrase: str,
    *,
    salt: bytes | None = None,
    iterations: int = ITERATIONS,
) -> dict[str, Any]:
    """Verschlüsselt ein JSON-Objekt. Wird ``salt`` wiederverwendet, bleibt der
    abgeleitete Schlüssel gleich und die App muss ihn nicht neu berechnen."""
    salt = salt or os.urandom(16)
    iv = os.urandom(12)
    key = derive_key(passphrase, salt, iterations)
    plaintext = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)
    return {
        "v": 1,
        "alg": "AES-256-GCM",
        "kdf": "PBKDF2-SHA256",
        "iter": iterations,
        "salt": _b64(salt),
        "iv": _b64(iv),
        "data": _b64(ciphertext),
    }


def box_salt(box: dict[str, Any]) -> bytes:
    return _unb64(box["salt"])


def decrypt_json(box: dict[str, Any], passphrase: str) -> Any:
    try:
        salt = _unb64(box["salt"])
        iv = _unb64(box["iv"])
        ciphertext = _unb64(box["data"])
        iterations = int(box.get("iter", ITERATIONS))
    except (KeyError, TypeError, ValueError) as e:
        raise CryptoError("Datei hat kein gültiges Format") from e
    key = derive_key(passphrase, salt, iterations)
    try:
        plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
    except InvalidTag as e:
        raise CryptoError("Falsches Passwort oder beschädigte Datei") from e
    return json.loads(plaintext.decode("utf-8"))
