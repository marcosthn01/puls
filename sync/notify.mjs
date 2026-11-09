// Benachrichtigungen aufs iPhone (Web Push) – läuft nach jedem Garmin-Abruf in GitHub Actions.
//
// - Morgens, sobald die neue Recovery da ist: „Recovery 72 % · Grün“.
// - Abends, kurz vor der empfohlenen Schlafenszeit: „Zeit fürs Bett“.
// Schlüssel, Abo und Versandstatus liegen verschlüsselt im Zwischenspeicher (.puls-cache/push.enc.json).
// Im Log stehen keine Gesundheitswerte.

import fs from 'node:fs';
import path from 'node:path';
import { openBox } from '../app/crypto.js';
import * as E from '../app/engine.js';

const cacheDir = process.argv[2] || '.puls-cache';
const pass = process.env.DATA_PASSPHRASE;
const tz = process.env.PULS_TIMEZONE || 'Europe/Berlin';
const site = (process.env.PULS_SITE_URL || 'https://example.github.io/puls').replace(/\/$/, '') + '/';
const STATE = path.join(cacheDir, 'push.enc.json');
const PUBLIC = path.join(cacheDir, 'push-public.json');

const log = (m) => console.log(m);
const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function aesKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(obj, passphrase, iterations = 200_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(passphrase, salt, iterations);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
}
export async function unseal(box, passphrase) {
  const key = await aesKey(passphrase, unb64(box.salt), box.iter);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Uhrzeit und Datum in der Zeitzone des Nutzers. */
export function localNow(date = new Date(), zone = tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Welche Nachrichten jetzt fällig sind (rein, für Tests). */
export function dueMessages(model, now, sent = {}) {
  const out = [];
  if (!model || model.empty) return out;
  const i = model.days.length - 1;
  const d = model.days[i];
  if (d.date !== now.date) return out;
  if (d.recovery != null && sent.morning !== now.date && now.minutes >= 5 * 60 && now.minutes < 13 * 60) {
    const zone = { green: 'Grün', yellow: 'Gelb', red: 'Rot' }[d.zone];
    out.push({
      kind: 'morning',
      title: d.alarm ? `Recovery ${d.recovery} % · Warnsignale` : `Recovery ${d.recovery} % · ${zone}`,
      body: d.alarm ? 'Mehrere Körperwerte auffällig – heute schonen.' : `Ziel-Strain heute ${Math.round(d.target.low)}–${Math.round(d.target.high)}. Tippe für deinen Plan.`,
      tag: 'morning',
    });
  }
  if (sent.bedtime !== now.date) {
    const plan = E.bedtimePlan(model, i);
    const bed = plan.options[0].bed; // Minuten relativ zu Mitternacht nach dem heutigen Tag
    const nowRel = now.minutes - 1440;
    if (nowRel >= bed - 60 && nowRel <= bed + 15) {
      out.push({
        kind: 'bedtime',
        title: 'Zeit runterzufahren 🌙',
        body: `Für 100 % Schlaf: ins Bett um ${E.fmtClock(bed)} (${E.fmtDur(plan.need.total)} Std. Bedarf).`,
        tag: 'bedtime',
      });
    }
  }
  return out;
}

function validSubscription(sub) {
  return sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

function eventInputs() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).inputs || {};
  } catch {
    return {};
  }
}

async function main() {
  const { default: webpush } = await import('web-push');
  if (!pass) {
    log('Benachrichtigungen: kein DATA_PASSPHRASE – übersprungen.');
    return;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  let state = null;
  if (fs.existsSync(STATE)) {
    try {
      state = await unseal(JSON.parse(fs.readFileSync(STATE, 'utf8')), pass);
    } catch {
      log('Benachrichtigungen: alter Zustand nicht lesbar – neu anlegen.');
    }
  }
  if (!state?.vapid) {
    state = { vapid: webpush.generateVAPIDKeys(), subscription: null, settings: {}, sent: {} };
    log('Benachrichtigungen: neue Schlüssel erzeugt.');
  }
  fs.writeFileSync(PUBLIC, JSON.stringify({ publicKey: state.vapid.publicKey }));
  webpush.setVapidDetails(site, state.vapid.publicKey, state.vapid.privateKey);

  const send = async (msg) => {
    try {
      await webpush.sendNotification(state.subscription, JSON.stringify({ ...msg, url: site }), { TTL: 6 * 3600, urgency: 'normal' });
      log(`Benachrichtigung gesendet: ${msg.kind}.`);
      return true;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        log('Benachrichtigungen: Abo abgelaufen – entfernt.');
        state.subscription = null;
      } else {
        log(`Benachrichtigung fehlgeschlagen (${err?.statusCode || err?.name || 'Fehler'}).`);
      }
      return false;
    }
  };

  const raw = String(eventInputs().push_subscription || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const sub = parsed.subscription || parsed;
      if (!validSubscription(sub)) throw new Error('ungültig');
      state.subscription = sub;
      state.settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : state.settings || {};
      state.sent = {};
      log('Benachrichtigungen: Abo gespeichert.');
      await send({ kind: 'test', title: 'Puls ✓', body: 'Benachrichtigungen sind aktiv. Morgens kommt deine Recovery, abends die Schlaf-Erinnerung.', tag: 'test' });
    } catch {
      log('Benachrichtigungen: übergebenes Abo ist ungültig.');
    }
  }

  if (state.subscription && fs.existsSync(path.join(cacheDir, 'data.enc.json'))) {
    try {
      const { data } = await openBox(JSON.parse(fs.readFileSync(path.join(cacheDir, 'data.enc.json'), 'utf8')), pass, null);
      const model = E.analyze(data, state.settings || {});
      for (const msg of dueMessages(model, localNow(), state.sent || {})) {
        if (await send(msg)) state.sent = { ...state.sent, [msg.kind]: localNow().date };
      }
    } catch (err) {
      log(`Benachrichtigungen: Daten nicht auswertbar (${err?.message || err}).`);
    }
  }

  fs.writeFileSync(STATE, JSON.stringify(await seal(state, pass)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.log(`Benachrichtigungen: Fehler (${err?.message || err}).`);
  });
}
