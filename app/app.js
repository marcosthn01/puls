// Puls – Oberfläche. Lädt data.enc.json, entschlüsselt sie auf dem Gerät und zeigt die Auswertung.

import * as E from './engine.js';
import { bars, esc, hrCurve, hypnogram, lines, rangeBar, ring, sleepWindows, strainGauge } from './charts.js';
import { openBox } from './crypto.js';

const VERSION = '2.0.0';

const DATA_URL = 'data.enc.json';
const WORKFLOW = 'sync.yml';
const LS = {
  pass: 'puls.pass',
  key: 'puls.key',
  settings: 'puls.settings',
  demo: 'puls.demo',
  gh: 'puls.gh',
  range: 'puls.range',
  journal: 'puls.journal',
};

const ls = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* privater Modus */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* egal */
    }
  },
};

const state = {
  view: 'loading',
  tab: 'heute',
  backTab: 'heute',
  store: null,
  model: null,
  sel: null,
  demo: !!ls.get(LS.demo),
  demoJournal: {},
  error: null,
  lastFetch: 0,
  syncing: false,
  range: [7, 30, 90].includes(ls.get(LS.range)) ? ls.get(LS.range) : 30,
  animate: true,
  sheet: null,
};

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const sheetEl = document.getElementById('sheet');
const ptrEl = document.getElementById('ptr');

// ------------------------------------------------------------------ Symbole

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  recovery: svg('<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/><path d="M8 12h2l1.5-2.5L13 14l1.5-2H16"/>'),
  sleep: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  strain: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  trends: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  bed: svg('<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14h18"/><path d="M7 10V7h4v3"/><path d="M3 18v2M21 18v2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  journal: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>'),
  run: svg('<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2 1 4"/><path d="M6 12l3-4 5 1 2 4 3 1"/>'),
  bike: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8"/><path d="M9 8h3"/>'),
  lift: svg('<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>'),
  walk: svg('<circle cx="12" cy="4.5" r="1.8"/><path d="M10 21l1.5-6L9 12l1-4 4 1 2 4"/><path d="M14 21l-1-5"/>'),
  swim: svg('<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="7" r="1.8"/><path d="M5 13l5-5 4 3 3-1"/>'),
  act: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
};
const actIcon = (type = '') => {
  if (/run|trail|treadmill/.test(type)) return I.run;
  if (/cycl|bik|ride/.test(type)) return I.bike;
  if (/strength|weight|fitness|hiit|gym/.test(type)) return I.lift;
  if (/walk|hik/.test(type)) return I.walk;
  if (/swim/.test(type)) return I.swim;
  return I.act;
};

// ------------------------------------------------------------------ Formatierung

const pad = (n) => String(n).padStart(2, '0');
const de1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','));
const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString('de-DE'));
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const asDate = (iso) => new Date(iso + 'T12:00:00');
function dayTitle(iso) {
  const t = todayIso();
  if (iso === t) return 'Heute';
  if (iso === E.addDays(t, -1)) return 'Gestern';
  return asDate(iso).toLocaleDateString('de-DE', { weekday: 'long' });
}
const longDate = (iso) => asDate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
const shortDate = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const wdShort = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][E.weekday(iso)];
function ago(ts) {
  if (!ts) return 'unbekannt';
  const min = (Date.now() - new Date(ts).getTime()) / 60000;
  if (min < 1.5) return 'gerade eben';
  if (min < 60) return `vor ${Math.round(min)} Min.`;
  if (min < 60 * 24) return `vor ${Math.round(min / 60)} Std.`;
  return `vor ${Math.round(min / 1440)} Tg.`;
}
const zoneColor = (z) => ({ green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)' })[z] || 'var(--muted)';
const zoneName = (z) => ({ green: 'Grün', yellow: 'Gelb', red: 'Rot' })[z] || '';
const scoreColor = (s) => (s >= 67 ? 'var(--green)' : s >= 34 ? 'var(--yellow)' : 'var(--red)');
const sign = (v, digits = 0) => {
  const txt = Math.abs(v).toFixed(digits);
  const zero = Number(txt) === 0;
  return `${zero ? '±' : v > 0 ? '+' : '−'}${txt.replace('.', ',')}`;
};
const clockDE = (m) => E.fmtClock(m);
const isNum = E.isNum;
const fmtVal = (v, digits) => (digits === 'dur' ? E.fmtDur(v) : digits ? de1(v) : int(v));

const ZONE_TEXT = {
  green: 'Dein Körper ist gut erholt und bereit für Belastung. Ob hartes Training oder ein langer Arbeitstag – heute verkraftest du mehr.',
  yellow: 'Dein Körper ist ausreichend, aber nicht voll erholt. Moderate Belastung ist okay – achte auf Warnzeichen wie schwere Beine oder Müdigkeit.',
  red: 'Dein Körper ist noch mit der Erholung beschäftigt. Heute zahlt sich Ruhe aus: locker bewegen, gut essen, viel trinken, früh schlafen.',
};

let toastTimer = null;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

// ------------------------------------------------------------------ Journal (Morgen-Check)

const journal = () => (state.demo ? state.demoJournal : ls.get(LS.journal, {}));
function saveJournal(date, answers) {
  if (state.demo) {
    state.demoJournal = { ...state.demoJournal, [date]: answers };
  } else {
    ls.set(LS.journal, { ...ls.get(LS.journal, {}), [date]: answers });
  }
}

// ------------------------------------------------------------------ Daten laden

function setStore(store, { animate = true } = {}) {
  const prevDate = state.model && !state.model.empty && state.sel != null ? state.model.days[state.sel]?.date : null;
  const wasLatest = !state.model || state.model.empty || state.sel === state.model.days.length - 1;
  state.store = store;
  state.model = E.analyze(store, ls.get(LS.settings, {}));
  state.lastFetch = Date.now();
  if (state.model.empty) {
    state.view = 'nodata';
  } else {
    const last = state.model.days.length - 1;
    state.sel = wasLatest || prevDate == null || state.model.index[prevDate] == null ? last : state.model.index[prevDate];
    state.view = 'main';
  }
  state.animate = animate;
  render();
}

async function loadData({ silent = false } = {}) {
  if (state.demo) {
    await startDemo();
    return;
  }
  let res;
  try {
    res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  } catch {
    if (!silent) toast('Keine Verbindung – zeige den letzten Stand.');
    if (!state.store) {
      state.view = 'nodata';
      state.error = 'offline';
      render();
    }
    return;
  }
  if (res.status === 404) {
    state.view = 'nodata';
    render();
    return;
  }
  if (!res.ok) {
    if (!silent) toast(`Laden fehlgeschlagen (${res.status}).`);
    return;
  }
  const box = await res.json();
  if (state.store && state.box && state.box.iv === box.iv) {
    state.lastFetch = Date.now();
    if (!silent) render();
    return; // unverändert
  }
  state.box = box;
  await unlock(box, ls.get(LS.pass), { animate: !silent || !state.model });
}

async function unlock(box, passphrase, { animate = true } = {}) {
  try {
    const { data, cache } = await openBox(box, passphrase, ls.get(LS.key));
    ls.set(LS.key, cache);
    if (passphrase) ls.set(LS.pass, passphrase);
    state.error = null;
    setStore(data, { animate });
  } catch (e) {
    if (e.message === 'WRONG_PASSPHRASE') state.error = passphrase && passphrase === ls.get(LS.pass) ? 'changed' : 'wrong';
    state.view = 'lock';
    render();
  }
}

async function startDemo() {
  const { makeDemoStore } = await import('./demo.js');
  const store = makeDemoStore({ now: new Date() });
  state.demo = true;
  state.demoJournal = store.journal || {};
  ls.set(LS.demo, true);
  setStore(store);
}

function stopDemo() {
  state.demo = false;
  ls.del(LS.demo);
  state.store = null;
  state.model = null;
  state.box = null;
  state.view = 'loading';
  state.tab = 'heute';
  render();
  loadData();
}

// ------------------------------------------------------------------ GitHub-Sync per Knopf

function defaultRepo() {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : '';
}
const ghConfig = () => ({ repo: defaultRepo(), branch: 'main', token: '', ...ls.get(LS.gh, {}) });

async function triggerSync(inputs = {}) {
  if (state.demo) {
    toast('Im Demo-Modus gibt es nichts zu synchronisieren.');
    return;
  }
  const gh = ghConfig();
  if (!gh.token || !gh.repo) {
    toast('Richte zuerst in den Einstellungen den Sync-Knopf ein.');
    openSettings();
    return;
  }
  state.syncing = true;
  render();
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: gh.branch || 'main', inputs }),
    });
    if (res.status !== 204) {
      const msg = {
        401: 'GitHub-Token ungültig oder abgelaufen.',
        403: 'Dem Token fehlt die Berechtigung „Actions: Read and write“.',
        404: 'Repo oder Workflow nicht gefunden – stimmt der Repo-Name?',
        422: 'GitHub lehnt den Start ab – stimmt der Branch?',
      }[res.status];
      throw new Error(msg || `GitHub antwortet mit ${res.status}.`);
    }
    toast(inputs.mfa_code ? 'Code gesendet – Anmeldung läuft (1–3 Min.).' : 'Sync gestartet – dauert ca. 1–3 Minuten.');
    const before = state.store?.generated;
    for (let k = 0; k < 20; k++) {
      await new Promise((r) => setTimeout(r, 15000));
      await loadData({ silent: true });
      if (state.store?.generated && state.store.generated !== before) {
        const auth = state.store.status?.auth;
        toast(auth === 'ok' ? 'Neue Daten sind da.' : auth === 'mfa' ? 'Garmin will einen Code – siehe Einstellungen.' : 'Sync fertig, aber Garmin meldet ein Problem.');
        break;
      }
    }
  } catch (e) {
    toast(e.message || 'Sync konnte nicht gestartet werden.');
  } finally {
    state.syncing = false;
    render();
  }
}

