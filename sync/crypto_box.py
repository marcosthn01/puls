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
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
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


# ---------------------------------------------------------------- Import mit öffentlichem Schlüssel
#
# Für Daten, die von außen kommen (z. B. Krank-Einträge aus dem Google Kalender), ohne dass der
# Absender dein Passwort kennt: Der Abruf hält einen X25519-Schlüssel im verschlüsselten Speicher und
# veröffentlicht nur den öffentlichen Teil. Absender: Einmal-Schlüssel + ECDH → HKDF-SHA256 →
# AES-256-GCM. Öffnen kann es nur der Abruf (mit deinem Passwort an den privaten Schlüssel).

IMPORT_INFO = b"puls-import-v1"
_RAW = (serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def import_key(store: dict) -> X25519PrivateKey:
    """Privaten Import-Schlüssel aus dem Speicher holen oder einmalig erzeugen."""
    raw = store.get("importKey")
    if isinstance(raw, str):
        try:
            return X25519PrivateKey.from_private_bytes(_unb64(raw))
        except ValueError:
            pass
    key = X25519PrivateKey.generate()
    store["importKey"] = _b64(key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))
    return key


def import_public(key: X25519PrivateKey) -> str:
    return _b64(key.public_key().public_bytes(*_RAW))


def _import_aead(shared: bytes, epk: bytes, pub: bytes) -> AESGCM:
    return AESGCM(HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=IMPORT_INFO + epk + pub).derive(shared))


def seal_import(obj: Any, public_b64: str) -> dict[str, Any]:
    """Verschlüsseln für den Abruf – braucht nur den öffentlichen Schlüssel."""
    pub = _unb64(public_b64)
    eph = X25519PrivateKey.generate()
    epk = eph.public_key().public_bytes(*_RAW)
    iv = os.urandom(12)
    ct = _import_aead(eph.exchange(X25519PublicKey.from_public_bytes(pub)), epk, pub).encrypt(iv, json.dumps(obj).encode(), None)
    return {"v": 1, "epk": _b64(epk), "iv": _b64(iv), "ct": _b64(ct)}


def open_import(box: dict[str, Any], key: X25519PrivateKey) -> Any:
    try:
        epk = _unb64(box["epk"])
        pub = key.public_key().public_bytes(*_RAW)
        plain = _import_aead(key.exchange(X25519PublicKey.from_public_bytes(epk)), epk, pub).decrypt(_unb64(box["iv"]), _unb64(box["ct"]), None)
    except (KeyError, TypeError, ValueError, InvalidTag) as e:
        raise CryptoError("Import nicht lesbar") from e
    return json.loads(plain.decode("utf-8"))
