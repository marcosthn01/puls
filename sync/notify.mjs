// Zeitplan-Entscheidung und Benachrichtigungen aufs iPhone (Web Push) – läuft in GitHub Actions.
//
//   node sync/notify.mjs plan .puls-cache   → entscheidet, ob ein geplanter Lauf Garmin abfragen soll
//   node sync/notify.mjs send .puls-cache   → verschickt fällige Benachrichtigungen
//
// Nachrichten (je höchstens einmal am Tag):
//   morning   – sobald die neue Nacht da ist: Recovery, Ziel-Strain, Schlaf
//   afternoon – Trainingsziel: wie viel noch fehlt oder „erreicht“; Energie niedrig
//   weekly    – sonntags nachmittags: Wochenbericht
//   bedtime   – kurz vor der empfohlenen Schlafenszeit
// Schlüssel, Abo und Versandstatus liegen verschlüsselt im Zwischenspeicher (push.enc.json).
// Im Log stehen keine Gesundheitswerte.

import fs from 'node:fs';
import path from 'node:path';
import { openBox } from '../app/crypto.js';
import * as E from '../app/engine.js';

const tz = process.env.PULS_TIMEZONE || 'Europe/Berlin';
const site = (process.env.PULS_SITE_URL || 'https://example.github.io/puls').replace(/\/$/, '') + '/';
const log = (m) => console.log(m);
const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// ------------------------------------------------------------------ Verschlüsselung (wie crypto_box.py)

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

// ------------------------------------------------------------------ Zeit

/** Datum, Minute des Tages und Wochentag in der Zeitzone des Nutzers. */
export function localNow(date = new Date(), zone = tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: iso, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: E.weekday(iso) };
}

const WINDOWS = {
  morning: [5 * 60, 11 * 60 + 30],
  afternoon: [15 * 60, 18 * 60 + 30],
  evening: [19 * 60, 24 * 60],
};
const inWin = (m, [a, b]) => m >= a && m < b;

function bedtimeWindow(model, now) {
  if (!model || model.empty) return false;
  const i = model.days.length - 1;
  if (model.days[i].date !== now.date) return false;
  const bed = E.bedtimePlan(model, i).options[0].bed; // relativ zu Mitternacht nach heute
  const rel = now.minutes - 1440;
  return rel >= bed - 75 && rel <= bed + 15;
}

// ------------------------------------------------------------------ Entscheidungen (rein, getestet)

/** Soll ein geplanter Lauf Garmin abfragen? Läufe ohne Anlass enden sofort. */
export function planRun({ now, state, model }) {
  const sent = state?.sent || {};
  const subscribed = !!state?.subscription;
  if (inWin(now.minutes, WINDOWS.morning)) {
    if (state?.morningDone === now.date) return { sync: false, reason: 'Morgen-Abruf heute schon erledigt' };
    return { sync: true, reason: 'Morgen: auf die neue Nacht warten' };
  }
  if (!subscribed) return { sync: false, reason: 'keine Benachrichtigungen eingerichtet' };
  if (inWin(now.minutes, WINDOWS.afternoon)) {
    const weeklyDue = now.weekday === 0 && sent.weekly !== now.date;
    if (sent.afternoon === now.date && !weeklyDue) return { sync: false, reason: 'Nachmittag schon erledigt' };
    return { sync: true, reason: 'Nachmittag: Trainingsziel prüfen' };
  }
  if (inWin(now.minutes, WINDOWS.evening)) {
    if (sent.bedtime === now.date) return { sync: false, reason: 'Schlaf-Erinnerung schon verschickt' };
    if (bedtimeWindow(model, now)) return { sync: true, reason: 'Abend: bald Schlafenszeit' };
    return { sync: false, reason: 'Abend: noch nicht Schlafenszeit' };
  }
  return { sync: false, reason: 'kein Zeitfenster' };
}

const round = (v) => Math.round(v);
const zoneWord = { green: 'Grün 💚', yellow: 'Gelb 💛', red: 'Rot ❤️' };

