// Zeitplan-Entscheidung und Benachrichtigungen aufs iPhone (Web Push) – läuft in GitHub Actions.
//
//   node sync/notify.mjs plan .puls-cache   → entscheidet, ob ein geplanter Lauf Garmin abfragen soll
//   node sync/notify.mjs send .puls-cache   → verschickt fällige Benachrichtigungen
//
// Nachrichten (je höchstens einmal am Tag, nur wenn es etwas zu sagen gibt):
//   morning   – sobald die neue Nacht da ist: Recovery, Ziel-Strain, Schlaf
//   midday    – Stress seit einer Stunde hoch, sonst: noch kaum Schritte
//   afternoon – Trainingsziel: wie viel noch fehlt oder „erreicht“; Energie niedrig
//   weekly    – freitags Intensitätsminuten der Woche, sonntags Wochenbericht
//   steps     – früher Abend: noch fehlende Schritte oder „geschafft“
//   bedtime   – kurz vor der empfohlenen Schlafenszeit
//   pad       – nach dem Walking-Pad (vom iPhone-Kurzbefehl): Schritte heute
// Schlüssel, Abo und Versandstatus liegen verschlüsselt im Zwischenspeicher (push.enc.json).
// Im Log stehen keine Gesundheitswerte.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openBox } from '../app/crypto.js';
import * as E from '../app/engine.js';
import * as T from '../app/training.js';

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
  midday: [12 * 60, 14 * 60 + 30], // Sommerzeit + Verspätung der Läufe
  afternoon: [15 * 60, 17 * 60 + 30],
  steps: [18 * 60, 20 * 60 + 30],
  evening: [19 * 60, 24 * 60],
};
const inWin = (m, [a, b]) => m >= a && m < b;

/** Welche Arten der Nutzer bekommen möchte (Standard: alle). */
export const KINDS = {
  morning: 'Recovery am Morgen',
  midday: 'Bewegung & Stress mittags',
  afternoon: 'Trainingsziel am Nachmittag',
  steps: 'Schritte am Abend',
  bedtime: 'Schlafenszeit',
  weekly: 'Wochenbericht & Wochenziel',
  pad: 'Walking-Pad',
};
const wants = (state, kind) => state?.prefs?.[kind] !== false;

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
/** Morgens: fehlt die Nacht noch bei Garmin? Dann soll die Morgenwache übernehmen. */
export const NIGHT_WATCH = [4 * 60, 12 * 60 + 30];
export function needsNightWatch(model, now) {
  if (!inWin(now.minutes, NIGHT_WATCH)) return false;
  const last = model && !model.empty ? model.days[model.days.length - 1] : null;
  return !(last && last.date === now.date && last.sleep);
}

export function planRun({ now, state, model }) {
  const sent = state?.sent || {};
  const subscribed = !!state?.subscription;
  const open = (kind) => subscribed && wants(state, kind) && sent[kind] !== now.date;
  const m = now.minutes;
  if (inWin(m, WINDOWS.morning)) {
    if (state?.morningDone === now.date) return { sync: false, reason: 'Morgen-Abruf heute schon erledigt' };
    return { sync: true, reason: 'Morgen: auf die neue Nacht warten' };
  }
  if (!subscribed) return { sync: false, reason: 'keine Benachrichtigungen eingerichtet' };
  if (inWin(m, WINDOWS.midday)) return open('midday') ? { sync: true, reason: 'Mittag: Bewegung und Stress prüfen' } : { sync: false, reason: 'Mittag erledigt' };
  if (inWin(m, WINDOWS.afternoon)) {
    const weekly = (now.weekday === 0 || now.weekday === 5) && open('weekly');
    return open('afternoon') || weekly ? { sync: true, reason: 'Nachmittag: Trainingsziel prüfen' } : { sync: false, reason: 'Nachmittag erledigt' };
  }
  if (inWin(m, WINDOWS.steps) && open('steps')) return { sync: true, reason: 'Abend: Schritte prüfen' };
  if (inWin(m, WINDOWS.evening)) {
    if (open('bedtime') && bedtimeWindow(model, now)) return { sync: true, reason: 'Abend: bald Schlafenszeit' };
    return { sync: false, reason: 'Abend: nichts fällig' };
  }
  return { sync: false, reason: 'kein Zeitfenster' };
}