async function refresh() {
  if (state.demo) {
    toast('Demo-Daten');
    return;
  }
  if (ghConfig().token) {
    loadData({ silent: true });
    triggerSync();
  } else {
    await loadData({ silent: true });
    toast('Neu geladen.');
  }
}

// ------------------------------------------------------------------ Navigation

const DAY_TABS = ['heute', 'schlaf', 'recovery', 'belastung'];
const TAB_LIST = [
  ['heute', 'Heute', I.home],
  ['schlaf', 'Schlaf', I.sleep],
  ['recovery', 'Recovery', I.recovery],
  ['belastung', 'Belastung', I.strain],
  ['trends', 'Trends', I.trends],
];

function setTab(tab) {
  if (tab === state.tab) return;
  state.tab = tab;
  state.animate = true;
  render();
  window.scrollTo({ top: 0 });
}
function openSettings() {
  if (state.tab !== 'settings') state.backTab = state.tab;
  state.tab = 'settings';
  state.animate = true;
  render();
  window.scrollTo({ top: 0 });
}
function selectDay(i) {
  if (!state.model || i === state.sel || i < 0 || i > state.model.days.length - 1) return;
  state.sel = i;
  state.animate = true;
  render();
}

function renderTabbar() {
  tabbar.hidden = state.view !== 'main';
  tabbar.innerHTML = TAB_LIST.map(
    ([id, label, icon]) => `<button data-tab="${id}" class="${state.tab === id ? 'on' : ''}" aria-label="${label}">${icon}<span>${label}</span></button>`,
  ).join('');
}

// ------------------------------------------------------------------ Rahmen

function syncChip() {
  const st = state.store?.status || {};
  const gen = state.store?.generated;
  const stale = gen && Date.now() - new Date(gen).getTime() > 3 * 3600e3;
  const cls = state.syncing ? 'busy' : st.auth && st.auth !== 'ok' ? 'bad' : stale ? 'warn' : '';
  const text = state.demo ? 'Demo' : state.syncing ? 'Sync …' : ago(gen);
  return `<button class="chip" data-act="refresh" aria-label="Aktualisieren"><span class="dot ${cls}"></span>${esc(text)}</button>`;
}

function weekStrip() {
  const days = state.model.days;
  const last = days.length - 1;
  const end = Math.min(last, Math.max(state.sel + 3, 6));
  const start = Math.max(0, end - 6);
  const cells = [];
  for (let k = start; k <= end; k++) {
    const d = days[k];
    const dot = d.zone ? `class="wdot" style="background:${zoneColor(d.zone)};box-shadow:0 0 8px ${zoneColor(d.zone)}"` : 'class="wdot none"';
    cells.push(`<button class="wd ${k === state.sel ? 'on' : ''}" data-day="${k}" aria-label="${longDate(d.date)}">
      <span class="wn">${wdShort(d.date)}</span><i ${dot}></i><span class="wnum">${Number(d.date.slice(8))}</span></button>`);
  }
  return `<nav class="week">${cells.join('')}</nav>`;
}

function dayHeader() {
  const d = state.model.days[state.sel];
  return `<header class="top">
    <button class="iconbtn" data-act="settings" aria-label="Einstellungen">${I.gear}</button>
    <div class="title center"><div class="day">${dayTitle(d.date)}${state.demo ? '<span class="demo-tag">DEMO</span>' : ''}</div><div class="date">${longDate(d.date)}</div></div>
    ${syncChip()}
  </header>${weekStrip()}`;
}

function simpleHeader(title, back = false) {
  return `<header class="top">
    <button class="iconbtn" data-act="${back ? 'back' : 'settings'}" aria-label="${back ? 'Zurück' : 'Einstellungen'}">${back ? I.back : I.gear}</button>
    <div class="title center"><div class="day">${title}${state.demo ? '<span class="demo-tag">DEMO</span>' : ''}</div></div>
    ${syncChip()}
  </header>`;
}

function statusBanner() {
  if (state.demo) return '';
  const st = state.store?.status || {};
  if (st.auth === 'mfa') {
    return `<button class="banner warn" data-act="settings"><b>Garmin wartet auf deinen Bestätigungscode.</b> Tippe hier und gib ihn ein (innerhalb von 30 Min.).</button>`;
  }
  if (st.auth === 'error') {
    return `<div class="banner bad"><b>Garmin-Anmeldung fehlgeschlagen.</b> Prüfe die Secrets GARMIN_EMAIL und GARMIN_PASSWORD auf GitHub oder starte den Sync in den Einstellungen neu.</div>`;
  }
  const last = state.model.days[state.model.days.length - 1];
  if (state.sel === state.model.days.length - 1 && last.date < todayIso()) {
    return `<div class="banner warn">Die neuesten Daten sind von ${dayTitle(last.date) === 'Gestern' ? 'gestern' : longDate(last.date)}. Öffne die Garmin-Connect-App, damit deine Uhr synchronisiert.</div>`;
  }
  return '';
}

function render() {
  renderTabbar();
  renderSheet();
  const anim = state.animate;
  state.animate = false;
  if (state.view === 'loading') {
    app.innerHTML = '<div class="lock"><div class="spinner"></div></div>';
    return;
  }
  if (state.view === 'lock') {
    app.innerHTML = viewLock();
    return;
  }
  if (state.view === 'nodata') {
    app.innerHTML = state.tab === 'settings' ? simpleHeader('Einstellungen', true) + viewSettings() : viewNoData();
    return;
  }
  const views = { heute: viewToday, schlaf: viewSleep, recovery: viewRecovery, belastung: viewStrain, trends: viewTrends, settings: viewSettings };
  const head = DAY_TABS.includes(state.tab) ? dayHeader() : simpleHeader(state.tab === 'trends' ? 'Trends' : 'Einstellungen', state.tab === 'settings');
  app.innerHTML = `${head}<div class="screen${anim ? ' anim' : ''}">${state.tab === 'heute' ? statusBanner() : ''}${views[state.tab](anim)}</div>`;
  if (anim) animateCounts();
}