/** Welche Nachrichten jetzt fällig sind. */
export function dueMessages(model, now, sent = {}) {
  const out = [];
  if (!model || model.empty) return out;
  const i = model.days.length - 1;
  const d = model.days[i];
  if (d.date !== now.date) return out;

  if (d.recovery != null && sent.morning !== now.date && now.minutes >= 5 * 60 && now.minutes < 13 * 60) {
    let body;
    if (d.alarm) {
      body = 'Mehrere Körperwerte auffällig – heute schonen, viel trinken, früh schlafen.';
    } else {
      const sleep = d.sleepMin != null ? ` · Schlaf ${E.fmtDur(d.sleepMin)} Std. (${round(d.perf)} %)` : '';
      body = `Ziel-Strain heute ${round(d.target.low)}–${round(d.target.high)}${sleep}. Tippe für deinen Plan und den Morgen-Check.`;
    }
    out.push({ kind: 'morning', title: d.alarm ? `⚠️ Recovery ${d.recovery} % · Warnsignale` : `Recovery ${d.recovery} % · ${zoneWord[d.zone]}`, body, tag: 'morning' });
  }

  if (inWin(now.minutes, WINDOWS.afternoon) && sent.afternoon !== now.date && d.target) {
    const coach = E.buildCoach(model, i);
    const strain = d.strain ?? 0;
    let msg;
    if (d.alarm || d.zone === 'red') {
      msg = strain > d.target.high
        ? { title: 'Genug für heute', body: `Strain ${strain.toFixed(1).replace('.', ',')} – an einem roten Tag ist jetzt Erholung dran.` }
        : null;
    } else if (strain < d.target.low) {
      msg = { title: `Noch ${coach.remaining.z2} Min. bis zu deinem Ziel 🏃`, body: `Strain bisher ${strain.toFixed(1).replace('.', ',')} von ${round(d.target.low)}–${round(d.target.high)}. ${coach.remaining.text}` };
    } else if (strain <= d.target.high) {
      msg = { title: 'Ziel-Strain erreicht 💪', body: `${strain.toFixed(1).replace('.', ',')} – perfekt im Zielbereich. Ab jetzt locker bleiben.` };
    }
    const bb = d.stats?.bbNow;
    if (E.isNum(bb) && bb <= 25) {
      msg = { title: `Energie niedrig (Body Battery ${bb})`, body: `${msg ? `${msg.title}. ` : ''}Plane heute einen ruhigen Abend und geh früh ins Bett.` };
    }
    if (msg) out.push({ kind: 'afternoon', ...msg, tag: 'afternoon' });
  }

  if (now.weekday === 0 && inWin(now.minutes, [15 * 60, 21 * 60]) && sent.weekly !== now.date) {
    const w = E.weeklyAssessment(model, i);
    if (w.current.recovery != null) {
      out.push({ kind: 'weekly', title: `Deine Woche: ${w.verdict.label}`, body: `Ø Recovery ${round(w.current.recovery)} % · ${w.current.green} grüne Tage. ${w.verdict.text}`, tag: 'weekly' });
    }
  }

  if (sent.bedtime !== now.date && bedtimeWindow(model, now)) {
    const plan = E.bedtimePlan(model, i);
    out.push({
      kind: 'bedtime',
      title: 'Zeit runterzufahren 🌙',
      body: `Ins Bett um ${E.fmtClock(plan.options[0].bed)} für ${E.fmtDur(plan.need.total)} Std. Schlaf (spätestens ${E.fmtClock(plan.options[1].bed)}).`,
      tag: 'bedtime',
    });
  }
  return out;
}

// ------------------------------------------------------------------ Ablauf in GitHub Actions

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

async function loadState(cacheDir, pass) {
  const file = path.join(cacheDir, 'push.enc.json');
  if (!fs.existsSync(file)) return null;
  try {
    return await unseal(JSON.parse(fs.readFileSync(file, 'utf8')), pass);
  } catch {
    log('Benachrichtigungen: alter Zustand nicht lesbar – neu anlegen.');
    return null;
  }
}

async function loadModel(cacheDir, pass, settings) {
  const file = path.join(cacheDir, 'data.enc.json');
  if (!fs.existsSync(file)) return null;
  const { data } = await openBox(JSON.parse(fs.readFileSync(file, 'utf8')), pass, null);
  return E.analyze(data, settings || {});
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function plan(cacheDir, pass) {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') {
    setOutput('sync', 'true');
    log('Lauf: von der App oder von Hand gestartet.');
    return;
  }
  const state = pass ? await loadState(cacheDir, pass) : null;
  let model = null;
  try {
    model = pass ? await loadModel(cacheDir, pass, state?.settings) : null;
  } catch {
    model = null;
  }
  const decision = planRun({ now: localNow(), state, model });
  setOutput('sync', decision.sync ? 'true' : 'false');
  log(`Geplanter Lauf: ${decision.sync ? 'Garmin abfragen' : 'nichts zu tun'} (${decision.reason}).`);
}

async function send(cacheDir, pass) {
  const { default: webpush } = await import('web-push');
  fs.mkdirSync(cacheDir, { recursive: true });
  let state = await loadState(cacheDir, pass);
  if (!state?.vapid) {
    state = { vapid: webpush.generateVAPIDKeys(), subscription: null, settings: {}, sent: {} };
    log('Benachrichtigungen: neue Schlüssel erzeugt.');
  }
  state.sent ||= {};
  fs.writeFileSync(path.join(cacheDir, 'push-public.json'), JSON.stringify({ publicKey: state.vapid.publicKey }));
  webpush.setVapidDetails(site, state.vapid.publicKey, state.vapid.privateKey);

  const push = async (msg) => {
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
      log('Benachrichtigungen: Abo gespeichert.');
      await push({ kind: 'test', title: 'Puls ✓', body: 'Benachrichtigungen sind aktiv: morgens deine Recovery, nachmittags dein Trainingsziel, abends die Schlaf-Erinnerung.', tag: 'test' });
    } catch {
      log('Benachrichtigungen: übergebenes Abo ist ungültig.');
    }
  }

  try {
    const model = await loadModel(cacheDir, pass, state.settings);
    const now = localNow();
    const last = model && !model.empty ? model.days[model.days.length - 1] : null;
    if (last && last.date === now.date && last.recovery != null) state.morningDone = now.date;
    const scheduled = process.env.GITHUB_EVENT_NAME === 'schedule';
    for (const msg of dueMessages(model, now, state.sent)) {
      // Wer die App gerade geöffnet hat, sieht alles schon – dann nur als erledigt merken.
      const ok = state.subscription && scheduled ? await push(msg) : true;
      if (ok) state.sent[msg.kind] = now.date;
    }
  } catch (err) {
    log(`Benachrichtigungen: Daten nicht auswertbar (${err?.message || err}).`);
  }

  fs.writeFileSync(path.join(cacheDir, 'push.enc.json'), JSON.stringify(await seal(state, pass)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, cacheDir = '.puls-cache'] = process.argv.slice(2);
  const pass = process.env.DATA_PASSPHRASE;
  const run = cmd === 'plan' ? plan : send;
  if (!pass && cmd !== 'plan') {
    log('Benachrichtigungen: kein DATA_PASSPHRASE – übersprungen.');
  } else {
    run(cacheDir, pass).catch((err) => {
      log(`Benachrichtigungen: Fehler (${err?.message || err}).`);
      if (cmd === 'plan') setOutput('sync', 'true');
    });
  }
}