const round = (v) => Math.round(v);
const zoneWord = { green: 'Grün 💚', yellow: 'Gelb 💛', red: 'Rot ❤️' };
const de1 = (v) => v.toFixed(1).replace('.', ',');
const n0 = (v) => Math.round(v).toLocaleString('de-DE');

/** Stress der letzten Stunde aus der 10-Minuten-Kurve. */
function recentStress(d, now) {
  const pts = (d.stressSeries || []).filter((p) => p[0] >= now.minutes - 70 && p[0] <= now.minutes);
  return pts.length >= 3 ? E.mean(pts.map((p) => p[1])) : null;
}

/** Intensitätsminuten der aktuellen Woche (Mo–heute), wie Garmin sie zählt. */
function weekIntensity(model) {
  const days = model.days;
  const last = days[days.length - 1];
  const back = (E.weekday(last.date) + 6) % 7;
  let sum = 0;
  for (let k = Math.max(0, days.length - 1 - back); k < days.length; k++) {
    const st = days[k].stats || {};
    sum += (st.imMod || 0) + 2 * (st.imVig || 0);
  }
  return sum;
}

/** Welche Nachrichten jetzt fällig sind. ``state`` liefert Versandstatus und Wünsche. */
export function dueMessages(model, now, sent = {}, prefs = {}) {
  const out = [];
  if (!model || model.empty) return out;
  const want = (k) => prefs?.[k] !== false;
  const i = model.days.length - 1;
  const d = model.days[i];
  if (d.date !== now.date) return out;
  const st = d.stats || {};
  const goal = E.isNum(st.stepGoal) && st.stepGoal > 0 ? st.stepGoal : 8000;
  const steps = E.isNum(st.steps) ? st.steps : null;

  // Morgen: Recovery, sobald die Nacht da ist
  if (want('morning') && d.recovery != null && sent.morning !== now.date && now.minutes >= 5 * 60 && now.minutes < 13 * 60) {
    const ill = d.ill?.level ?? 0;
    const plan = T.trainingPlan(model, i);
    const sleep = d.sleepMin != null ? `Schlaf ${E.fmtDur(d.sleepMin)} Std. (${round(d.perf)} %)` : '';
    let title;
    let body;
    if (ill >= 2) {
      const sig = (d.ill.signals || []).filter((x) => ['rhr', 'hrv', 'resp', 'temp'].includes(x.key)).slice(0, 2).map((x) => x.text).join(', ');
      title = `⚠️ Infekt-Frühwarnung · ${E.ILL_LEVELS[ill]}`;
      body = `${sig ? `${sig}. ` : ''}${ill >= 3 ? 'Heute Pause, viel trinken, früh schlafen.' : 'Heute nur locker – kein Gym-Volumen.'} Recovery ${d.recovery} %.`;
    } else if (d.alarm) {
      title = `⚠️ Recovery ${d.recovery} % · Warnsignale`;
      body = 'Mehrere Körperwerte auffällig – heute schonen, viel trinken, früh schlafen.';
    } else {
      title = `Recovery ${d.recovery} % · ${zoneWord[d.zone]}`;
      const line = T.planLine(plan);
      body = `${line ? `Heute: ${line}.` : ''}${sleep ? ` ${sleep}.` : ''} Tippe für Details und den Morgen-Check.`.trim();
    }
    out.push({ kind: 'morning', title, body, tag: 'morning' });
  }

  // Mittag: Stress hoch? Sonst: zu wenig Bewegung?
  if (want('midday') && inWin(now.minutes, WINDOWS.midday) && sent.midday !== now.date) {
    const stress = recentStress(d, now);
    if (stress != null && stress >= 50) {
      out.push({ kind: 'midday', title: `Stress seit einer Stunde hoch (Ø ${round(stress)}) 😮‍💨`, body: 'Gönn dir 2 Minuten: 4 Sekunden einatmen, 6 Sekunden ausatmen. Senkt Puls und Stress messbar.', tag: 'midday' });
    } else if (steps != null && steps < goal * 0.35) {
      out.push({ kind: 'midday', title: `Erst ${n0(steps)} Schritte heute 👟`, body: `Ein Spaziergang in der Mittagspause bringt dich auf Kurs zu deinem Ziel von ${n0(goal)} – 15 Minuten sind ca. 1.500 Schritte.`, tag: 'midday' });
    }
  }

  // Nachmittag: Trainingsziel und Energie
  if (want('afternoon') && inWin(now.minutes, WINDOWS.afternoon) && sent.afternoon !== now.date && d.target) {
    const coach = E.buildCoach(model, i);
    const strain = d.strain ?? 0;
    let msg = null;
    if (d.alarm || d.zone === 'red') {
      if (strain > d.target.high) msg = { title: 'Genug für heute', body: `Strain ${de1(strain)} – an einem roten Tag ist jetzt Erholung dran.` };
    } else if (strain < d.target.low) {
      msg = { title: `Noch ${coach.remaining.z2} Min. bis zu deinem Ziel 🏃`, body: `Strain bisher ${de1(strain)} von ${round(d.target.low)}–${round(d.target.high)}. ${coach.remaining.text}` };
    } else if (strain <= d.target.high) {
      msg = { title: 'Ziel-Strain erreicht 💪', body: `${de1(strain)} – perfekt im Zielbereich. Ab jetzt locker bleiben.` };
    }
    const bb = st.bbNow;
    if (E.isNum(bb) && bb <= 25) msg = { title: `Energie niedrig (Body Battery ${bb})`, body: `${msg ? `${msg.title}. ` : ''}Plane einen ruhigen Abend und geh früh ins Bett.` };
    if (msg) out.push({ kind: 'afternoon', ...msg, tag: 'afternoon' });
  }

  // Freitag: Intensitätsminuten der Woche · Sonntag: Wochenbericht
  if (want('weekly') && inWin(now.minutes, [15 * 60, 21 * 60]) && sent.weekly !== now.date) {
    if (now.weekday === 5) {
      const im = weekIntensity(model);
      if (im < 150) out.push({ kind: 'weekly', title: `Noch ${150 - im} Intensitätsminuten diese Woche`, body: `Bisher ${im} von 150. Am Wochenende z. B. ${Math.ceil((150 - im) / 2 / 5) * 5} Min. zügig Radfahren oder Joggen (zählt doppelt).`, tag: 'weekly' });
    } else if (now.weekday === 0) {
      const w = E.weeklyAssessment(model, i);
      if (w.current.recovery != null) out.push({ kind: 'weekly', title: `Deine Woche: ${w.verdict.label}`, body: `Ø Recovery ${round(w.current.recovery)} % · ${w.current.green} grüne Tage. ${w.verdict.text}`, tag: 'weekly' });
    }
  }

  // Früher Abend: Schritte
  if (want('steps') && inWin(now.minutes, WINDOWS.steps) && sent.steps !== now.date && steps != null) {
    if (steps < goal) {
      const left = goal - steps;
      out.push({ kind: 'steps', title: `Noch ${n0(left)} Schritte bis zu deinem Ziel 👟`, body: `${n0(steps)} von ${n0(goal)} – das sind ca. ${Math.max(5, Math.round(left / 100 / 5) * 5)} Min. Spazieren.`, tag: 'steps' });
    } else {
      out.push({ kind: 'steps', title: 'Schrittziel geschafft 🎉', body: `${n0(steps)} von ${n0(goal)} Schritten – stark!`, tag: 'steps' });
    }
  }

  // Schlafenszeit
  if (want('bedtime') && sent.bedtime !== now.date && bedtimeWindow(model, now)) {
    const plan = E.bedtimePlan(model, i);
    out.push({ kind: 'bedtime', title: 'Zeit runterzufahren 🌙', body: `Ins Bett um ${E.fmtClock(plan.options[0].bed)} für ${E.fmtDur(plan.need.total)} Std. Schlaf (spätestens ${E.fmtClock(plan.options[1].bed)}).`, tag: 'bedtime' });
  }
  return out;
}

