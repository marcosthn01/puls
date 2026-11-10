// Entschlüsselt data.enc.json (AES-256-GCM, PBKDF2-SHA256) – Gegenstück zu sync/crypto_box.py.
// Der abgeleitete Schlüssel wird je Salt zwischengespeichert, damit das Öffnen schnell geht.

const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function deriveRawKey(passphrase, saltB64, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64(saltB64), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return toB64(bits);
}

export async function decryptBox(box, rawKeyB64) {
  const key = await crypto.subtle.importKey('raw', b64(rawKeyB64), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Entschlüsselt mit Passwort; ``cache`` ist {salt, iter, key} oder null. */
export async function openBox(box, passphrase, cache) {
  let key = cache && cache.salt === box.salt && cache.iter === box.iter ? cache.key : null;
  if (key) {
    try {
      return { data: await decryptBox(box, key), cache };
    } catch {
      key = null;
    }
  }
  if (!passphrase) throw new Error('NEED_PASSPHRASE');
  key = await deriveRawKey(passphrase, box.salt, box.iter);
  try {
    const data = await decryptBox(box, key);
    return { data, cache: { salt: box.salt, iter: box.iter, key } };
  } catch {
    throw new Error('WRONG_PASSPHRASE');
  }
}

/** Verschlüsselt ein Objekt mit dem gespeicherten Schlüssel ({salt, iter, key}) – lesbar für sync/crypto_box.py. */
export async function sealBox(obj, cache) {
  if (!cache?.key) throw new Error('NO_KEY');
  const key = await crypto.subtle.importKey('raw', b64(cache.key), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: cache.iter, salt: cache.salt, iv: toB64(iv), data: toB64(data) };
}