function animateCounts() {
  app.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const digits = Number(el.dataset.digits || 0);
    const suffix = el.dataset.suffix || '';
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      const e = 1 - (1 - k) ** 3;
      el.textContent = (target * e).toFixed(digits).replace('.', ',') + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function viewLock() {
  const err = { wrong: 'Das Passwort stimmt nicht.', changed: 'Das Passwort wurde geändert – bitte neu eingeben.' }[state.error] || '';
  return `<form class="lock" data-form="unlock">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Puls</h1>
    <p>Deine Daten sind verschlüsselt. Gib dein Daten-Passwort ein (das Secret <b>DATA_PASSPHRASE</b>). Es bleibt nur auf diesem Gerät.</p>
    <input id="pass" type="password" autocomplete="current-password" placeholder="Daten-Passwort" required>
    ${err ? `<p class="error">${err}</p>` : ''}
    <button class="btn" type="submit">Entsperren</button>
    <button class="linkbtn" type="button" data-act="demo">Erst mal mit Demo-Daten ansehen</button>
  </form>`;
}

function viewNoData() {
  const auth = state.store?.status?.auth;
  const text =
    state.error === 'offline'
      ? 'Keine Verbindung und noch keine gespeicherten Daten.'
      : auth === 'mfa'
        ? 'Garmin hat dir einen Bestätigungscode geschickt. Gib ihn unter „Sync & Garmin-Code“ ein oder starte auf GitHub „Run workflow“ mit dem Code (innerhalb von 30 Min.).'
        : auth === 'error'
          ? 'Die Garmin-Anmeldung ist fehlgeschlagen. Prüfe die Secrets GARMIN_EMAIL und GARMIN_PASSWORD auf GitHub.'
          : 'Noch keine Daten da. Sobald der erste Garmin-Sync gelaufen ist, erscheinen sie hier automatisch.';
  return `<div class="lock">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Puls</h1>
    <p>${text}</p>
    <button class="btn" data-act="reload">Erneut laden</button>
    <button class="btn ghost" data-act="demo">Demo-Daten ansehen</button>
    <button class="linkbtn" data-act="settings">Sync &amp; Garmin-Code</button>
  </div>`;
}

// ------------------------------------------------------------------ Bausteine

const card = (title, body, cls = '') => `<section class="card ${cls}">${title ? `<h2>${title}</h2>` : ''}${body}</section>`;
const insightHtml = (x) => `<div class="insight ${x.tone}"><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div>`;
function tile(k, v, unit = '', s = '') {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
}
function rangeSeg() {
  return `<div class="seg">${[7, 30, 90].map((r) => `<button data-range="${r}" class="${state.range === r ? 'on' : ''}">${r === 7 ? '1 Woche' : r === 30 ? '1 Monat' : '3 Monate'}</button>`).join('')}</div>`;
}
function trendSpan() {
  const i = state.sel;
  const span = state.model.days.slice(Math.max(0, i - state.range + 1), i + 1);
  return { span, labels: span.map((x) => (state.range === 7 ? wdShort(x.date) : shortDate(x.date))), every: state.range === 7 ? 1 : state.range === 30 ? 7 : 21 };
}

function dials(d, anim) {
  return `<section class="rings">
    <button class="ringbox" data-tab="schlaf">${ring({ value: d.perf, max: 100, color: 'var(--sleep)', size: 104, stroke: 9, label: d.perf == null ? '–' : `${Math.round(d.perf)}%`, sub: d.sleepMin ? `${E.fmtDur(d.sleepMin)} Std.` : '', labelSize: 24, count: d.perf == null ? null : Math.round(d.perf), suffix: '%', anim, glow: true })}<span class="cap">Schlaf</span></button>
    <button class="ringbox" data-tab="recovery">${ring({ value: d.recovery, max: 100, color: zoneColor(d.zone), size: 140, stroke: 12, label: d.recovery == null ? '–' : `${d.recovery}%`, sub: d.recovery == null ? 'keine Daten' : zoneName(d.zone), labelSize: 38, count: d.recovery, suffix: '%', anim, glow: true })}<span class="cap">Recovery</span></button>
    <button class="ringbox" data-tab="belastung">${ring({ value: d.strain, max: 21, color: 'var(--strain)', size: 104, stroke: 9, label: de1(d.strain), sub: d.target ? `Ziel ${Math.round(d.target.low)}–${Math.round(d.target.high)}` : '', band: d.target ? [d.target.low, d.target.high] : null, labelSize: 24, count: d.strain, digits: 1, anim, glow: true })}<span class="cap">Strain</span></button>
  </section>`;
}

// ------------------------------------------------------------------ Heute

function viewToday(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const coach = E.buildCoach(m, i);
  const insights = E.buildInsights(m, i, journal());
  const plan = i === m.days.length - 1 ? E.bedtimePlan(m, i) : null;
  return `
    ${dials(d, anim)}
    ${journalCard(d)}
    ${coachCard(coach, d, plan)}
    ${bodyCheckCard(E.vitals(m, i), false)}
    ${dayCard(d)}
    ${statsCard(m, i)}
    ${insights.length ? card('Erkenntnisse', insights.map(insightHtml).join('')) : ''}`;
}

function journalCard(d) {
  if (state.sel === 0) return '';
  const date = E.addDays(d.date, -1);
  const answers = journal()[date];
  const isYesterday = dayTitle(date) === 'Gestern';
  const dayName = isYesterday ? 'gestern' : `am ${longDate(date)}`;
  if (!answers?._done) {
    return `<button class="card journal-cta" data-act="journal" data-date="${date}">
      <span class="ic">${I.journal}</span>
      <span class="jbody"><b>Morgen-Check</b><span>Was war ${dayName}? 10 Sekunden – so lernt Puls, was deine Recovery beeinflusst.</span></span>
      <span class="go">›</span></button>`;
  }
  const yes = E.JOURNAL_QUESTIONS.filter((q) => answers[q.id]).map((q) => q.label);
  return `<button class="card journal-done" data-act="journal" data-date="${date}">
    <span class="ic">${I.check}</span>
    <span class="jbody"><b>Morgen-Check ${isYesterday ? 'für gestern ' : ''}erledigt</b><span>${yes.length ? esc(yes.join(' · ')) : 'Nichts Besonderes'}</span></span>
    <span class="go">Ändern</span></button>`;
}

function coachCard(coach, d, plan) {
  if (coach.state === 'nodata') {
    return card('Coach', `<h3>${esc(coach.headline)}</h3><p class="muted">${esc(coach.text)}</p>${plan ? sleepCoachItem(plan) : ''}`, 'coach');
  }
  const notes = coach.notes.map((n) => `<div class="coach-item"><div class="ic">${I.info}</div><div><p>${esc(n)}</p></div></div>`).join('');
  return `<section class="card coach">
    <h2>Coach</h2>
    <h3 class="zone-${coach.state}">${esc(coach.headline)}</h3>
    <div class="coach-item"><div class="ic" style="color:var(--strain)">${I.strain}</div><div>
      <b>Training · Ziel-Strain <span class="target-pill">${de1(d.target.low)}–${de1(d.target.high)}</span></b>
      <p>${esc(coach.plan)}</p>
      <p class="muted small">${esc(coach.remaining.text)}</p>
    </div></div>
    ${notes}
    ${plan ? sleepCoachItem(plan) : ''}
  </section>`;
}

function sleepCoachItem(plan) {
  const [peak, good] = plan.options;
  return `<div class="coach-item"><div class="ic" style="color:var(--sleep)">${I.bed}</div><div>
    <b>Heute Nacht: ${E.fmtDur(plan.need.total)} Std. Schlaf</b>
    <p>Ins Bett um <b>${clockDE(peak.bed)}</b> für 100 % · spätestens <b>${clockDE(good.bed)}</b> für 85 %.</p>
    <p class="muted small">Gerechnet mit Aufstehen um ${clockDE(plan.wake)}${plan.wakeSource === 'auto' ? ` (dein typischer ${plan.weekend ? 'Wochenend' : 'Werktag'}-Wecker)` : ''}.</p>
  </div></div>`;
}

function bodyCheckCard(v, full) {
  if (!v.items.length) return '';
  const ok = v.outside === 0;
  const title = ok
    ? `${v.measured === v.items.length ? 'Alle ' : ''}${v.measured} Vitalwerte im Normalbereich`
    : `${v.outside} ${v.outside === 1 ? 'Wert' : 'Werte'} außerhalb deines Normalbereichs`;
  const head = `<div class="bc-head ${ok ? 'ok' : 'bad'}"><span class="ic">${ok ? I.check : I.alert}</span>
    <div><b>${title}</b><p class="muted small">Verglichen mit deinen letzten 30 Tagen</p></div></div>`;
  const rows = v.items
    .map((x) => {
      if (x.status === 'na') return `<div class="vital"><span class="vl">${x.label}</span><span class="vv">${fmtVital(x)}</span><span class="vs muted">lernt noch</span></div>`;
      const color = x.bad ? 'var(--red)' : x.status === 'ok' ? 'var(--green)' : 'var(--yellow)';
      const status = x.status === 'ok' ? 'normal' : x.status === 'high' ? 'erhöht' : 'niedrig';
      return full
        ? `<div class="vital full"><span class="vl">${x.label}</span><span class="vv" style="color:${x.bad ? 'var(--red)' : 'inherit'}">${fmtVital(x)}</span>${rangeBar(x.value, x.lo, x.hi, color)}<span class="vr muted">normal ${fmtRange(x)}</span></div>`
        : `<div class="vital"><span class="vl">${x.label}</span><span class="vv">${fmtVital(x)}</span><span class="vs" style="color:${color}">${status}</span></div>`;
    })
    .join('');
  return `<section class="card bodycheck"><h2>Körper-Check</h2>${head}<div class="vitals">${rows}</div></section>`;
}
const fmtVital = (x) => (x.delta ? `${sign(x.value, 1)} ${x.unit}` : `${x.digits ? de1(x.value) : Math.round(x.value)} ${x.unit}`);
const fmtRange = (x) => (x.delta ? `${sign(x.lo, 1)} bis ${sign(x.hi, 1)}` : x.digits ? `${de1(x.lo)}–${de1(x.hi)}` : `${Math.round(x.lo)}–${Math.round(x.hi)}`);

function dayCard(d) {
  const st = d.stats || {};
  const facts = [
    st.steps != null ? `<span><b>${int(st.steps)}</b> Schritte</span>` : '',
    st.kcal != null ? `<span><b>${int(st.kcal)}</b> kcal</span>` : '',
    st.bbHigh != null ? `<span>Body Battery <b>${st.bbHigh}</b>${st.bbNow != null ? ` → <b>${st.bbNow}</b>` : st.bbLow != null ? ` → <b>${st.bbLow}</b>` : ''}</span>` : '',
    st.stress != null ? `<span>Stress Ø <b>${st.stress}</b></span>` : '',
  ].filter(Boolean);
  const acts = d.acts.length ? d.acts.map(actRow).join('') : '<p class="muted small">Noch keine Aktivität aufgezeichnet.</p>';
  return card('Dein Tag', `${acts}${facts.length ? `<div class="facts">${facts.join('')}</div>` : ''}`);
}

function actRow(a) {
  const meta = [a.start, E.fmtDurLong(a.dur / 60), a.dist ? `${(a.dist / 1000).toFixed(1).replace('.', ',')} km` : '', a.avgHr ? `Ø ${a.avgHr} bpm` : '']
    .filter(Boolean)
    .join(' · ');
  return `<div class="act"><div class="ic" style="color:var(--strain)">${actIcon(a.type)}</div>
    <div class="body"><div class="name">${esc(a.name || a.type || 'Aktivität')}</div><div class="meta">${esc(meta)}</div></div>
    <div class="st">${de1(a.strain)}<small>Strain</small></div></div>`;
}

function statsCard(m, i) {
  const partial = m.days[i].date === todayIso();
  const rows = E.keyStats(m, i, { partial });
  if (!rows.length) return '';
  const arrow = (r) => {
    if (!r.trend) return '<span class="arr muted">läuft</span>';
    const cls = r.good == null ? 'muted' : r.good ? 'up' : 'down';
    const sym = r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : '•';
    return `<span class="arr ${cls}">${sym}</span>`;
  };
  return card(
    'Statistiken',
    `<div class="stats">${rows
      .map(
        (r) => `<div class="stat"><span class="sl">${r.label}</span><span class="sv">${fmtVal(r.value, r.digits)}${r.unit ? `<small>${r.unit}</small>` : ''}</span>${arrow(r)}<span class="sb">${r.base == null ? '' : `Ø ${fmtVal(r.base, r.digits)}`}</span></div>`,
      )
      .join('')}</div><p class="muted small" style="margin-top:8px">▲▼ im Vergleich zu deinem 30-Tage-Schnitt · grün = besser</p>`,
  );
}

// ------------------------------------------------------------------ Recovery

function viewRecovery(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const { span, labels, every } = trendSpan();
  const parts = [];
  parts.push(`<section class="hero" style="--glow:${zoneColor(d.zone)}">
    ${ring({ value: d.recovery, max: 100, color: zoneColor(d.zone), size: 200, stroke: 16, label: d.recovery == null ? '–' : `${d.recovery}%`, sub: d.recovery == null ? 'keine Daten' : `Recovery · ${zoneName(d.zone)}`, labelSize: 54, count: d.recovery, suffix: '%', anim, glow: true })}
    <p class="hero-text">${d.recovery == null ? 'Für diesen Tag fehlen die Schlafdaten.' : esc(d.alarm ? 'Mehrere Körperwerte sind auffällig – dein Körper kämpft womöglich gegen einen Infekt oder eine Überlastung. Heute ist Erholung das beste Training.' : ZONE_TEXT[d.zone])}</p>
  </section>`);
  parts.push(factorsCard(d));
  parts.push(bodyCheckCard(E.vitals(m, i), true));
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  parts.push(card('Recovery', bars({ values: span.map((x) => ({ v: x.recovery, color: zoneColor(x.zone) })), labels, every, max: 100, refs: [{ v: 67, color: 'var(--grid)', dash: true }, { v: 34, color: 'var(--grid)', dash: true }] })));
  parts.push(
    card(
      'HRV',
      `${lines({
        series: [
          { values: span.map((x) => x.hrv), color: 'var(--sleep)', width: 1.2, opacity: 0.5, dots: state.range <= 30 },
          { values: span.map((x) => x.hrv7), color: 'var(--sleep)', width: 2.5 },
        ],
        band: { lo: span.map((x) => x.hrvNormal?.[0] ?? null), hi: span.map((x) => x.hrvNormal?.[1] ?? null) },
        labels,
        every,
        unit: 'ms',
      })}<div class="legend"><span>● Nacht</span><span>— 7-Tage-Schnitt</span><span><i style="background:var(--band)"></i>Normalbereich</span></div>`,
    ),
  );
  parts.push(
    card(
      'Ruhepuls',
      `${lines({ series: [{ values: span.map((x) => x.rhr), color: 'var(--red)', width: 1.2, opacity: 0.55, dots: state.range <= 30 }, { values: span.map((x) => x.rhr3), color: 'var(--red)', width: 2.5 }], labels, every, unit: 'bpm' })}
      <div class="legend"><span>● Tag</span><span>— 3-Tage-Schnitt</span></div>`,
    ),
  );
  if (span.some((x) => x.resp != null)) {
    parts.push(card('Atemfrequenz (Nacht)', lines({ series: [{ values: span.map((x) => x.resp), color: 'var(--strain)', width: 2, dots: state.range <= 30 }], labels, every, unit: '/Min.' })));
  }
  parts.push(influencesCard(m, 5));
  return parts.join('');
}

function factorsCard(d) {
  if (!d.comps.length) return '';
  const rows = d.comps
    .map((c) => {
      if (c.key === 'hrv') {
        const delta = 100 * (c.value / c.ref - 1);
        return factor('HRV', `${Math.round(c.value)} ms`, `Normal: ${Math.round(c.ref)} ms · <span class="${delta >= 0 ? 'up' : 'down'}">${sign(delta)} %</span>`, c.score, '50 %');
      }
      if (c.key === 'rhr') {
        const delta = c.value - c.ref;
        return factor('Ruhepuls', `${Math.round(c.value)} bpm`, `Normal: ${de1(c.ref)} bpm · <span class="${delta <= 0 ? 'up' : 'down'}">${sign(delta, 1)}</span>`, c.score, '20 %');
      }
      return factor('Schlaf', `${Math.round(d.perf)} %`, `${E.fmtDur(c.value)} von ${E.fmtDur(c.ref)} Std. Bedarf · Qualität ${Math.round(c.quality)}`, c.score, '30 %');
    })
    .join('');
  const pens = d.penalties
    .map((p) =>
      p.key === 'resp'
        ? factor('Atemfrequenz', `${de1(d.resp)} /Min.`, `<span class="down">${sign(p.delta, 1)} über normal → −${Math.round(p.points)} Punkte</span>`, null)
        : factor('Hauttemperatur', `${sign(p.delta, 1)} °C`, `<span class="down">erhöht → −${Math.round(p.points)} Punkte</span>`, null),
    )
    .join('');
  const calib = d.base.calibrating ? `<p class="muted small" style="margin-top:8px">Kalibrierung: ${d.base.hrvDays} von 14 Nächten mit HRV.</p>` : '';
  return card(d.recovery == null ? 'Beiträge' : `Woraus deine ${d.recovery} % bestehen`, `${rows}${pens}${calib}`);
}

function factor(name, val, cmp, score, weight = '') {
  return `<div class="factor"><div class="name">${name}${weight ? ` <span class="w">${weight}</span>` : ''}</div><div class="val">${val}</div><div class="cmp">${cmp}</div>
    ${score == null ? '' : `<div class="meter"><i style="width:${Math.round(score)}%;background:${scoreColor(score)}"></i></div>`}</div>`;
}

function influencesCard(m, limit = Infinity) {
  const imp = E.journalImpacts(m, journal());
  const solid = imp.filter((x) => !x.pending);
  const pending = imp.filter((x) => x.pending);
  const inf = m.influences;
  const items = [];
  for (const x of solid) {
    items.push(`<div class="impact"><div class="iname">${esc(x.label)}${x.solid ? '' : ' <span class="w">vorläufig</span>'}</div>
      ${impactBar(x.diff)}<div class="ival ${x.diff >= 0 ? 'up' : 'down'}">${sign(x.diff)}</div>
      <div class="cmp">Recovery am Morgen danach: ${Math.round(x.yes)} % statt ${Math.round(x.no)} % (${x.ny} vs. ${x.nn} Tage)</div></div>`);
  }
  for (const x of inf.ready ? inf.items : []) {
    items.push(`<div class="impact"><div class="iname">${esc(x.title)}</div>${impactBar(x.diff)}<div class="ival ${x.diff >= 0 ? 'up' : 'down'}">${sign(x.diff)}</div>
      <div class="cmp">${esc(x.text)} (${x.na} vs. ${x.nb} Tage)</div></div>`);
  }
  const more = items.length > limit ? `<button class="linkbtn" data-tab="trends">Alle ${items.length} Einflüsse ansehen ›</button>` : '';
  items.splice(limit);
  const hint = pending.length
    ? `<p class="muted small" style="margin-top:8px">Noch zu wenig Morgen-Checks für: ${pending.map((x) => esc(x.label)).join(', ')}. Ab 3 Tagen mit und ohne erscheint der Effekt.</p>`
    : '';
  const empty = !items.length
    ? '<p class="muted">Beantworte jeden Morgen den Morgen-Check. Nach ein paar Wochen zeigt Puls hier, was deine Recovery wirklich hebt oder senkt.</p>'
    : '';
  return card(
    'Was deine Recovery beeinflusst',
    `${empty}${items.join('')}${more}${hint}<p class="muted small" style="margin-top:8px">Prozentpunkte Recovery im Schnitt · Zusammenhänge in deinen Daten, kein Beweis für Ursachen.</p>`,
  );
}

function impactBar(diff) {
  const w = Math.min(50, Math.abs(diff) * 1.4);
  const style = diff >= 0 ? `left:50%;width:${w}%;background:var(--green)` : `left:${50 - w}%;width:${w}%;background:var(--red)`;
  return `<span class="ib"><i style="${style}"></i><u></u></span>`;
}

// ------------------------------------------------------------------ Schlaf

function viewSleep(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const s = d.sleep;
  const isLatest = i === m.days.length - 1;
  const parts = [];

  if (s) {
    parts.push(`<section class="hero" style="--glow:var(--sleep)">
      ${ring({ value: d.perf, max: 100, color: 'var(--sleep)', size: 184, stroke: 15, label: `${Math.round(d.perf)}%`, sub: 'Performance', labelSize: 48, count: Math.round(d.perf), suffix: '%', anim, glow: true })}
      <div class="hero-stats">
        <div><span>${E.fmtDur(d.sleepMin)}</span><small>geschlafen</small></div>
        <div><span>${E.fmtDur(d.need.total)}</span><small>Bedarf</small></div>
        <div><span>${isNum(s.bed) ? clockDE(s.bed) : '–'}</span><small>Beginn</small></div>
        <div><span>${isNum(s.wake) ? clockDE(s.wake) : '–'}</span><small>Ende</small></div>
      </div></section>`);
  } else {
    parts.push(card('', '<h3>Keine Schlafdaten für diese Nacht</h3><p class="muted">Synchronisiere deine Uhr in der Garmin-Connect-App.</p>'));
  }

  parts.push(isLatest ? tonightCard(E.bedtimePlan(m, i)) : card('Bedarf in dieser Nacht', needRows(d.need)));
  if (s?.levels?.length) parts.push(card('Schlafphasen', hypnogram(s.levels, s.bed, clockDE)));
  if (s) parts.push(stagesCard(d));
  if (s) {
    const t = [];
    if (d.restorative != null) t.push(tile('Erholsam', E.fmtDur(d.restorative), 'Std.', `Tief + REM · ${Math.round((100 * d.restorative) / d.sleepMin)} %`));
    if (d.eff != null) t.push(tile('Effizienz', Math.round(d.eff * 100), '%', 'Schlaf ÷ Zeit im Bett'));
    if (d.consistency != null) t.push(tile('Konstanz', d.consistency, '%', `±${Math.round((d.sdBed + d.sdWake) / 2)} Min.`));
    if (d.debt7 != null) t.push(tile('Schlafschuld', E.fmtDur(d.debt7), 'Std.', 'letzte 7 Nächte'));
    if (s.score != null) t.push(tile('Garmin-Score', s.score));
    if (s.awakeCount != null) t.push(tile('Wachphasen', s.awakeCount));
    if (s.resp != null) t.push(tile('Atemfrequenz', de1(s.resp), '/Min.'));
    if (s.stress != null) t.push(tile('Schlafstress', Math.round(s.stress)));
    if (s.bb != null) t.push(tile('Body Battery', sign(s.bb), '', 'über Nacht'));
    parts.push(card('Kennzahlen', `<div class="grid">${t.join('')}</div>`));
  }

  const { span, labels, every } = trendSpan();
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  parts.push(
    card(
      'Schlafdauer und Bedarf',
      `${bars({
        values: span.map((n) => ({ v: n.sleepMin != null ? n.sleepMin / 60 : null, color: n.perf == null ? 'var(--track)' : n.perf >= 85 ? 'var(--sleep)' : n.perf >= 70 ? 'var(--yellow)' : 'var(--red)' })),
        line: span.map((n) => n.need.total / 60),
        labels,
        every,
        min: 0,
        unit: 'Std.',
      })}<div class="legend"><span><i style="background:var(--sleep)"></i>≥ 85 %</span><span><i style="background:var(--yellow)"></i>70–84 %</span><span><i style="background:var(--red)"></i>&lt; 70 %</span><span>— Bedarf</span></div>`,
    ),
  );
  const win = span.slice(-14);
  parts.push(card('Schlafenszeiten', sleepWindows(win.map((n) => ({ bed: n.sleep?.bed ?? null, wake: n.sleep?.wake ?? null, label: state.range === 7 ? wdShort(n.date) : shortDate(n.date) })), clockDE)));
  return parts.join('');
}

function needRows(need) {
  const row = (k, v) => `<div class="need-row"><span>${k}</span><span class="num">${v}</span></div>`;
  return [
    row('Basisbedarf', `${E.fmtDur(need.base)} Std.`),
    need.strain >= 1 ? row('+ Belastung am Vortag', `${Math.round(need.strain)} Min.`) : '',
    need.debt >= 1 ? row('+ Schlafschuld', `${Math.round(need.debt)} Min.`) : '',
    need.recovery ? row('+ Erholung (rote Recovery)', `${need.recovery} Min.`) : '',
    `<div class="need-row total"><span>Bedarf</span><span class="num">${E.fmtDur(need.total)} Std.</span></div>`,
  ].join('');
}

function tonightCard(plan) {
  return `<section class="card"><h2>Schlafplaner · heute Nacht</h2>
    <div class="bedtimes">${plan.options
      .map((o, k) => `<div class="bedtime ${k === 0 ? 'main' : ''}"><div class="l">${o.label}</div><div class="t">${clockDE(o.bed)}</div><div class="l">${E.fmtDur(o.sleepMin)} Std.</div></div>`)
      .join('')}</div>
    <p class="muted small" style="margin:10px 0">Uhrzeit = ins Bett gehen, um ${clockDE(plan.wake)} aufzustehen${plan.wakeSource === 'auto' ? ` (dein typischer ${plan.weekend ? 'Wochenend' : 'Werktag'}-Wecker)` : ''}. Optimal deckt 100 % deines Bedarfs, Gut 85 %, Minimum 70 %.</p>
    ${needRows(plan.need)}
  </section>`;
}

function stagesCard(d) {
  const s = d.sleep;
  const rows = [
    ['Tief', d.stages.deep, 'var(--deep)', [13, 23], s.deep],
    ['REM', d.stages.rem, 'var(--rem)', [20, 25], s.rem],
    ['Leicht', d.stages.light, 'var(--light)', [45, 60], s.light],
  ]
    .filter((r) => r[1] != null)
    .map(
      ([name, p, color, [lo, hi], secs]) => `<div class="stage"><span>${name}</span>
        <div class="bar"><u style="left:${lo}%;width:${hi - lo}%"></u><i style="width:${Math.min(100, p)}%;background:${color}"></i></div>
        <span class="pv">${Math.round(p)} % · ${E.fmtDur(secs / 60)}</span></div>`,
    )
    .join('');
  const awake = s.awake != null ? `<p class="muted small" style="margin-top:6px">Wach: ${Math.round(s.awake / 60)} Min. · Heller Bereich = Normalbereich.</p>` : '';
  return card('Phasen', rows + awake);
}

// ------------------------------------------------------------------ Belastung

function viewStrain(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const S = m.settings;
  const zones = E.hrZones(d.rhrRef, S.maxHr);
  const coach = E.buildCoach(m, i);
  const colors = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
  const parts = [];

  parts.push(`<section class="hero" style="--glow:var(--strain)">
    ${ring({ value: d.strain, max: 21, color: 'var(--strain)', size: 184, stroke: 15, label: de1(d.strain), sub: 'Strain von 21', band: d.target ? [d.target.low, d.target.high] : null, labelSize: 48, count: d.strain, digits: 1, anim, glow: true })}
    <div class="hero-stats three">
      <div><span>${d.stats?.kcal != null ? int(d.stats.kcal) : '–'}</span><small>kcal</small></div>
      <div><span>${d.stats?.steps != null ? int(d.stats.steps) : '–'}</span><small>Schritte</small></div>
      <div><span>${d.zoneMin ? d.zoneMin[1] + d.zoneMin[2] + d.zoneMin[3] + d.zoneMin[4] : '–'}</span><small>Min. ab Zone 2</small></div>
    </div></section>`);

  parts.push(
    card(
      'Strain-Coach',
      `${d.target ? `<div class="row between"><span class="muted small">Optimaler Strain heute</span><span class="target-pill">${de1(d.target.low)}–${de1(d.target.high)}</span></div>${strainGauge(d.strain, d.target)}` : '<p class="muted small">Ohne Recovery kein Zielbereich.</p>'}
      ${coach.remaining ? `<p class="small">${esc(coach.remaining.text)}</p>` : ''}
      ${coach.plan ? `<div class="sep"></div><p class="small">${esc(coach.plan)}</p>` : ''}`,
    ),
  );

  if (d.acts.length) parts.push(card('Aktivitäten', d.acts.map(actRow).join('')));

  const series = d.raw.hr?.series;
  if (series?.length > 5) {
    parts.push(card('Puls im Tagesverlauf', `${hrCurve(series, zones, colors)}<div class="legend">${zones.map((z, k) => `<span><i style="background:${colors[k]}"></i>Z${z.zone}</span>`).join('')}</div>`));
  }
  if (d.zoneMin && d.zoneMin.every((v) => v === 0)) {
    parts.push(card('Zeit in Pulszonen', `<p class="muted small">Noch keine Minute ab Zone 1 (${zones[0].lo} bpm). Zügiges Gehen zählt meist schon dazu.</p>`));
  } else if (d.zoneMin) {
    const max = Math.max(1, ...d.zoneMin);
    parts.push(
      card(
        'Zeit in Pulszonen',
        `${zones.map((z, k) => `<div class="zonebar"><span>Z${z.zone}</span><div class="bar"><i style="width:${(100 * d.zoneMin[k]) / max}%;background:${colors[k]}"></i></div><span class="m">${d.zoneMin[k]} Min.</span></div>`).join('')}
        <p class="muted small" style="margin-top:8px">${zones.map((z) => `Z${z.zone} ${z.lo}–${z.hi}`).join(' · ')} bpm (Max-Puls ${S.maxHr}, Ruhepuls ${d.rhrRef})</p>`,
      ),
    );
  }

  let loadText = '<p class="muted small">Für die Trainingslast braucht es mindestens 14 Tage Daten.</p>';
  if (d.load) {
    const r = d.load.ratio;
    const [label, color] = r > 1.5 ? ['Belastungsspitze', 'var(--red)'] : r > 1.3 ? ['Steigt schnell', 'var(--yellow)'] : r >= 0.8 ? ['Optimal', 'var(--green)'] : ['Erholungsphase', 'var(--strain)'];
    const pos = Math.max(0, Math.min(100, ((r - 0.4) / 1.4) * 100));
    loadText = `<div class="row between"><div><div class="muted small">Akut ÷ chronisch (7 ÷ 28 Tage)</div><div class="bignum">${r.toFixed(2).replace('.', ',')}</div></div>
      <div style="color:${color};font-weight:750">${label}</div></div>
      <div class="acwr"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i><b style="left:${pos}%"></b></div>
      <div class="acwr-l"><span>0,4</span><span>0,8</span><span>1,3</span><span>1,5</span><span>1,8</span></div>
      <p class="muted small" style="margin-top:8px">Optimal sind 0,8–1,3. Darüber steigt das Risiko für Verletzungen und Infekte.</p>`;
  }
  parts.push(card('Trainingslast', loadText));

  const { span, labels, every } = trendSpan();
  const avg7 = span.map((x) => {
    const w = m.days.slice(Math.max(0, x.i - 6), x.i + 1).map((y) => y.strain).filter(isNum);
    return w.length >= 3 ? E.mean(w) : null;
  });
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  parts.push(card('Strain', `${bars({ values: span.map((x) => ({ v: x.strain, color: 'var(--strain)' })), line: avg7, labels, every, max: 21 })}<div class="legend"><span><i style="background:var(--strain)"></i>Strain je Tag</span><span>— 7-Tage-Schnitt</span></div>`));
  return parts.join('');
}

// ------------------------------------------------------------------ Trends

function viewTrends() {
  const m = state.model;
  const last = m.days.length - 1;
  const w = E.weeklyAssessment(m, last);
  const c = w.current;
  const p = w.previous;
  const parts = [];

  const row = (name, cur, prev, fmt, better, fmtDelta = (v) => sign(v, Math.abs(v) < 10 ? 1 : 0)) => {
    if (cur == null) return '';
    const delta = prev == null ? null : cur - prev;
    const good = delta == null || Math.abs(delta) < 1e-9 ? '' : (delta > 0) === better ? 'up' : 'down';
    return `<tr><td>${name}</td><td>${fmt(cur)}</td><td class="muted">${prev == null ? '–' : fmt(prev)}</td><td class="${good}">${delta == null ? '' : fmtDelta(delta)}</td></tr>`;
  };
  parts.push(`<section class="card"><h2>Wochenbericht</h2>
    <div class="verdict ${w.verdict.tone}">${esc(w.verdict.label)}</div>
    <p style="margin:10px 0">${esc(w.verdict.text)}</p>
    <ul class="bullets">${w.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    <table class="cmp-table"><tr><th></th><th>7 Tage</th><th>davor</th><th>Δ</th></tr>
      ${row('Recovery', c.recovery, p.recovery, (v) => `${Math.round(v)} %`, true)}
      ${row('HRV', c.hrv, p.hrv, (v) => `${Math.round(v)} ms`, true)}
      ${row('Ruhepuls', c.rhr, p.rhr, (v) => `${de1(v)}`, false)}
      ${row('Schlaf', c.sleep, p.sleep, (v) => `${E.fmtDur(v)}`, true, (v) => `${v >= 0 ? '+' : ''}${E.fmtDur(v)}`)}
      ${row('Strain', c.strain, p.strain, (v) => de1(v), true)}
    </table>
    <p class="muted small" style="margin-top:8px">Tage: <span style="color:var(--green)">${c.green} grün</span> · <span style="color:var(--yellow)">${c.yellow} gelb</span> · <span style="color:var(--red)">${c.red} rot</span></p>
  </section>`);

  parts.push(calendarCard(m));
  parts.push(influencesCard(m));
  parts.push(journalListCard(m));

  const span = m.days.slice(Math.max(0, last - 89));
  const labels = span.map((x) => shortDate(x.date));
  parts.push(
    card(
      'HRV · 3 Monate',
      `${lines({ series: [{ values: span.map((x) => x.hrv7), color: 'var(--sleep)', width: 2.5 }], band: { lo: span.map((x) => x.hrvNormal?.[0] ?? null), hi: span.map((x) => x.hrvNormal?.[1] ?? null) }, labels, every: 21, unit: 'ms' })}
      <div class="legend"><span>— 7-Tage-Schnitt</span><span><i style="background:var(--band)"></i>Normalbereich</span></div>`,
    ),
  );
  const weeks = [];
  for (let k = last; k >= 0 && weeks.length < 13; k -= 7) weeks.unshift(m.days.slice(Math.max(0, k - 6), k + 1));
  const wavg = (f) =>
    weeks.map((wk) => {
      const v = wk.map(f).filter(isNum);
      return v.length ? E.mean(v) : null;
    });
  const wl = weeks.map((wk) => shortDate(wk[0].date));
  parts.push(card('Wochenschnitt Recovery', bars({ values: wavg((x) => x.recovery).map((v) => ({ v, color: v == null ? 'var(--track)' : scoreColor(v) })), labels: wl, every: 3, max: 100 })));
  parts.push(card('Wochenschnitt Schlaf', bars({ values: wavg((x) => (x.sleepMin == null ? null : x.sleepMin / 60)).map((v) => ({ v, color: 'var(--sleep)' })), labels: wl, every: 3, min: 0, unit: 'Std.' })));
  parts.push(card('Wochenschnitt Strain', bars({ values: wavg((x) => x.strain).map((v) => ({ v, color: 'var(--strain)' })), labels: wl, every: 3, max: 21 })));
  return parts.join('');
}

function calendarCard(m) {
  const last = m.days.length - 1;
  const lastDate = m.days[last].date;
  const offset = (E.weekday(lastDate) + 6) % 7; // Mo = 0
  const total = 5 * 7;
  const startDate = E.addDays(lastDate, -(total - 7 + offset));
  const cells = [];
  for (let k = 0; k < total; k++) {
    const date = E.addDays(startDate, k);
    if (date > lastDate) {
      cells.push('<span class="cal empty"></span>');
      continue;
    }
    const idx = m.index[date];
    if (idx == null) {
      cells.push(`<span class="cal none"><span>${Number(date.slice(8))}</span></span>`);
      continue;
    }
    const d = m.days[idx];
    const bg = d.zone ? ` style="--z:${zoneColor(d.zone)}"` : '';
    cells.push(`<button class="cal ${d.zone ? 'z' : 'none'} ${idx === state.sel ? 'on' : ''}" data-goto="${idx}"${bg}><span>${Number(date.slice(8))}</span>${d.recovery != null ? `<small>${d.recovery}</small>` : ''}</button>`);
  }
  return card(
    'Kalender',
    `<div class="calgrid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((x) => `<span class="calh">${x}</span>`).join('')}${cells.join('')}</div>
    <p class="muted small" style="margin-top:8px">Kleine Zahl = Recovery. Antippen öffnet den Tag.</p>`,
  );
}

function journalListCard(m) {
  const j = journal();
  const last = m.days.length - 1;
  const rows = [];
  for (let k = last - 1; k >= Math.max(0, last - 7); k--) {
    const date = m.days[k].date;
    const a = j[date];
    const yes = a?._done ? E.JOURNAL_QUESTIONS.filter((q) => a[q.id]).map((q) => q.label) : null;
    rows.push(`<button class="jrow" data-act="journal" data-date="${date}"><span class="jd">${wdShort(date)} ${shortDate(date)}</span>
      <span class="jt ${yes ? '' : 'muted'}">${yes ? esc(yes.join(' · ') || 'Nichts Besonderes') : 'offen – antippen'}</span><span class="go">›</span></button>`);
  }
  return card('Morgen-Check · letzte Tage', rows.join(''));
}

// ------------------------------------------------------------------ Morgen-Check (Sheet)

function renderSheet() {
  if (!state.sheet) {
    sheetEl.innerHTML = '';
    sheetEl.hidden = true;
    return;
  }
  const { date } = state.sheet;
  const answers = journal()[date] || {};
  const dayName = dayTitle(date) === 'Gestern' ? 'gestern' : `am ${longDate(date)}`;
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<div class="backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-label="Morgen-Check">
      <div class="grab"></div>
      <h3>Morgen-Check</h3>
      <p class="muted">Was trifft auf ${dayName} zu? Antippen, was passt.</p>
      <div class="qchips">${E.JOURNAL_QUESTIONS.map((q) => `<button class="qchip ${answers[q.id] ? 'on' : ''}" data-q="${q.id}">${esc(q.label)}</button>`).join('')}</div>
      <button class="btn" data-act="sheet-save">Speichern</button>
      <button class="btn ghost" data-act="sheet-none">Nichts davon</button>
    </div>`;
}

function closeSheet() {
  state.sheet = null;
  renderSheet();
}

sheetEl.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-q]');
  if (chip) {
    chip.classList.toggle('on');
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'sheet-close') closeSheet();
  if (t.dataset.act === 'sheet-save' || t.dataset.act === 'sheet-none') {
    const answers = { _done: true };
    if (t.dataset.act === 'sheet-save') sheetEl.querySelectorAll('.qchip.on').forEach((c) => (answers[c.dataset.q] = true));
    saveJournal(state.sheet.date, answers);
    closeSheet();
    render();
    toast('Gespeichert – danke!');
  }
});

// ------------------------------------------------------------------ Einstellungen

function viewSettings() {
  const m = state.model;
  const S = m && !m.empty ? m.settings : E.resolveSettings(ls.get(LS.settings, {}), state.store?.profile || {}, []);
  const user = ls.get(LS.settings, {});
  const gh = ghConfig();
  const st = state.store?.status || {};
  const authText = { ok: 'verbunden', mfa: 'wartet auf Bestätigungscode', error: 'Anmeldung fehlgeschlagen' }[st.auth] || 'unbekannt';
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;

  return `
  <section class="card"><h2>Synchronisation</h2>
    <p class="small">Letzter Abgleich: <b>${state.demo ? 'Demo' : ago(state.store?.generated)}</b> · Garmin: <b>${authText}</b></p>
    <p class="muted small" style="margin:6px 0 12px">Automatisch morgens alle 20 Min., tagsüber stündlich. In der App jederzeit: oben nach unten ziehen.</p>
    <button class="btn" data-act="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Sync läuft …' : 'Jetzt synchronisieren'}</button>
    <button class="btn ghost" data-act="reload">Nur neu laden</button>
    <div class="sep"></div>
    <label class="field"><span>Garmin-Code (nur wenn Garmin einen schickt)</span><input id="mfa" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></label>
    <button class="btn ghost" data-act="mfa">Code an Garmin senden</button>
    <div class="sep"></div>
    <details ${gh.token ? '' : 'open'}><summary>Sync-Knopf einrichten</summary>
      <p>Damit der Knopf funktioniert, braucht die App einen GitHub-Token, der nur den Sync starten darf (Anleitung im README, Schritt 6).</p>
      <label class="field" style="margin-top:10px"><span>Repo</span><input id="gh-repo" type="text" autocapitalize="off" spellcheck="false" placeholder="name/puls" value="${esc(gh.repo)}"></label>
      <label class="field"><span>Token</span><input id="gh-token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(gh.token)}"></label>
      <button class="btn ghost" data-act="save-gh">Speichern</button>
    </details>
  </section>

  <section class="card"><h2>Über dich</h2>
    <div class="fields2">
      <label class="field"><span>Geschlecht</span><select data-setting="sex">${opt('', `Auto: ${S.sex === 'female' ? 'weiblich' : 'männlich'}`, user.sex || '')}${opt('male', 'männlich', user.sex)}${opt('female', 'weiblich', user.sex)}</select></label>
      <label class="field"><span>Geburtsjahr</span><input data-setting="birthYear" type="number" inputmode="numeric" min="1930" max="2015" placeholder="${S.birthYear || 'z. B. 1990'}" value="${user.birthYear || ''}"></label>
      <label class="field"><span>Max-Puls</span><input data-setting="maxHr" type="number" inputmode="numeric" min="140" max="230" placeholder="auto: ${S.maxHrAuto}" value="${user.maxHr || ''}"></label>
      <label class="field"><span>Schlafbedarf (Std.)</span><input data-setting="sleepNeedH" type="number" inputmode="decimal" step="0.25" min="6" max="10" placeholder="auto: ${String(Math.round((S.sleepNeedAuto / 60) * 4) / 4).replace('.', ',')}" value="${user.sleepNeed ? user.sleepNeed / 60 : ''}"></label>
      <label class="field"><span>Weckzeit</span><input data-setting="wakeTime" type="time" value="${user.wakeTime || ''}"></label>
      <label class="field"><span>Hauptsport</span><select data-setting="sport">${Object.entries(E.SPORTS).map(([k, v]) => opt(k, v, S.sport)).join('')}</select></label>
    </div>
    <p class="muted small">Leer lassen = automatisch aus deinen Garmin-Daten. Weckzeit leer = dein üblicher Wecker (Werktag/Wochenende getrennt).</p>
  </section>

  <section class="card"><h2>Morgen-Check sichern</h2>
    <p class="small">Deine Morgen-Check-Antworten liegen nur auf diesem iPhone. Sichere sie ab und zu, z. B. in Notizen.</p>
    <button class="btn ghost" data-act="journal-export" style="margin-top:10px">Antworten kopieren</button>
    <button class="btn ghost" data-act="journal-import">Antworten einfügen</button>
  </section>

  <section class="card"><h2>So rechnet Puls</h2>
    <details><summary>Recovery (0–100 %)</summary>
      <p>Jeden Morgen aus deiner letzten Nacht im Vergleich zu deinen letzten 30 Tagen:</p>
      <ul><li><b>HRV 50 %</b> – logarithmisch, als Abweichung in Standardabweichungen.</li><li><b>Ruhepuls 20 %</b> – niedriger als normal ist besser.</li><li><b>Schlaf 30 %</b> – 70 % Schlafperformance (geschlafen ÷ Bedarf) + 30 % Qualität (Garmin-Score).</li></ul>
      <p>Abzüge bei erhöhter Atemfrequenz (ab +0,7/Min.) oder Hauttemperatur (ab +0,5 °C). Grün ab 67 %, Gelb ab 34 %, darunter Rot. In den ersten 14 Nächten nutzt Puls teilweise Garmins HRV-Normalbereich.</p></details>
    <details><summary>Strain (0–21)</summary>
      <p>Aus deinem Tagespuls wird die Herz-Kreislauf-Belastung nach Banister (TRIMP) berechnet: Minuten × Anteil der Herzfrequenzreserve, exponentiell gewichtet. Die Skala ist logarithmisch – von 18 auf 19 ist viel mehr Arbeit als von 8 auf 9. Typisch: Ruhetag 4–8, normales Training 10–14, sehr hart 17+.</p></details>
    <details><summary>Strain-Coach</summary>
      <p>Mitte = 5,5 + 0,125 × Recovery, Bereich ±1,5. Liegt deine 7-Tage-Last über 130 % (bzw. 150 %) deines 4-Wochen-Schnitts, sinkt das Ziel um 1 (bzw. 2). Hast du zuletzt wenig trainiert (unter 80 %) und bist erholt, steigt es um 1. Bei Warnsignalen höchstens 7.</p></details>
    <details><summary>Schlafbedarf und Schlafplaner</summary>
      <p>Basis (dein Wert, Garmins Wert oder 8 Std.) + 4 Min. je Strain-Punkt über 10 am Vortag + ein Teil des Defizits der letzten 3 Nächte (30/15/5 %, max. 60 Min.) + 15 Min. nach roter Recovery.</p>
      <p>Schlafenszeit = Weckzeit − Bedarf ÷ deine Schlafeffizienz − 10 Min. zum Einschlafen.</p></details>
    <details><summary>Körper-Check</summary>
      <p>Normalbereich = dein 30-Tage-Schnitt ± 1,5 Standardabweichungen (Atemfrequenz und SpO₂ ± 2). Rot wird nur, was in die ungünstige Richtung abweicht.</p></details>
    <details><summary>Morgen-Check und Einflüsse</summary>
      <p>Verhalten an einem Tag wird mit der Recovery am nächsten Morgen verglichen: Tage mit gegen Tage ohne. Ab 3 Tagen je Gruppe erscheint ein vorläufiger Effekt, ab 5 ein belastbarer.</p></details>
    <details><summary>Warnsignale</summary>
      <p>Ruhepuls mind. 3 bpm (und 1,5 Standardabweichungen) über normal, HRV 1,5 Standardabweichungen darunter, Atemfrequenz +1/Min., Hauttemperatur +0,5 °C. Ab zwei Signalen gleichzeitig warnt Puls vor Infekt oder Überlastung.</p></details>
    <p class="muted small" style="margin-top:10px">Puls ist kein Medizinprodukt. Bei Beschwerden zum Arzt.</p>
  </section>

  <section class="card"><h2>Gerät</h2>
    ${state.demo ? '<button class="btn" data-act="demo-off">Demo beenden</button>' : '<button class="btn ghost" data-act="demo">Demo-Daten ansehen</button>'}
    <button class="btn ghost" data-act="reset-settings">Einstellungen zurücksetzen</button>
    <button class="btn danger" data-act="logout">Abmelden (Passwort hier löschen)</button>
    <p class="muted small" style="margin-top:10px">Puls ${VERSION} · Daten werden nur auf diesem Gerät entschlüsselt.</p>
  </section>`;
}

function saveSetting(el) {
  const user = ls.get(LS.settings, {});
  const key = el.dataset.setting;
  const v = el.value.trim();
  if (key === 'sleepNeedH') {
    const h = Number(v.replace(',', '.'));
    if (v && h >= 5 && h <= 11) user.sleepNeed = Math.round(h * 60);
    else delete user.sleepNeed;
  } else if (['birthYear', 'maxHr'].includes(key)) {
    if (v && Number(v) > 0) user[key] = Number(v);
    else delete user[key];
  } else if (v) user[key] = v;
  else delete user[key];
  ls.set(LS.settings, user);
  if (state.store) state.model = E.analyze(state.store, user);
  render();
  toast('Gespeichert – Werte neu berechnet.');
}

// ------------------------------------------------------------------ Ereignisse

app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab],[data-range],[data-day],[data-goto]');
  if (!t) return;
  if (t.dataset.tab) {
    setTab(t.dataset.tab);
    return;
  }
  if (t.dataset.day) {
    selectDay(Number(t.dataset.day));
    return;
  }
  if (t.dataset.goto) {
    state.sel = Number(t.dataset.goto);
    state.tab = 'heute';
    state.animate = true;
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  if (t.dataset.range) {
    state.range = Number(t.dataset.range);
    ls.set(LS.range, state.range);
    render();
    return;
  }
  switch (t.dataset.act) {
    case 'refresh':
      refresh();
      break;
    case 'settings':
      openSettings();
      break;
    case 'back':
      setTab(state.view === 'main' ? state.backTab || 'heute' : 'heute');
      break;
    case 'journal':
      state.sheet = { date: t.dataset.date };
      renderSheet();
      break;
    case 'reload':
      state.error = null;
      await loadData();
      if (state.view === 'main') toast('Neu geladen.');
      break;
    case 'demo':
      startDemo();
      break;
    case 'demo-off':
      stopDemo();
      break;
    case 'sync':
      triggerSync();
      break;
    case 'mfa': {
      const code = document.getElementById('mfa')?.value.trim();
      if (!/^\d{4,8}$/.test(code || '')) toast('Bitte den Code aus der Garmin-E-Mail eingeben.');
      else triggerSync({ mfa_code: code });
      break;
    }
    case 'save-gh': {
      const repo = document.getElementById('gh-repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      const token = document.getElementById('gh-token').value.trim();
      ls.set(LS.gh, { ...ls.get(LS.gh, {}), repo, token });
      toast('Gespeichert.');
      render();
      break;
    }
    case 'journal-export': {
      const text = JSON.stringify(ls.get(LS.journal, {}));
      try {
        await navigator.clipboard.writeText(text);
        toast('Kopiert – füge es z. B. in Notizen ein.');
      } catch {
        prompt('Diesen Text kopieren:', text);
      }
      break;
    }
    case 'journal-import': {
      const text = prompt('Gesicherte Antworten hier einfügen:');
      if (!text) break;
      try {
        const data = JSON.parse(text);
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Format');
        ls.set(LS.journal, { ...ls.get(LS.journal, {}), ...data });
        toast(`${Object.keys(data).length} Tage übernommen.`);
        render();
      } catch {
        toast('Das sieht nicht nach gesicherten Antworten aus.');
      }
      break;
    }
    case 'reset-settings':
      ls.del(LS.settings);
      if (state.store) state.model = E.analyze(state.store, {});
      render();
      toast('Zurückgesetzt.');
      break;
    case 'logout':
      if (confirm('Passwort und Schlüssel auf diesem Gerät löschen? Deine Morgen-Check-Antworten bleiben.')) {
        ls.del(LS.pass);
        ls.del(LS.key);
        ls.del(LS.demo);
        state.demo = false;
        state.store = null;
        state.model = null;
        state.box = null;
        state.view = 'loading';
        state.tab = 'heute';
        render();
        loadData();
      }
      break;
    default:
  }
});

tabbar.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) setTab(t.dataset.tab);
});

app.addEventListener('change', (e) => {
  if (e.target.matches('[data-setting]')) saveSetting(e.target);
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.dataset.form === 'unlock') {
    const pass = document.getElementById('pass').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Entschlüssle …';
    if (!state.box) await loadData();
    if (state.box) await unlock(state.box, pass);
  }
});

// Gesten: links/rechts wischen = Tag wechseln, oben nach unten ziehen = aktualisieren
let touch = null;
app.addEventListener(
  'touchstart',
  (e) => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, top: window.scrollY <= 0, pull: 0 } : null;
  },
  { passive: true },
);
app.addEventListener(
  'touchmove',
  (e) => {
    if (!touch || !touch.top || state.view !== 'main') return;
    const dy = e.touches[0].clientY - touch.y;
    const dx = Math.abs(e.touches[0].clientX - touch.x);
    if (dy > 0 && dy > dx) {
      touch.pull = dy;
      const p = Math.min(1, dy / 90);
      ptrEl.style.opacity = String(p);
      ptrEl.style.transform = `translate(-50%, ${Math.min(dy, 110) * 0.6}px) rotate(${p * 270}deg)`;
      ptrEl.classList.toggle('ready', dy > 90);
    }
  },
  { passive: true },
);
app.addEventListener(
  'touchend',
  (e) => {
    if (!touch) return;
    const t = touch;
    touch = null;
    ptrEl.style.opacity = '0';
    ptrEl.style.transform = 'translate(-50%, 0)';
    ptrEl.classList.remove('ready');
    if (t.pull > 90) {
      refresh();
      return;
    }
    if (state.view !== 'main' || !DAY_TABS.includes(state.tab)) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
    selectDay(dx > 0 ? state.sel - 1 : state.sel + 1);
  },
  { passive: true },
);

// Daten nachziehen, sobald die App wieder geöffnet wird
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.view === 'main' && !state.demo && Date.now() - state.lastFetch > 2 * 60e3) {
    loadData({ silent: true });
  }
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.view === 'main' && !state.demo && !state.syncing) loadData({ silent: true });
}, 10 * 60e3);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Für den Selbsttest (tests/live_check.mjs): nur Anzahlen, keine Werte
window.__puls = {
  summary() {
    const m = state.model;
    if (!m || m.empty) return { view: state.view, status: state.store?.status || null, days: 0 };
    const count = (f) => m.days.filter(f).length;
    return {
      view: state.view,
      status: state.store?.status || null,
      days: m.days.length,
      latestIsToday: m.days[m.days.length - 1].date === todayIso(),
      sleep: count((d) => d.sleep),
      sleepTimes: count((d) => d.sleep?.bed != null),
      levels: count((d) => d.sleep?.levels?.length),
      hrv: count((d) => d.hrv != null),
      rhr: count((d) => d.rhr != null),
      resp: count((d) => d.resp != null),
      hist: count((d) => Array.isArray(d.raw.hr?.hist)),
      series: count((d) => d.raw.hr?.series?.length),
      stats: count((d) => d.stats?.steps != null),
      acts: m.days.reduce((s, d) => s + d.acts.length, 0),
      recovery: count((d) => d.recovery != null),
      strain: count((d) => d.strain != null),
      zones: { green: count((d) => d.zone === 'green'), yellow: count((d) => d.zone === 'yellow'), red: count((d) => d.zone === 'red') },
      influencesReady: m.influences.ready,
      profile: Object.keys(m.profile || {}),
    };
  },
};

render();
loadData();