/** Bestätigung, wenn der iPhone-Kurzbefehl neue Walking-Pad-Schritte geschickt hat. */
export function padMessage(model, now, seen = 0, prefs = {}) {
  if (!model || model.empty || prefs?.pad === false) return null;
  const d = model.days[model.days.length - 1];
  if (d.date !== now.date || !d.pad || d.pad.total <= (seen || 0)) return null;
  const st = d.stats || {};
  const goal = E.isNum(st.stepGoal) && st.stepGoal > 0 ? st.stepGoal : 8000;
  let body = '';
  if (E.isNum(st.steps)) body = st.steps >= goal ? `Heute insgesamt ${n0(st.steps)} von ${n0(goal)} – Ziel geschafft 🎉` : `Heute insgesamt ${n0(st.steps)} von ${n0(goal)} – noch ${n0(goal - st.steps)}.`;
  if (d.pad.added <= 0) body = `Deine Uhr hatte sie schon mitgezählt. ${body}`.trim();
  return { kind: 'pad', title: `👟 Walking-Pad: ${n0(d.pad.total)} Schritte heute`, body, tag: 'pad', total: d.pad.total };
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

// ---------------------------------------------------------------- Widget-Datei (für Scriptable)

/** Name der Widget-Datei: w-<HMAC(Passwort)>.json – die App rechnet denselben Namen aus. */
export const widgetFileName = (pass) => `w-${crypto.createHmac('sha256', pass).update('puls-widget-v1').digest('hex').slice(0, 24)}.json`;

/** Verschlüsseln wie in app/widget.js beschrieben (HMAC-SHA256-Schlüsselstrom + MAC). */
export function sealWidget(obj, pass) {
  const key = crypto.createHmac('sha256', pass).update('puls-widget-key-v1').digest();
  const iv = crypto.randomBytes(16);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.alloc(pt.length);
  for (let blk = 0; blk * 32 < pt.length; blk++) {
    const seed = Buffer.concat([iv, Buffer.from([(blk >>> 24) & 255, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255])]);
    const ks = crypto.createHmac('sha256', key).update(seed).digest();
    for (let j = 0; j < 32 && blk * 32 + j < pt.length; j++) ct[blk * 32 + j] = pt[blk * 32 + j] ^ ks[j];
  }
  const mac = crypto.createHmac('sha256', key).update(Buffer.concat([iv, ct])).digest();
  return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64'), mac: mac.toString('base64') };
}

/** Was das Widget zeigt: Recovery, Schlaf, Strain, Training heute, Infekt-Stufe, Schlafenszeit, Woche. */
export function widgetPayload(model) {
  const i = model.days.length - 1;
  const d = model.days[i];
  const labels = model.labels || {};
  const plan = T.trainingPlan(model, i, { labels });
  const wk = T.trainingWeek(model, i, labels);
  const bed = d.recovery != null ? E.bedtimePlan(model, i)?.options?.[0]?.bed : null;
  const short = plan.kind === 'rest' ? 'Pause' : plan.kind === 'bike' ? `Rad ${plan.min} Min.` : plan.kind === 'gym' ? plan.title.replace(' · ', ' ') : plan.kind === 'done' ? 'Training erledigt' : '';
  const sub = plan.kind === 'bike' ? plan.sub.replace(', längere Anstiege gern kräftig', '') : plan.kind === 'gym' ? plan.volume : (plan.sub || '').split(' – ')[0];
  const lvl = d.ill?.level ?? 0;
  return {
    v: 1,
    date: d.date,
    at: model.generated,
    recovery: d.recovery,
    zone: d.zone,
    sleep: d.perf == null ? null : Math.round(d.perf),
    strain: d.strain == null ? null : Math.round(d.strain * 10) / 10,
    plan: plan.kind === 'none' || plan.kind === 'free' ? null : { title: plan.title, sub, short },
    ill: { level: lvl, label: E.ILL_LEVELS[lvl] },
    bed: bed != null ? E.fmtClock(bed) : null,
    week: `${wk.count} ${wk.count === 1 ? 'Training' : 'Trainings'}${Object.keys(wk.byLabel).length ? ` (${Object.entries(wk.byLabel).map(([k, n]) => `${n}× ${k}`).join(', ')})` : ''}`,
  };
}

function writeWidget(cacheDir, pass, model) {
  const name = widgetFileName(pass);
  for (const f of fs.readdirSync(cacheDir)) if (/^w-[0-9a-f]+\.json$/.test(f) && f !== name) fs.unlinkSync(path.join(cacheDir, f));
  fs.writeFileSync(path.join(cacheDir, name), JSON.stringify(sealWidget(widgetPayload(model), pass)));
  log('Widget-Datei aktualisiert.');
}

async function loadModel(cacheDir, pass, settings) {
  const file = path.join(cacheDir, 'data.enc.json');
  if (!fs.existsSync(file)) return null;
  const { data } = await openBox(JSON.parse(fs.readFileSync(file, 'utf8')), pass, null);
  const model = E.analyze(data, settings || {});
  if (!model.empty) model.labels = data.labels || {};
  return model;
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

  const inputs = eventInputs();
  const walkRun = !!String(inputs.walk || '').trim();
  const raw = String(inputs.push_subscription || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.settings && typeof parsed.settings === 'object') state.settings = parsed.settings;
      if (parsed.prefs && typeof parsed.prefs === 'object') {
        state.prefs = Object.fromEntries(Object.keys(KINDS).map((k) => [k, parsed.prefs[k] !== false]));
        log('Benachrichtigungen: Auswahl gespeichert.');
      }
      if (parsed.subscription || parsed.endpoint) {
        const sub = parsed.subscription || parsed;
        if (!validSubscription(sub)) throw new Error('ungültig');
        state.subscription = sub;
        log('Benachrichtigungen: Abo gespeichert.');
        await push({ kind: 'test', title: 'Puls ✓', body: 'Benachrichtigungen sind aktiv: morgens Recovery, tagsüber Bewegung, Training und Schritte, abends die Schlaf-Erinnerung.', tag: 'test' });
      }
    } catch {
      log('Benachrichtigungen: übergebenes Abo ist ungültig.');
    }
  }

  try {
    const model = await loadModel(cacheDir, pass, state.settings);
    const now = localNow();
    const last = model && !model.empty ? model.days[model.days.length - 1] : null;
    if (last && last.date === now.date && last.recovery != null) state.morningDone = now.date;
    // Von der Morgenwache gestartet zählt wie geplant: dann gibt es die Morgen-Benachrichtigung.
    const fromWatch = inputs.source === 'wache';
    const scheduled = process.env.GITHUB_EVENT_NAME === 'schedule' || fromWatch;
    const watch = !fromWatch && !walkRun && process.env.GITHUB_EVENT_NAME !== 'push' && needsNightWatch(model, now);
    setOutput('wait_night', watch ? 'true' : 'false');
    if (watch) log('Morgen: Nacht noch nicht bei Garmin – die Morgenwache übernimmt.');
    if (walkRun) {
      // Vom Kurzbefehl nach dem Laufen: nur die Walking-Pad-Bestätigung, sonst nichts abhaken.
      const msg = padMessage(model, now, state.padSeen?.[now.date], state.prefs);
      if (msg) {
        const ok = state.subscription ? await push(msg) : true;
        if (ok) state.padSeen = { [now.date]: msg.total };
        if (ok && state.subscription && inWin(now.minutes, WINDOWS.steps)) state.sent.steps = now.date;
      }
    }
    if (model && !model.empty) {
      try {
        writeWidget(cacheDir, pass, model);
      } catch (err) {
        log(`Widget-Datei nicht geschrieben (${err?.name || 'Fehler'}).`);
      }
    }
    for (const msg of walkRun ? [] : dueMessages(model, now, state.sent, state.prefs)) {
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
