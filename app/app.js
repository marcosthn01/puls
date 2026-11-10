// Puls – Oberfläche. Lädt data.enc.json, entschlüsselt sie auf dem Gerät und zeigt die Auswertung.

import * as E from './engine.js';
import { arcGauge, bars, esc, hrCurve, hypnogram, innerOrb, lines, rangeBar, ring, sleepWindows, strainGauge, orb, startOrbs } from './charts.js';
import { openBox } from './crypto.js';
import * as Coach from './coach.js';
import * as Hud from './hud.js';
import * as T from './training.js';
import * as Life from './lifestyle.js';
import { widgetScript } from './widget.js';

const VERSION = '5.5.0';
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
  onboarded: 'puls.onboarded',
  lastTrigger: 'puls.lastTrigger',
  push: 'puls.push',
  setupHidden: 'puls.setupHidden',
  pushPrefs: 'puls.pushPrefs',
  profile: 'puls.profile',
  customQ: 'puls.customQ',
  goals: 'puls.goals',
  reportAuto: 'puls.reportAuto',
  theme: Hud.THEME_KEY,
  splits: 'puls.splits',
  feel: 'puls.feel',
};

const PUSH_KINDS = [
  ['morning', 'Recovery am Morgen', 'sobald deine Nacht da ist'],
  ['midday', 'Bewegung & Stress', 'mittags, wenn du wenig gelaufen bist oder Stress hast'],
  ['afternoon', 'Trainingsziel', 'nachmittags: was bis zum Ziel fehlt'],
  ['steps', 'Schritte', 'früher Abend: fehlende Schritte oder „geschafft“'],
  ['bedtime', 'Schlafenszeit', 'kurz bevor du ins Bett solltest'],
  ['weekly', 'Woche', 'freitags Wochenziel, sonntags Wochenbericht'],
  ['pad', 'Walking-Pad', 'kurze Bestätigung nach dem Laufen'],
];

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

// Darstellung: „Premium“ (Standard) oder „Sci-Fi“
document.documentElement.dataset.theme = Hud.themeFor(ls.get(LS.theme, 'premium'));

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
  onboarding: null,
  showAllInsights: false,
  chat: { busy: false, stream: null, status: '', error: '' },
  sync: null, // { t0, stage } während eines Abrufs
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
  coach: svg('<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>'),
  trends: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
  bed: svg('<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14h18"/><path d="M7 10V7h4v3"/><path d="M3 18v2M21 18v2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  journal: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>'),
  sync: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  run: svg('<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2 1 4"/><path d="M6 12l3-4 5 1 2 4 3 1"/>'),
  bike: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8"/><path d="M9 8h3"/>'),
  lift: svg('<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>'),
  walk: svg('<circle cx="12" cy="4.5" r="1.8"/><path d="M10 21l1.5-6L9 12l1-4 4 1 2 4"/><path d="M14 21l-1-5"/>'),
  swim: svg('<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="7" r="1.8"/><path d="M5 13l5-5 4 3 3-1"/>'),
  act: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  drop: svg('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
  coffee: svg('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 1 1.2 1 2.2M11.5 3.5c0 1 1 1.2 1 2.2"/>'),
  fork: svg('<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M11 3v8a2 2 0 0 1-2 2"/><path d="M17 21V3c-2 1-3 3.5-3 6.5V13h3"/>'),
  steth: svg('<path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M10 12v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>'),
  bowl: svg('<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c1-2 3-2 4-3M13 7c.5-1.3 2-1.8 3-2.5"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>'),
  watch: svg('<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  steps: svg('<path d="M7 16c-1.6 0-2.5-1.3-2.5-3.2S5.6 7 7.4 7 9.6 9.3 9.4 11.4 8.6 16 7 16z"/><path d="M5.3 18.5h3.4"/><path d="M16.6 13c1.6 0 2.5-1.3 2.5-3.2S18 4 16.2 4 14 6.3 14.2 8.4 15 13 16.6 13z"/><path d="M14.9 15.5h3.4"/>'),
  stress: svg('<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l3.5-4.5"/><path d="M4 19h16"/>'),
  flame: svg('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.2 3.4-8.3.9 1.8 2 2.8 3.1 3.3.4-2.3 1.4-4.4 3.5-6.3.4 3.3 3 5.5 3 10.3 0 4-2.9 7.2-6.5 7.2z"/>'),
  wine: svg('<path d="M8 3h8l-.4 5.2a3.6 3.6 0 0 1-7.2 0z"/><path d="M12 11.8V20"/><path d="M8.5 20.5h7"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  sauna: svg('<path d="M3 20h18"/><path d="M5 20v-4h14v4"/><path d="M8 12.5c-1.2-1.3 1.2-2.4 0-3.8M12 12.5c-1.2-1.3 1.2-2.4 0-3.8M16 12.5c-1.2-1.3 1.2-2.4 0-3.8"/>'),
  cold: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.6 12 7l2.4-2.4M9.6 19.4 12 17l2.4 2.4"/>'),
  lotus: svg('<circle cx="12" cy="5.5" r="2"/><path d="M12 8.5v5"/><path d="M7 13.5l5-2 5 2"/><path d="M4.5 18.5c2.4-1 4.8-1.6 7.5-1.6s5.1.6 7.5 1.6"/>'),
  nap: svg('<path d="M3 19v-5.5h18V19"/><path d="M3 13.5V9.5"/><path d="M7 13.5a2 2 0 1 1 0-.1"/><path d="M13.5 4h4l-4 4.5h4"/>'),
  pill: svg('<path d="M10.2 20.3a4.5 4.5 0 0 1-6.4-6.4l10-10a4.5 4.5 0 0 1 6.4 6.4z"/><path d="M8.8 8.8l6.4 6.4"/>'),
  bag: svg('<rect x="3.5" y="7" width="17" height="12.5" rx="2.2"/><path d="M9 7V5h6v2"/><path d="M3.5 12.5h17"/>'),
  thermo: svg('<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9.5v6"/>'),
  meal: svg('<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M11 3v8a2 2 0 0 1-2 2"/><path d="M15.5 21v-8.5"/><path d="M15.5 3c2.2 1.2 3 3.5 3 6s-1 3.5-3 3.5"/>'),
  custom: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  lungs: svg('<path d="M12 4v8"/><path d="M12 12c-1.5-1-3-1-3 1v5c0 1.7-1.6 2.5-3 1.8C4.7 19.2 4 17.8 4 16v-3.5C4 9 6 7 8 7c1.6 0 2.5 1.6 2.5 3"/><path d="M12 12c1.5-1 3-1 3 1v5c0 1.7 1.6 2.5 3 1.8 1.3-.6 2-2 2-3.8v-3.5C20 9 18 7 16 7c-1.6 0-2.5 1.6-2.5 3"/>'),
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
const zoneHex = (z) => ({ green: '#16ec06', yellow: '#ffde00', red: '#ff0026' })[z] || '#8b9198';
const HEX = { sleep: '#7ba1bb', strain: '#0093e7' };
/** Ring mit schwebender Kugel im Inneren. */
const orbRing = (ringSvg, hex, px = 120, co = null) => {
  const core = `<div class="ringorb">${Hud.hudDeco(hex)}${innerOrb(hex, px)}${ringSvg}</div>`;
  if (!co) return core;
  const { left, right } = Hud.callouts(co);
  return `<div class="ringstage"><div class="hco l">${left}</div>${core}<div class="hco r">${right}</div></div>`;
};
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
  green: 'Gut erholt – heute verkraftest du viel.',
  yellow: 'Halbwegs erholt – moderate Belastung ist okay.',
  red: 'Noch in der Erholung – heute ruhig angehen.',
};

/** Kurze Erklärungen für die (i)-Knöpfe. */
const INFO = {
  life: ['Lifestyle', 'Tippe ein Symbol an, wenn es passiert – Kaffee, Alkohol, spätes Essen, Sauna … Puls merkt sich die Uhrzeit und vergleicht deine Nächte danach: Recovery, HRV, Ruhepuls und Tiefschlaf mit gegen ohne. Ab 3 Nächten je Seite siehst du deinen persönlichen Effekt; bei Kaffee auch deine Uhrzeit-Grenze, bei Alkohol die Wirkung nach Menge. Alles bleibt auf deinem iPhone.'],
  training: ['Training heute', 'Puls lernt aus deinen Garmin-Aktivitäten der letzten 6 Wochen, was du trainierst (z. B. Gym im Push/Pull-Wechsel und Rad), wie lange du fährst und mit welchem Puls. Daraus und aus Recovery, HRV-Trend, Schlaf, Trainingslast und Infekt-Zeichen wird die Empfehlung: Rad mit Dauer und Puls, Gym mit Volumen und Wiederholungen in Reserve. Benenne deine Gym-Einheiten in Garmin „Push“ und „Pull“ – oder tippe es einmal hier an.'],
  illness: ['Infekt-Frühwarnung', 'Vergleicht jede Nacht Ruhepuls, HRV, Atemfrequenz und Hauttemperatur mit deinem eigenen Normalwert der letzten 6 Wochen. Studien mit Wearables zeigen: Ruhepuls und Atmung steigen oft 1–3 Tage vor den ersten Symptomen. Mehrere auffällige Werte, zwei Nächte in Folge oder dein Gefühl „angeschlagen“ erhöhen die Stufe. Ab „erhöht“ zeigt Puls nie volle Recovery an. Eine Schätzung, keine Diagnose.'],
  recovery: ['Recovery', 'Wie erholt dein Körper heute ist (0–100 %). Grün = bereit für harte Belastung, Gelb = moderat, Rot = Erholung. Berechnet aus HRV, Ruhepuls und Schlaf – verglichen mit deinen letzten 30 Tagen.'],
  strain: ['Strain', 'Wie stark du Herz und Kreislauf heute belastest (0–21). Der äußere Bogen ist dein Tagesziel – passend zu deiner Recovery. Ab 14 ist ein harter Tag, ab 18 sehr hart.'],
  sleep: ['Schlaf', 'Wie viel deines Schlafbedarfs du geschafft hast. Dein Bedarf steigt nach harten Tagen und wenn dir Schlaf fehlt. Der Schlafplaner sagt dir, wann du ins Bett solltest.'],
  hrv: ['HRV', 'Herzfrequenzvariabilität: wie flexibel dein Herzschlag ist, gemessen im Schlaf. Höher als normal = gut erholt. Niedriger = Stress, Infekt, Alkohol oder Ermüdung.'],
  body: ['Körper-Check', 'Prüft jede Nacht HRV, Ruhepuls, Atemfrequenz und Blutsauerstoff gegen deinen persönlichen Normalbereich. Mehrere auffällige Werte zugleich deuten oft auf einen Infekt hin.'],
  stress: ['Stress & Body Battery', 'Garmin schätzt deinen Stress über den Tag aus der HRV (0–100). Body Battery ist deine Energiereserve: Schlaf lädt sie, Belastung und Stress leeren sie.'],
  age: ['Puls-Alter', 'Eine Schätzung, wie alt dein Körper wirkt – aus Fitness (VO₂max), Ruhepuls, Schlaf und Bewegung der letzten 30 Tage. Jeder Faktor zählt nur ein paar Jahre. Kein medizinischer Wert.'],
  load: ['Trainingslast', 'Deine Belastung der letzten 7 Tage im Vergleich zu den letzten 28. Zwischen 0,8 und 1,3 machst du Fortschritte, darüber steigt das Verletzungsrisiko.'],
  pad: ['Walking-Pad', 'Schritte von deinem Walking-Pad (PitPat → Apple Health → Kurzbefehl). Wenn du am Schreibtisch läufst, zählt die Uhr kaum mit, weil der Arm still bleibt. Puls zieht ab, was die Uhr in der Zeit schon gezählt hat, und addiert nur den Rest. So zählt nichts doppelt.'],
  report: ['Dein Tagesbericht', 'Jeden Morgen schaut sich der KI-Coach (Claude) alle deine Werte an – wie ein Arzt, Trainer und Ernährungscoach zusammen: Recovery, Schlaf, Trends der letzten Wochen, deinen Morgen-Check und deine Angaben (Ziel, Gesundheit, Essen). Daraus wird ein persönlicher Plan für heute. Kostet ca. 5–15 Cent pro Bericht über deinen Claude-Schlüssel. Keine ärztliche Diagnose.'],
  nutrition: ['Ernährung heute', 'Dein Tagesbedarf aus deinem echten Garmin-Verbrauch der letzten 2 Wochen, angepasst an die Belastung von heute und dein Ziel. Eiweiß je nach Ziel 1,4–2,0 g pro kg, Kohlenhydrate 3–7 g pro kg je nach Strain (harte Tage brauchen mehr), Fett mindestens 0,8 g pro kg. Wasser: 35 ml pro kg plus 0,6 L pro Trainingsstunde. Richtwerte, keine Diät.'],
  health: ['Gesundheits-Check', 'Wie ein Arzt auf Trends schaut: Der Schnitt deiner letzten 7 Tage wird mit deinen eigenen Werten der 2 Monate davor verglichen – Ruhepuls, HRV, Atemfrequenz, Schlaf, Schlafrhythmus, Blutsauerstoff, Bewegung und VO₂max. Einzelne schlechte Nächte sind normal; wichtig sind Veränderungen über Tage. Bei Hinweisen der Stufe „Arzt“ bitte ärztlich abklären lassen.'],
  journal: ['Morgen-Check', 'Tippe jeden Morgen an, was gestern war (z. B. Alkohol, spätes Essen). Nach ein paar Wochen zeigt Puls, was deine Recovery wirklich hebt oder senkt.'],
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

const profile = () => ls.get(LS.profile, {});
const lifeIcon = (id) => I[Life.byId[id]?.icon] || I.custom;
const extraQ = () => questions().filter((q) => q.id.startsWith('c_'));
const lifeInsights = () => Life.lifestyleInsights(state.model, journal(), extraQ());
const splitLabels = () => ({ ...(state.store?.labels || {}), ...ls.get(LS.splits, {}) });
const feelOn = (date) => (ls.get(LS.feel, {})?.date === date ? 'sick' : null);
const reportExtra = () => (feelOn(state.model.days[state.model.days.length - 1].date) ? 'krank' : '');
const planFor = (i) => T.trainingPlan(state.model, i, { labels: splitLabels(), feel: feelOn(state.model.days[i].date), journal: journal() });
const questions = () => E.journalQuestions(ls.get(LS.customQ, []));
const journal = () => (state.demo ? state.demoJournal : ls.get(LS.journal, {}));
function saveJournal(date, answers) {
  if (state.demo) state.demoJournal = { ...state.demoJournal, [date]: answers };
  else ls.set(LS.journal, { ...ls.get(LS.journal, {}), [date]: answers });
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
    if (!ls.get(LS.onboarded) && state.onboarding == null) state.onboarding = 0;
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
  if (res.headers.get('x-puls-stale') === '1' && !silent) {
    // Netz war zu langsam: erst den letzten Stand zeigen, dann gleich frisch nachladen
    setTimeout(() => loadData({ silent: true }), 5000);
  }
  const box = await res.json();
  if (state.store && state.box && state.box.iv === box.iv) {
    state.lastFetch = Date.now();
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
    const fresh = state.store && data.generated !== state.store.generated;
    setStore(data, { animate });
    if (fresh && state.syncing) toast('Aktualisiert.');
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

// ------------------------------------------------------------------ GitHub: Sync auslösen

function defaultRepo() {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : '';
}
const ghConfig = () => ({ repo: defaultRepo(), branch: 'main', token: '', ...ls.get(LS.gh, {}) });
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

async function dispatch(inputs = {}) {
  const gh = ghConfig();
  const own = ls.get(LS.splits, {});
  if (Object.keys(own).length && inputs.labels == null) inputs = { ...inputs, labels: JSON.stringify(own) };
  const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: ghHeaders(gh.token),
    body: JSON.stringify({ ref: gh.branch || 'main', inputs }),
  });
  if (res.status !== 204) {
    const msg = {
      401: 'GitHub-Schlüssel ungültig oder abgelaufen.',
      403: 'Dem GitHub-Schlüssel fehlt „Actions: Read and write“.',
      404: 'Repo nicht gefunden – beim Schlüssel „puls“ ausgewählt?',
      422: 'GitHub lehnt den Start ab.',
    }[res.status];
    throw new Error(msg || `GitHub antwortet mit ${res.status}.`);
  }
}

/** Startet den Garmin-Abruf und lädt nach, sobald neue Daten da sind. */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const SYNC_STAGES = [
  ['Garmin-Daten holen', 'Garmin wird abgefragt'],
  ['Benachrichtigungen', 'Wird ausgewertet'],
  ['Morgenwache starten', 'Wird ausgewertet'],
  ['Zwischenspeicher sichern', 'Wird bereitgestellt'],
  ['Seite bauen', 'Wird bereitgestellt'],
  ['upload-pages-artifact', 'Wird bereitgestellt'],
  ['Veröffentlichen', 'Wird bereitgestellt'],
];

/** Den gerade gestarteten Abruf bei GitHub finden bzw. seinen Stand holen (nur kleine Antworten). */
async function ghRun(gh, { since, id }) {
  const base = `https://api.github.com/repos/${gh.repo}/actions`;
  if (id) {
    const res = await fetch(`${base}/runs/${id}`, { headers: ghHeaders(gh.token), cache: 'no-store' });
    return res.ok ? res.json() : null;
  }
  const res = await fetch(`${base}/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`, { headers: ghHeaders(gh.token), cache: 'no-store' });
  if (!res.ok) return null;
  const runs = (await res.json()).workflow_runs || [];
  return runs.find((r) => new Date(r.created_at).getTime() >= since - 20000) || null;
}
async function ghStage(gh, run) {
  if (run.status !== 'in_progress') return 'GitHub startet den Abruf';
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/runs/${run.id}/jobs`, { headers: ghHeaders(gh.token), cache: 'no-store' });
    const job = res.ok ? ((await res.json()).jobs || []).find((j) => j.name === 'sync') : null;
    const step = job?.steps?.find((st) => st.status === 'in_progress');
    if (!job || job.status === 'queued') return 'GitHub startet den Abruf';
    const hit = step && SYNC_STAGES.find(([k]) => step.name.includes(k));
    return hit ? hit[1] : 'Wird vorbereitet';
  } catch {
    return state.sync?.stage || 'Läuft';
  }
}

/** Abruf starten und bis zum Ende verfolgen: Stufe und Sekunden sichtbar, Fehler werden gemeldet. */
async function triggerSync(inputs = {}, { quiet = false } = {}) {
  if (state.demo || state.syncing) return;
  const gh = ghConfig();
  if (!gh.token || !gh.repo) {
    if (!quiet) openSheet({ type: 'setup-sync' });
    return;
  }
  state.syncing = true;
  state.sync = { t0: Date.now(), stage: 'GitHub startet den Abruf' };
  ls.set(LS.lastTrigger, Date.now());
  renderChrome();
  const ticker = setInterval(updateSyncBanner, 1000);
  const before = state.store?.generated;
  const arrived = () => state.store?.generated && state.store.generated !== before;
  try {
    await dispatch(inputs);
    if (!quiet) toast(inputs.mfa_code ? 'Code gesendet – Anmeldung läuft.' : 'Hole neue Daten von Garmin …');
    let run = null;
    let apiOk = true;
    for (let k = 0; k < 80 && !arrived(); k++) {
      await sleepMs(k < 4 ? 2000 : 3000);
      if (apiOk) {
        try {
          run = await ghRun(gh, run ? { id: run.id } : { since: state.sync.t0 });
        } catch {
          run = null;
        }
        if (!run && k >= 8) apiOk = false; // GitHub-API nicht erreichbar: nur noch nach Daten schauen
      }
      if (run?.status === 'completed') {
        // Fertig: Daten holen (GitHub Pages braucht manchmal ein paar Sekunden)
        state.sync.stage = 'Fast fertig';
        updateSyncBanner();
        for (let j = 0; j < 8 && !arrived(); j++) {
          await loadData({ silent: true });
          if (!arrived()) await sleepMs(3000);
        }
        if (run.conclusion !== 'success' && !arrived()) {
          if (!quiet || run.conclusion === 'failure') toast('Der Abruf hat nicht geklappt – zieh nach unten, um es nochmal zu versuchen.');
        } else if (run.conclusion !== 'success') {
          toast('Garmin hat nicht alles geliefert – du siehst den letzten Stand.');
        }
        break;
      }
      if (run) {
        state.sync.stage = await ghStage(gh, run);
        updateSyncBanner();
      }
      // Ohne GitHub-API alle ~9 s nach Daten schauen, sonst nur alle ~30 s zur Sicherheit
      if ((!apiOk && k % 3 === 2) || k % 10 === 9) await loadData({ silent: true });
    }
    if (arrived()) {
      const auth = state.store.status?.auth;
      if (auth === 'mfa') toast('Garmin will einen Code – siehe Einstellungen.');
      else if (auth === 'error') toast('Garmin meldet ein Anmeldeproblem.');
    }
  } catch (e) {
    if (!quiet) toast(e.message || 'Sync konnte nicht gestartet werden.');
  } finally {
    clearInterval(ticker);
    state.syncing = false;
    state.sync = null;
    renderChrome();
  }
}

/** Morgens, wenn die Nacht noch fehlt: auf den Abruf der Morgenwache achten und dann sofort laden. */
let nightTimer = null;
function nightMissing() {
  const m = state.model;
  if (state.demo || !m || m.empty || state.view !== 'main') return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 4 * 60 || mins >= 12 * 60 + 30) return false;
  const last = m.days[m.days.length - 1];
  return !(last.date === todayIso() && last.sleep);
}
function watchNight() {
  if (nightTimer) return;
  let seen = null;
  nightTimer = setInterval(async () => {
    if (!nightMissing()) {
      clearInterval(nightTimer);
      nightTimer = null;
      return;
    }
    if (document.visibilityState !== 'visible' || state.syncing) return;
    const gh = ghConfig();
    if (!gh.token) return loadData({ silent: true });
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/workflows/${WORKFLOW}/runs?per_page=1&status=completed`, { headers: ghHeaders(gh.token), cache: 'no-store' });
      const run = res.ok ? ((await res.json()).workflow_runs || [])[0] : null;
      if (run && seen && run.id !== seen) await loadData({ silent: true });
      if (run) seen = run.id;
    } catch {
      /* nächstes Mal */
    }
  }, 30000);
}

function autoSync() {
  if (state.demo || state.view !== 'main' || state.syncing || !ghConfig().token) return;
  const age = Date.now() - new Date(state.store?.generated || 0).getTime();
  if (age < 5 * 60e3 || Date.now() - ls.get(LS.lastTrigger, 0) < 3 * 60e3) return;
  triggerSync({}, { quiet: true });
}

async function refresh() {
  if (state.demo) return toast('Demo-Daten');
  if (ghConfig().token) {
    ls.del(LS.lastTrigger);
    triggerSync();
  } else {
    await loadData({ silent: true });
    toast('Neu geladen.');
  }
}

// ------------------------------------------------------------------ Benachrichtigungen

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const pushReady = () => !!ls.get(LS.push) && typeof Notification !== 'undefined' && Notification.permission === 'granted';

function b64urlToBytes(s) {
  const pad2 = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad2).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    toast(isStandalone() ? 'Dein iPhone unterstützt das noch nicht (ab iOS 16.4).' : 'Öffne Puls dafür vom Home-Bildschirm aus.');
    return;
  }
  if (!ghConfig().token) {
    openSheet({ type: 'setup-sync' });
    toast('Zuerst „Automatisch aktualisieren“ einrichten.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Benachrichtigungen wurden nicht erlaubt.');
    return;
  }
  try {
    const res = await fetch(`push.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Puls ist dafür noch nicht bereit – nach dem nächsten Abruf erneut versuchen.');
    const { publicKey } = await res.json();
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && ls.get(LS.push)?.publicKey !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
    await dispatch({ push_subscription: JSON.stringify({ subscription: sub, settings: ls.get(LS.settings, {}), prefs: ls.get(LS.pushPrefs, {}) }) });
    ls.set(LS.push, { publicKey, at: Date.now() });
    closeSheet();
    render();
    toast('Fertig – in ca. 1 Minute kommt eine Test-Nachricht.');
  } catch (e) {
    toast(e.message || 'Hat nicht geklappt.');
  }
}

// ------------------------------------------------------------------ Navigation

const DAY_TABS = ['heute', 'schlaf', 'recovery', 'belastung'];
const TAB_LIST = [
  ['heute', 'Heute', I.home],
  ['schlaf', 'Schlaf', I.sleep],
  ['recovery', 'Recovery', I.recovery],
  ['belastung', 'Strain', I.strain],
  ['coach', 'Coach', I.coach],
];

function setTab(tab) {
  if (tab === state.tab) return;
  if (!['trends', 'settings'].includes(tab)) state.backTab = tab;
  else if (!['trends', 'settings'].includes(state.tab)) state.backTab = state.tab;
  state.tab = tab;
  state.animate = true;
  render();
  window.scrollTo({ top: 0 });
  if (tab === 'coach') scrollChat();
}
function selectDay(i) {
  if (!state.model || i === state.sel || i < 0 || i > state.model.days.length - 1) return;
  state.sel = i;
  state.animate = true;
  render();
}

function renderTabbar() {
  tabbar.hidden = state.view !== 'main' || state.onboarding != null;
  tabbar.innerHTML = TAB_LIST.map(([id, label, icon]) => `<button data-tab="${id}" class="${state.tab === id ? 'on' : ''}" aria-label="${label}">${icon}<span>${label}</span></button>`).join('');
}

// ------------------------------------------------------------------ Rahmen

function syncChip() {
  const st = state.store?.status || {};
  const gen = state.store?.generated;
  const stale = gen && Date.now() - new Date(gen).getTime() > 3 * 3600e3;
  const cls = state.syncing ? 'busy' : st.auth && st.auth !== 'ok' ? 'bad' : stale ? 'warn' : '';
  const text = state.demo ? 'Demo' : state.syncing ? 'Aktualisiere …' : ago(gen);
  return `<button class="chip sync" id="syncchip" data-act="refresh" aria-label="Aktualisieren">${esc(text)}<span class="wchip">${I.watch}<span class="dot ${cls}"></span></span></button>`;
}
/** Nur den Sync-Status neu zeichnen (ohne die Seite neu aufzubauen, z. B. während des Chats). */
function renderChrome() {
  if (state.tab === 'heute' && state.view === 'main') return render();
  const chip = document.getElementById('syncchip');
  if (chip) chip.outerHTML = syncChip();
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
    cells.push(`<button class="wd ${k === state.sel ? 'on' : ''}" data-day="${k}" aria-label="${longDate(d.date)}"><span class="wn">${wdShort(d.date)}</span><i ${dot}></i><span class="wnum">${Number(d.date.slice(8))}</span></button>`);
  }
  return `<nav class="week">${cells.join('')}</nav>`;
}

function dayHeader() {
  const d = state.model.days[state.sel];
  const last = state.model.days.length - 1;
  return `<header class="top v4">
    <button class="avatar" data-act="settings" aria-label="Einstellungen">${I.user}</button>
    <div class="datepill">
      <button data-act="day-prev" aria-label="Vorheriger Tag" ${state.sel <= 0 ? 'disabled' : ''}>${I.back}</button>
      <span><b>${dayTitle(d.date)}</b>${state.demo ? '<i class="demo-tag">DEMO</i>' : ''}</span>
      <button data-act="day-next" aria-label="Nächster Tag" ${state.sel >= last ? 'disabled' : ''}>${I.chevron}</button>
    </div>
    ${syncChip()}
  </header>${weekStrip()}`;
}

function simpleHeader(title, back = false, right = null) {
  return `<header class="top v4 simple">
    ${back ? `<button class="avatar plain" data-act="back" aria-label="Zurück">${I.back}</button>` : `<button class="avatar" data-act="settings" aria-label="Einstellungen">${I.user}</button>`}
    <div class="ptitle">${title}${state.demo ? '<i class="demo-tag">DEMO</i>' : ''}</div>
    ${right ?? syncChip()}
  </header>`;
}

const syncLabel = () => `${state.sync?.stage || 'Hole neue Daten von Garmin'} …`;
function syncSecs() {
  const s = Math.max(0, Math.round((Date.now() - (state.sync?.t0 || Date.now())) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Nur Text und Sekunden im Abruf-Hinweis auffrischen (ohne die Seite neu aufzubauen). */
function updateSyncBanner() {
  const el = document.getElementById('syncbanner');
  if (!el || !state.sync) return;
  el.querySelector('.sb-t').textContent = syncLabel();
  el.querySelector('.sb-s').textContent = syncSecs();
}

function statusBanner() {
  if (state.demo) return '';
  if (state.syncing) return `<div class="banner sync" id="syncbanner"><span class="spinner small"></span><span class="sb-t">${esc(syncLabel())}</span><span class="sb-s">${syncSecs()}</span></div>`;
  const st = state.store?.status || {};
  if (st.auth === 'mfa') return `<button class="banner warn" data-act="settings"><b>Garmin wartet auf einen Code.</b> Tippe hier, um ihn einzugeben.</button>`;
  if (st.auth === 'error') return `<button class="banner bad" data-act="settings"><b>Garmin-Anmeldung fehlgeschlagen.</b> Tippe für Hilfe.</button>`;
  const last = state.model.days[state.model.days.length - 1];
  if (state.sel === state.model.days.length - 1 && nightMissing()) {
    watchNight();
    const auto = ghConfig().token
      ? pushReady()
        ? 'Puls schaut alle 3 Minuten nach und schickt dir eine Mitteilung, sobald sie da ist.'
        : 'Puls schaut alle 3 Minuten nach – sie erscheint dann hier von selbst.'
      : 'Zieh danach hier nach unten, um sie zu holen.';
    return `<div class="banner night"><b>Deine Nacht ist noch nicht bei Garmin.</b> Die Uhr schickt sie meist kurz nach dem Aufwachen – schneller geht's, wenn du kurz Garmin Connect öffnest. ${auto}</div>`;
  }
  if (state.sel === state.model.days.length - 1 && last.date < todayIso()) {
    return `<div class="banner warn">Noch keine Daten von heute. Öffne kurz Garmin Connect, damit die Uhr synchronisiert.</div>`;
  }
  return '';
}

function render() {
  renderTabbar();
  renderSheet();
  renderOnboarding();
  const anim = state.animate;
  state.animate = false;
  document.body.classList.toggle('chatmode', state.view === 'main' && state.tab === 'coach');
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
  const draft = document.getElementById('askbox')?.value || '';
  const views = { heute: viewToday, schlaf: viewSleep, recovery: viewRecovery, belastung: viewStrain, coach: viewCoach, trends: viewTrends, settings: viewSettings };
  let head;
  if (DAY_TABS.includes(state.tab)) head = dayHeader();
  else if (state.tab === 'coach') head = simpleHeader('Coach', false, `<button class="chip" data-act="chat-new" aria-label="Neuer Chat">${I.plus}Neu</button>`);
  else head = simpleHeader(state.tab === 'trends' ? 'Trends' : 'Einstellungen', true);
  app.innerHTML = `${head}<div class="screen${anim ? ' anim' : ''}">${state.tab === 'heute' ? statusBanner() : ''}${views[state.tab](anim)}</div>`;
  if (draft && document.getElementById('askbox')) document.getElementById('askbox').value = draft;
  if (anim) animateCounts();
  startOrbs(app);
  Hud.afterRender(app, anim);
  queueMicrotask(maybeReport);
}

function animateCounts() {
  app.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const digits = Number(el.dataset.digits || 0);
    const suffix = el.dataset.suffix || '';
    const sep = el.dataset.sep === '1';
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      const e = 1 - (1 - k) ** 4;
      const v = target * e;
      el.textContent = (sep ? Math.round(v).toLocaleString('de-DE') : v.toFixed(digits).replace('.', ',')) + suffix;
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
    <p>Deine Daten sind verschlüsselt. Gib einmal dein Daten-Passwort ein – danach nie wieder.</p>
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
        ? 'Garmin hat dir einen Bestätigungscode geschickt. Gib ihn in den Einstellungen ein (innerhalb von 30 Min.).'
        : auth === 'error'
          ? 'Die Garmin-Anmeldung ist fehlgeschlagen. Prüfe E-Mail und Passwort in den GitHub-Secrets.'
          : 'Noch keine Daten da. Sobald der erste Garmin-Abruf gelaufen ist, erscheinen sie hier.';
  return `<div class="lock">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Puls</h1>
    <p>${text}</p>
    <button class="btn" data-act="reload">Erneut laden</button>
    <button class="btn ghost" data-act="demo">Demo-Daten ansehen</button>
    <button class="linkbtn" data-act="settings">Einstellungen</button>
  </div>`;
}

// ------------------------------------------------------------------ Bausteine

const infoBtn = (key) => `<button class="infobtn" data-info="${key}" aria-label="Erklärung">i</button>`;
const card = (title, body, cls = '', info = '') => `<section class="card ${cls}">${title ? `<h2>${title}${info ? infoBtn(info) : ''}</h2>` : ''}${body}</section>`;
const insightHtml = (x) => `<div class="insight ${x.tone}"><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div>`;
function tile(k, v, unit = '', s = '') {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
}
function rowLink(icon, color, title, sub, act, extra = '') {
  return `<button class="rowlink" ${act}><span class="ic" style="color:${color}">${icon}</span><span class="rl"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span>${extra}<span class="chev">${I.chevron}</span></button>`;
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
  const y = state.model.days[d.i - 1];
  const cmp = (cur, prev, fmt, betterUp = true) => {
    if (cur == null || prev == null) return '<span class="capsub">&nbsp;</span>';
    const diff = cur - prev;
    const cls = Math.abs(diff) < 0.05 ? 'muted' : (diff > 0) === betterUp ? 'up' : 'down';
    return `<span class="capsub ${cls}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} ${fmt(Math.abs(diff))} ggü. gestern</span>`;
  };
  const caps = [
    cmp(d.perf, y?.perf, (v) => `${Math.round(v)}`),
    cmp(d.recovery, y?.recovery, (v) => `${Math.round(v)}`),
    d.target ? `<span class="capsub muted">${esc(shortPlan(planFor(d.i)))}</span>` : '<span class="capsub">&nbsp;</span>',
  ];
  const R = { size: 104, stroke: 10, labelSize: 30, anim };
  return `<section class="rings v4">
    <button class="ringbox" data-tab="schlaf">${orbRing(ring({ ...R, value: d.perf, max: 100, color: 'var(--sleep)', label: d.perf == null ? '–' : `${Math.round(d.perf)}%`, count: d.perf == null ? null : Math.round(d.perf), suffix: '%' }), HEX.sleep, 64)}<span class="cap">Schlaf <i>›</i></span>${caps[0]}</button>
    <button class="ringbox" data-tab="recovery">${orbRing(ring({ ...R, value: d.recovery, max: 100, color: zoneColor(d.zone), label: d.recovery == null ? '–' : `${d.recovery}%`, count: d.recovery, suffix: '%' }), zoneHex(d.zone), 64)}<span class="cap">Recovery <i>›</i></span>${caps[1]}</button>
    <button class="ringbox" data-tab="belastung">${orbRing(ring({ ...R, value: d.strain, max: 21, color: 'var(--strain)', label: de1(d.strain), count: d.strain, digits: 1 }), HEX.strain, 64)}<span class="cap">Strain <i>›</i></span>${caps[2]}</button>
  </section>`;
}

// ------------------------------------------------------------------ Heute

/** HUD-Leiste: EKG-Linie im Takt des Ruhepulses der letzten Nacht (nur Zukunfts-Darstellung). */
function telemetry(d) {
  const gen = state.store?.generated;
  const fresh = state.demo || (gen && Date.now() - new Date(gen).getTime() < 3 * 3600e3);
  const bpm = d.rhr ?? d.rhrRef ?? 60;
  return `<div class="telemetry" aria-hidden="true">
    <span class="tl-l"><i class="${fresh ? 'on' : ''}"></i><span class="tl-tag">Bio-Link</span></span>
    <canvas class="ecg" data-bpm="${Math.round(bpm)}" data-color="${zoneHex(d.zone)}"></canvas>
    <span class="tl-r"><b>${d.rhr ?? '–'}</b> bpm</span>
  </div>`;
}

function setupState() {
  return {
    sync: !!ghConfig().token,
    coach: !!Coach.coachConfig().apiKey,
    push: pushReady(),
    pad: !!state.model?.days?.slice(-14).some((d) => d.pad),
  };
}

function setupCard() {
  if (state.demo) return '';
  const s = setupState();
  if (ls.get(LS.setupHidden) && s.sync) return '';
  const done = [s.sync, s.coach, s.push].filter(Boolean).length;
  if (done === 3) return '';
  const item = (ok, icon, title, sub, act) =>
    `<button class="setup-item ${ok ? 'ok' : ''}" ${ok ? 'disabled' : act}><span class="ic">${ok ? I.check : icon}</span><span class="rl"><b>${title}</b><span>${ok ? 'Erledigt' : sub}</span></span>${ok ? '' : `<span class="chev">${I.chevron}</span>`}</button>`;
  return `<section class="card setup"><h2>Puls fertig einrichten · ${done} von 3<button class="infobtn" data-act="setup-hide" aria-label="Ausblenden">×</button></h2>
    ${item(s.sync, I.sync, 'Automatisch aktualisieren', 'Frische Daten bei jedem Öffnen · 2 Min.', 'data-act="setup-sync"')}
    ${item(s.coach, I.coach, 'KI-Coach aktivieren', 'Frag alles zu Training & Schlaf · 3 Min.', 'data-act="setup-coach"')}
    ${item(s.push, I.bell, 'Benachrichtigungen', 'Morgens Recovery, tagsüber Schritte & Training, abends Schlaf', 'data-act="setup-push"')}
  </section>`;
}

function viewToday(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const coach = E.buildCoach(m, i);
  const insights = E.buildInsights(m, i, journal());
  const isLatest = i === m.days.length - 1;
  const plan = isLatest ? E.bedtimePlan(m, i) : null;
  const v = E.vitals(m, i);

  // Training heute (ersetzt den allgemeinen Tagesplan)
  const planCard = trainingCard(m, i, plan);

  // Morgen-Check (eine Zeile)
  let journalRow = '';
  if (i > 0) {
    const date = E.addDays(d.date, -1);
    const a = journal()[date];
    const yes = a?._done ? questions().filter((q) => a[q.id]).map((q) => q.label) : null;
    journalRow = yes
      ? `<section class="card slim">${rowLink(I.check, 'var(--green)', 'Morgen-Check erledigt', esc(yes.join(' · ') || 'Nichts Besonderes'), `data-act="journal" data-date="${date}"`)}</section>`
      : `<section class="card slim journal-cta">${rowLink(I.journal, 'var(--sleep)', 'Morgen-Check', `Was war ${dayTitle(date) === 'Gestern' ? 'gestern' : 'am Vortag'}? · 10 Sek.`, `data-act="journal" data-date="${date}"`)}</section>`;
  }

  // Körper (eine Zeile)
  const bodyRow = v.items.length
    ? `<section class="card slim">${rowLink(v.outside ? I.alert : I.check, v.outside ? 'var(--red)' : 'var(--green)', v.outside ? `${v.outside} Körperwert${v.outside > 1 ? 'e' : ''} auffällig` : 'Körperwerte normal', v.items.map((x) => x.label).join(' · '), 'data-tab="recovery"')}</section>`
    : '';

  const shown = state.showAllInsights ? insights : insights.slice(0, 3);
  const insightsCard = insights.length
    ? card('Hinweise', `${shown.map(insightHtml).join('')}${insights.length > 3 ? `<button class="linkbtn" data-act="more-insights">${state.showAllInsights ? 'Weniger' : `Alle ${insights.length} Hinweise`}</button>` : ''}`)
    : '';

  const acts = dayCard(d);

  let weekRow = '';
  if (isLatest) {
    const w = E.weeklyAssessment(m, i);
    const dots = m.days.slice(Math.max(0, i - 6), i + 1).map((x) => `<i style="background:${x.zone ? zoneColor(x.zone) : 'var(--track)'}"></i>`).join('');
    weekRow = `<section class="card slim">${rowLink(I.trends, 'var(--text)', `Deine Woche: ${esc(w.verdict.label)}`, 'Bericht, Kalender & Einflüsse', 'data-tab="trends"', `<span class="weekdots">${dots}</span>`)}</section>`;
  }

  const report = isLatest ? reportCard(m, i) : '';
  const ht = E.healthTrends(m, i);
  const healthRow = ht.flags.length
    ? `<section class="card slim">${rowLink(I.alert, ht.verdict === 'arzt' ? 'var(--red)' : 'var(--yellow)', esc(ht.flags[0].title), ht.flags.length > 1 ? `+ ${ht.flags.length - 1} weitere${ht.flags.length > 2 ? '' : 'r'} Hinweis${ht.flags.length > 2 ? 'e' : ''} · Gesundheits-Check` : 'Gesundheits-Check · 7 Tage vs. deine Basis', 'data-tab="recovery"')}</section>`
    : '';
  const nutri = isLatest ? nutritionCard(m, i) : '';
  return `${setupCard()}${telemetry(d)}${dials(d, anim)}${dashTiles(m, i)}
    <h2 class="bighead">Mein Tag</h2>${illnessRow(m, i)}${planCard}${isLatest ? lifestyleCard() : ''}${weekTrainingCard(m, i)}${report}${reviewCard(m, i)}${journalRow}${healthRow}${acts}${goalsCard(m, i)}${nutri}${insightsCard}
    <h2 class="bighead">Mein Dashboard</h2>${statsCard(m, i)}${weekRow}`;
}

// ------------------------------------------------------------------ Training heute, Infekt-Frühwarnung

const shortPlan = (p) => (p.kind === 'rest' ? 'Heute Pause' : p.kind === 'done' ? 'Training erledigt' : p.kind === 'none' || p.kind === 'free' ? '' : p.kind === 'bike' ? `Rad ${p.min} Min.` : p.title.replace(' · ', ' '));
const KIND_IC = { bike: () => I.bike, gym: () => I.lift, rest: () => I.bed, done: () => I.check, none: () => I.watch, free: () => I.act };

function trainingCard(m, i, bed) {
  const p = planFor(i);
  const d = m.days[i];
  const isToday = i === m.days.length - 1;
  const sub = p.kind === 'gym' ? p.sub.split(' – ') : [p.sub];
  const gym = p.profile.gym;
  const ask =
    isToday && gym?.unlabeled && gym.unlabeled.id != null
      ? `<div class="tr-ask"><span>${gym.guess ? `Letztes Gym (${esc(shortDate(gym.unlabeled.date))}) als <b>${T.SPLITS[gym.guess]}</b> gezählt – stimmt das?` : `Dein letztes Gym (${esc(shortDate(gym.unlabeled.date))}) war …`}</span>${['push', 'pull', 'legs'].map((k) => `<button class="qchip ${gym.guess === k ? 'on' : ''}" data-act="split" data-id="${esc(String(gym.unlabeled.id))}" data-split="${k}">${T.SPLITS[k]}</button>`).join('')}</div>`
      : '';
  const sick = feelOn(d.date) === 'sick';
  return `<section class="card train lv-${p.level || p.kind}">
    <h2>Training ${isToday ? 'heute' : 'an diesem Tag'}${infoBtn('training')}</h2>
    <div class="tr-main"><span class="tr-ic k-${p.kind}">${KIND_IC[p.kind]?.() || I.act}</span><div><b>${esc(p.title)}</b>${sub[0] ? `<span>${esc(sub[0])}</span>` : ''}</div></div>
    ${sub[1] ? `<p class="tr-how">${esc(sub[1])}</p>` : ''}
    ${p.bullets.length ? `<ul class="tr-why">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${p.alt ? `<p class="tr-alt">${esc(p.alt)}</p>` : ''}
    ${ask}
    ${isToday ? `<div class="tr-foot">
      ${bed ? rowLink(I.bed, 'var(--sleep)', `Ins Bett um ${clockDE(bed.options[0].bed)}`, `${E.fmtDur(bed.need.total)} Std. Schlaf · spätestens ${clockDE(bed.options[1].bed)}`, 'data-tab="schlaf"') : ''}
      <button class="feelbtn ${sick ? 'on' : ''}" data-act="feel">${I.alert}<span>${sick ? 'Du fühlst dich angeschlagen – tippe, wenn es dir wieder gut geht' : 'Fühlst du dich angeschlagen?'}</span></button>
    </div>` : ''}
  </section>`;
}

/** Trainingswoche Mo–So: was an welchem Tag (wie im eigenen Kalender), Anzahl und Vorwoche. */
function weekTrainingCard(m, i) {
  const w = T.trainingWeek(m, i, splitLabels());
  const sel = m.days[i].date;
  const cells = w.days
    .map((d) => {
      const wd = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][(E.weekday(d.date) + 6) % 7];
      const chips = d.sessions.length
        ? d.sessions.slice(0, 2).map((x) => `<i class="wk-chip k-${x.kind}">${esc(x.label)}</i>`).join('')
        : `<i class="wk-chip k-none">${d.future ? '' : '–'}</i>`;
      const idx = m.index[d.date];
      return `<button class="wk-day ${d.date === sel ? 'on' : ''} ${d.future ? 'future' : ''}" ${idx != null ? `data-goto="${idx}"` : 'disabled'}><span>${wd}</span>${chips}</button>`;
    })
    .join('');
  const parts = Object.entries(w.byLabel).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${esc(k)}`);
  const diff = w.count - w.prevCount;
  return card(
    `Trainingswoche<span class="wk-count">${w.count} ${w.count === 1 ? 'Training' : 'Trainings'}</span>`,
    `<div class="wk-grid">${cells}</div>
    <p class="note">${parts.length ? parts.join(' · ') : 'Noch kein Training diese Woche'} · Vorwoche ${w.prevCount}${diff ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})` : ''}</p>`,
    'wkcard',
  );
}

// ------------------------------------------------------------------ Lifestyle-Log (wie ein Tagebuch per Knopfdruck)

const QUICK = ['koffein', 'alkohol', 'spaetessen', 'bildschirm', 'stress', 'sauna', 'meditation', 'kalt'];
function lifestyleCard() {
  const date = Life.logDate();
  const e = journal()[date] || {};
  const tile = (id) => {
    const b = Life.byId[id];
    const n = (e._t?.[id] || []).length;
    return `<button class="lf-btn ${n ? 'on' : ''}" data-act="life" data-id="${id}" aria-label="${esc(b.label)} jetzt eintragen"><span class="lf-ic">${lifeIcon(id)}${n ? `<b>${n}</b>` : ''}</span><span class="lf-l">${esc(b.label)}</span></button>`;
  };
  const logged = Life.BEHAVIORS.flatMap((b) => (e._t?.[b.id] || []).map((t) => ({ b, t }))).sort((a, b) => (a.t < b.t ? -1 : 1));
  const top = lifeInsights().items.filter((x) => !x.pending && x.solid).slice(0, 1);
  return `<section class="card lifecard">
    <h2>Lifestyle${infoBtn('life')}</h2>
    <div class="lf-grid">${QUICK.map(tile).join('')}</div>
    ${logged.length ? `<div class="lf-today">${logged.map(({ b, t }) => `<button class="lf-chip" data-act="life-del" data-id="${b.id}" data-t="${t}" aria-label="${esc(b.label)} ${t} löschen">${lifeIcon(b.id)}<span>${t}</span><i>×</i></button>`).join('')}</div>` : '<p class="lf-hint">Antippen, wenn es passiert – Puls merkt sich die Uhrzeit.</p>'}
    <div class="lf-more"><button class="linkbtn" data-act="life-more">Mehr · andere Uhrzeit</button>${top.length ? `<button class="linkbtn" data-tab="trends">Größter Hebel: ${top.map((x) => `${esc(x.label)} ${x.diff > 0 ? '+' : '−'}${Math.abs(Math.round(x.diff))} %`).join('')} ›</button>` : ''}</div>
  </section>`;
}

/** Wie deine Gewohnheiten die Recovery am Morgen danach verändern (wie Journal-Insights bei Whoop). */
/** Verhalten eintragen (Uhrzeit jetzt oder angegeben) und, wenn sinnvoll, sofort einordnen. */
function logLife(id, time = null) {
  const now = new Date();
  const hhmm = time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const date = Life.logDate(now);
  saveJournal(date, Life.addLog(journal()[date], id, hhmm));
  const m = state.model;
  const isLast = m && !m.empty;
  const bed = isLast ? E.bedtimePlan(m, m.days.length - 1)?.options?.[0]?.bed : null;
  const min = Life.toMin(hhmm) + (now.getHours() < 4 && !time ? 1440 : 0);
  const lines = isLast ? Life.adviceFor(id, min, lifeInsights(), { bedMin: bed }) : [];
  if (navigator.vibrate) navigator.vibrate(12);
  if (lines.length) openSheet({ type: 'logged', id, time: hhmm, lines });
  else {
    if (state.sheet?.type === 'lifemore') closeSheet();
    toast(`${Life.byId[id].label} eingetragen · ${hhmm}`);
  }
  render();
}

function lifeInsightsCard() {
  const ins = lifeInsights();
  const done = ins.items.filter((x) => !x.pending);
  const pend = ins.items.filter((x) => x.pending && x.ny > 0);
  const max = Math.max(10, ...done.map((x) => Math.abs(x.diff)));
  const fmt = (v, d = 0) => {
    const r = d ? Math.round(v * 10) / 10 : Math.round(v);
    return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toString().replace('.', ',')}`;
  };
  const row = (x) => {
    const w = Math.min(50, (Math.abs(x.diff) / max) * 50);
    const sub = ['hrv', 'rhr', 'deep']
      .map((k) => x.effects[k] && `${x.effects[k].label} ${fmt(x.effects[k].diff, x.effects[k].digits)}${x.effects[k].unit === '%-Pkt.' ? ' %-Pkt.' : ` ${x.effects[k].unit}`}`)
      .filter(Boolean)
      .join(' · ');
    return `<div class="li-row"><span class="li-ic ${x.diff >= 0 ? 'good' : 'bad'}">${lifeIcon(x.id)}</span><div class="li-main"><div class="li-top"><b>${esc(x.label)}</b><em class="${x.diff >= 0 ? 'up' : 'down'}">${fmt(x.diff)} %</em></div>
      <div class="li-bar"><i class="${x.diff >= 0 ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%"></i></div>
      <span class="li-sub">${sub}${sub ? ' · ' : ''}${x.ny} gegen ${x.nn} Nächte${x.solid ? '' : ' · Tendenz'}</span></div></div>`;
  };
  const c = ins.caffeine;
  const caf =
    c.cutoff != null
      ? `<div class="li-special"><span class="li-ic bad">${I.coffee}</span><div><b>Deine Koffein-Grenze: ${c.cutoff} Uhr</b><span>Kaffee danach kostet dich ${c.drop} % Recovery${c.deep ? ` und ${String(c.deep).replace('.', ',')} %-Punkte Tiefschlaf` : ''}${c.hrv ? `, HRV −${c.hrv} ms` : ''} (${c.nLate} gegen ${c.nEarly} Nächte).</span></div></div>`
      : `<div class="li-special"><span class="li-ic">${I.coffee}</span><div><b>Koffein-Grenze: wird gelernt</b><span>Tippe deinen Kaffee beim Trinken an – nach ein paar Tagen mit späten und frühen Tassen zeigt Puls deine persönliche Grenze${c.logged ? ` (bisher ${c.logged} Tage)` : ''}.</span></div></div>`;
  const alc = ins.alcohol.groups.filter((g) => g.recovery != null);
  const alcRow = alc.length
    ? `<div class="li-special"><span class="li-ic bad">${I.wine}</span><div><b>Alkohol nach Menge</b><span>${alc.map((g) => `${g.drinks === 2 ? 'ab 2 Gläsern' : '1 Glas'}: ${fmt(g.recovery)} % Recovery${g.hrv != null ? `, HRV ${fmt(g.hrv)} ms` : ''}`).join(' · ')}</span></div></div>`
    : '';
  const meal = ins.meal ? `<div class="li-special"><span class="li-ic ${ins.meal.recovery >= 0 ? '' : 'bad'}">${I.meal}</span><div><b>Essen kurz vor dem Schlafen</b><span>Weniger als 3 Std. davor: Recovery ${fmt(ins.meal.recovery)} %${ins.meal.rhr != null ? `, Ruhepuls ${fmt(ins.meal.rhr, 1)} bpm` : ''} (${ins.meal.n} gegen ${ins.meal.m} Nächte).</span></div></div>` : '';
  return card(
    'Lifestyle-Einflüsse',
    `${done.length ? done.map(row).join('') : '<p class="small muted">Sobald du ein Verhalten mindestens 3× mit und 3× ohne geloggt hast, siehst du hier, wie es deine Recovery verändert.</p>'}
    ${caf}${alcRow}${meal}
    ${pend.length ? `<p class="note">Noch zu wenig Daten: ${pend.map((x) => `${esc(x.label)} (noch ${x.need})`).join(' · ')}</p>` : ''}`,
    'licard',
    'life',
  );
}

const ILL_TONE = ['ok', 'watch', 'warn', 'bad'];
function illnessRow(m, i) {
  const r = E.illnessRisk(m, i, { feel: feelOn(m.days[i].date), journal: journal() });
  if (r.level < 1) return '';
  const top = r.signals.slice(0, 2).map((x) => x.label).join(' · ');
  return `<section class="card slim ill-row tone-${ILL_TONE[r.level]}">${rowLink(I.alert, r.level >= 2 ? 'var(--red)' : 'var(--yellow)', `Infekt-Frühwarnung: ${r.label}`, esc(top), 'data-tab="recovery"')}</section>`;
}

function illnessCard(m, i) {
  const r = E.illnessRisk(m, i, { feel: feelOn(m.days[i].date), journal: journal() });
  const seg = [0, 1, 2, 3].map((k) => `<i class="${k <= r.level ? `on t${r.level}` : ''}"></i>`).join('');
  const h = r.history;
  const past = h.episodes.length
    ? `In den letzten 4 Monaten gab es ${h.episodes.length === 1 ? 'eine solche Phase' : `${h.episodes.length} solche Phasen`} (zuletzt ${shortDate(h.episodes[h.episodes.length - 1].date)}).${h.leadLabel ? ` Bei dir zeigte sich zuerst meist: ${h.leadLabel}${h.early ? `, ${h.early === 1 ? 'einmal' : `${h.early}×`} schon 1–3 Tage vorher` : ''}.` : ''}${h.sickLogged ? ` ${h.sickLogged}× hast du danach „krank / angeschlagen“ eingetragen.` : ''}`
    : 'In den letzten 4 Monaten gab es bei dir keine Phase mit erhöhtem Risiko.';
  const sick = feelOn(m.days[i].date) === 'sick';
  return card(
    'Infekt-Frühwarnung',
    `<div class="ill-top"><div class="ill-meter">${seg}</div><b class="ill-lvl t${r.level}">${esc(r.label[0].toUpperCase() + r.label.slice(1))}</b></div>
    ${r.signals.length ? `<ul class="ill-sig">${r.signals.map((x) => `<li><i class="p${x.pts}"></i>${esc(x.text)}</li>`).join('')}</ul>` : '<p class="small muted">Ruhepuls, HRV, Atmung und Temperatur liegen in deinem Normalbereich.</p>'}
    ${r.note ? `<p class="small" style="margin-top:8px">${esc(r.note)}</p>` : ''}
    ${r.advice.length ? `<ul class="ntips">${r.advice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${note(esc(past))}
    ${i === m.days.length - 1 ? `<button class="feelbtn ${sick ? 'on' : ''}" data-act="feel">${I.alert}<span>${sick ? 'Du fühlst dich angeschlagen – tippe, wenn es dir wieder gut geht' : 'Ich fühle mich angeschlagen'}</span></button>` : ''}`,
    'illcard',
    'illness',
  );
}

// ------------------------------------------------------------------ Tagesrückblick, Wochenziele

function reviewCard(m, i) {
  const d = m.days[i];
  const isToday = d.date === todayIso();
  if (isToday && new Date().getHours() < 18) return '';
  const r = E.dayReview(m, i);
  if (!r) return '';
  return card(isToday ? 'Dein Tag im Rückblick' : 'Rückblick', `<h3 class="rv-title">${esc(r.title)}</h3><ul class="ntips">${r.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${r.tonight ? `<p class="small" style="margin-top:10px">${esc(r.tonight)}</p>` : ''}`);
}

function goalsCard(m, i) {
  if (m.days[i].date !== todayIso() && i !== m.days.length - 1) return '';
  const g = E.weekGoals(m, i, ls.get(LS.goals, {}));
  const mini = (done, goal, color, label, sub) => `<div class="goal">${ring({ value: Math.min(done, goal), max: goal, color, size: 64, stroke: 6, label: `${done}/${goal}`, labelSize: 17 })}<b>${label}</b><span>${sub}</span></div>`;
  return `<section class="card"><h2>Wochenziele<button class="infobtn editbtn" data-act="goals" aria-label="Ziele ändern">${I.gear}</button></h2>
    <div class="goals">
      ${mini(g.train.done, g.train.goal, 'var(--strain)', 'Training', 'Tage diese Woche')}
      ${mini(g.sleep.done, g.sleep.goal, 'var(--sleep)', 'Schlaf', `Nächte ≥ ${String(g.goals.sleepH).replace('.', ',')} Std.`)}
      ${mini(g.steps.done, g.steps.goal, 'var(--green)', 'Schritte', `Tage ≥ ${int(g.goals.steps)}`)}
    </div></section>`;
}

// ------------------------------------------------------------------ Dashboard-Kacheln (Heute)

function dashTiles(m, i) {
  const d = m.days[i];
  const st = d.stats || {};
  const v = E.vitals(m, i);
  const hist = m.days.slice(Math.max(0, i - 30), i);
  const avg = (f) => {
    const xs = hist.map(f).filter(isNum);
    return xs.length >= 5 ? E.mean(xs) : null;
  };
  const cnt = (v) => ` data-count="${Math.round(v)}" data-sep="1"`;
  const tileBtn = (attr, title, sub, icon, label, color = 'var(--text)', num = null) =>
    `<button class="dtile" ${attr}><span class="dt-top"><b${num != null ? cnt(num) : ''}>${title}</b><i>${I.chevron}</i></span><span class="dt-sub">${sub}</span><span class="dt-foot"><span class="dt-ic" style="color:${color}">${icon}</span>${label}</span></button>`;
  const tiles = [];
  if (v.items.length) {
    const measured = v.items.filter((x) => x.status !== 'na').length;
    tiles.push(tileBtn('data-tab="recovery"', v.outside ? `${v.outside} auffällig` : 'Normal', `${measured - v.outside}/${measured} Werte`, v.outside ? I.alert : I.check, 'Körper-Check', v.outside ? 'var(--red)' : 'var(--green)'));
  }
  if (isNum(st.stress)) {
    const word = st.stress >= 50 ? 'Hoch' : st.stress >= 26 ? 'Mittel' : 'Niedrig';
    const a = avg((x) => x.stats?.stress);
    tiles.push(tileBtn('data-tab="recovery"', word, `Ø ${st.stress}${a != null ? ` · sonst ${Math.round(a)}` : ''}`, I.stress, 'Stress', st.stress >= 50 ? 'var(--yellow)' : 'var(--text)'));
  }
  if (isNum(st.steps)) {
    const a = avg((x) => x.stats?.steps);
    tiles.push(tileBtn('data-tab="belastung"', int(st.steps), a != null ? `Ø ${int(a)}` : st.stepGoal ? `Ziel ${int(st.stepGoal)}` : '&nbsp;', I.steps, st.padSteps ? 'Schritte · inkl. Pad' : 'Schritte', 'var(--text)', st.steps));
  }
  if (isNum(d.rhr)) tiles.push(tileBtn('data-tab="recovery"', `${d.rhr}`, `Ø ${d.rhrRef}`, I.heart, 'Ruhepuls', 'var(--text)', d.rhr));
  else if (isNum(d.hrv)) tiles.push(tileBtn('data-tab="recovery"', `${d.hrv}`, 'HRV ms', I.heart, 'HRV'));
  return tiles.length ? `<section class="dtiles">${tiles.join('')}</section>` : '';
}

// ------------------------------------------------------------------ Tagesbericht, Ernährung, Gesundheit

const rich = (t) => esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const reportRun = { busy: false, error: null, tried: new Set() };

function reportCard(m, i) {
  const d = m.days[i];
  if (state.demo) return '';
  const cfg = Coach.coachConfig();
  if (!cfg.apiKey) {
    return `<section class="card slim">${rowLink(I.journal, 'var(--green)', 'Dein persönlicher Tagesbericht', 'Wie beim Arzt: jeden Morgen eine Einschätzung deiner Werte · KI-Coach einrichten', 'data-act="setup-coach"')}</section>`;
  }
  const cached = Coach.cachedReport();
  const fresh = cached && cached.key === Coach.reportKey(m, profile(), reportExtra());
  const today = cached && cached.date === d.date ? cached : null;
  if (reportRun.busy && !today) {
    return `<section class="card report"><div class="rp-top"><span class="rp-badge">Dein Tagesbericht</span></div><div class="rp-wait"><span class="spinner small"></span><span>Dein Coach schaut sich deine Werte an … <span class="muted">(ca. 30–60 Sek.)</span></span></div></section>`;
  }
  if (!today) {
    if (d.recovery == null) return `<section class="card slim">${rowLink(I.journal, 'var(--muted)', 'Tagesbericht folgt', 'Sobald deine Nacht da ist, schreibt dein Coach den Bericht.', 'data-act="sync"')}</section>`;
    const err = reportRun.error ? `<p class="small" style="color:var(--red);margin:6px 0">${esc(reportRun.error)}</p>` : '';
    return `<section class="card report"><div class="rp-top"><span class="rp-badge">Dein Tagesbericht</span></div>${err}<p class="small muted">Dein Coach wertet deine Nacht, die letzten Wochen und deine Angaben aus.</p><button class="btn" data-act="report-refresh" style="margin-top:10px">Bericht erstellen</button></section>`;
  }
  const r = today.report;
  const sec = (key, icon, title) => {
    const x = r[key];
    const pts = x.punkte.slice(0, 2);
    return `<details class="rp-sec"><summary><span class="dt-ic">${icon}</span>${title}</summary><p>${rich(x.text)}</p>${pts.length ? `<ul>${pts.map((p) => `<li>${rich(p)}</li>`).join('')}</ul>` : ''}</details>`;
  };
  const level = { arzt: ['var(--red)', 'Ärztlich abklären'], beobachten: ['var(--yellow)', 'Beobachten'], info: ['var(--muted)', 'Info'] };
  const notes = r.hinweise.length
    ? `<div class="rp-notes">${r.hinweise.slice(0, 2).map((h) => `<div class="rp-note"><i style="background:${(level[h.stufe] || level.info)[0]}"></i><div><b>${(level[h.stufe] || level.info)[1]}</b> ${rich(h.text)}</div></div>`).join('')}</div>`
    : '';
  const when = new Date(today.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const label = Coach.MODELS[today.model]?.label || 'Claude';
  return `<section class="card report">
    <div class="rp-top"><span class="rp-badge">Dein Tagesbericht</span>${infoBtn('report')}<button class="iconbtn small" data-act="report-refresh" aria-label="Neu erstellen" ${reportRun.busy ? 'disabled' : ''}>${reportRun.busy ? '<span class="spinner small"></span>' : I.sync}</button></div>
    <h3 class="rp-head">${rich(r.schlagzeile)}</h3>
    <p class="rp-sum">${rich(r.einschaetzung)}</p>
    <div class="rp-focus"><span>Heute im Fokus</span>${rich(r.fokus)}</div>
    ${notes}
    ${sec('koerper', I.steth, 'Körper & Gesundheit')}${sec('training', I.strain, 'Training')}${sec('ernaehrung', I.bowl, 'Ernährung')}${sec('schlaf', I.sleep, 'Schlaf')}
    <p class="muted small rp-foot">${fresh ? '' : 'Neue Daten seit dem Bericht · '}Erstellt ${when} · ${esc(label)} · keine ärztliche Diagnose</p>
  </section>`;
}

/** Startet den Tagesbericht einmal pro neuer Nacht automatisch (wenn der Coach eingerichtet ist). */
function maybeReport() {
  if (state.view !== 'main' || state.tab !== 'heute' || state.demo || reportRun.busy) return;
  const m = state.model;
  if (!m || m.empty || state.sel !== m.days.length - 1) return;
  const d = m.days[m.days.length - 1];
  if (d.recovery == null || d.date !== todayIso() || !Coach.coachConfig().apiKey || ls.get(LS.reportAuto, true) === false) return;
  const key = Coach.reportKey(m, profile(), reportExtra());
  const cached = Coach.cachedReport();
  if (cached?.key === key || reportRun.tried.has(key)) return;
  reportRun.tried.add(key);
  makeReport();
}

async function makeReport() {
  if (reportRun.busy) return;
  reportRun.busy = true;
  reportRun.error = null;
  if (state.tab === 'heute') render();
  try {
    await Coach.dailyReport(coachApp);
  } catch (err) {
    reportRun.error = err.message || 'Bericht konnte nicht erstellt werden.';
  } finally {
    reportRun.busy = false;
    if (state.tab === 'heute' && !state.sheet) render();
  }
}

function nutritionCard(m, i) {
  const n = E.nutritionPlan(m, i, profile(), journal(), { partial: m.days[i].date === todayIso() });
  if (n.missing) {
    return `<section class="card slim">${rowLink(I.bowl, 'var(--green)', 'Ernährung für heute', 'Gewicht & Ziel eintragen – dann rechnet Puls deinen Bedarf', 'data-act="profile"')}</section>`;
  }
  const split = [
    ['Eiweiß', n.protein, 4, 'var(--green)'],
    ['Kohlenhydrate', n.carbs, 4, 'var(--strain)'],
    ['Fett', n.fat, 9, 'var(--yellow)'],
  ];
  const total = split.reduce((sum, [, g, k]) => sum + g * k, 0);
  const bar = split.map(([, g, k, c]) => `<i style="width:${((100 * g * k) / total).toFixed(1)}%;background:${c}"></i>`).join('');
  const macros = split.map(([label, g, , c]) => `<div class="nm"><span class="nm-l"><i style="background:${c}"></i>${label}</span><b>${g}<small>g</small></b></div>`).join('');
  const mini = [
    [I.drop, String(n.water).replace('.', ','), 'L', 'Wasser'],
    n.caffeineCut ? [I.coffee, n.caffeineCut, '', 'Kaffee bis'] : null,
    n.lastMeal ? [I.fork, n.lastMeal, '', 'Essen bis'] : null,
  ].filter(Boolean);
  const tips = n.tips.filter((t) => t.key !== 'koffein').slice(0, 2);
  return card(
    'Ernährung heute',
    `<div class="nhero"><div class="nk"><b>${int(n.kcal)}</b><small>kcal</small></div><span class="ntag">${esc(n.goal === 'gesund' ? n.strainWord : n.goalLabel)}</span></div>
    <div class="nbar">${bar}</div>
    <div class="nmacros">${macros}</div>
    <div class="nmini">${mini.map(([ic, v, u, l]) => `<div class="nmi"><span class="dt-ic">${ic}</span><span><b>${v}${u ? `<small>${u}</small>` : ''}</b><em>${l}</em></span></div>`).join('')}</div>
    ${tips.length ? `<ul class="ntips">${tips.map((t) => `<li>${esc(t.text)}</li>`).join('')}</ul>` : ''}
    <details class="disclose"><summary>Warum diese Werte</summary><p>${esc(n.basis)}</p><button class="linkbtn" data-act="profile">Ziel & Gewicht ändern</button></details>`,
    'nutrition',
    'nutrition',
  );
}

function healthTrendsCard(m, i) {
  const h = E.healthTrends(m, i);
  if (!h.items.length) return '';
  const col = { good: 'var(--green)', ok: 'var(--muted)', watch: 'var(--yellow)' };
  const word = { good: 'gut', ok: 'normal', watch: 'auffällig' };
  const fmt = (x) => `${x.value >= 1000 ? int(x.value) : String(x.value).replace('.', ',')}${x.unit ? ` ${x.unit}` : ''}`;
  const delta = (x) => (x.delta == null || x.key === 'vo2' ? (x.key === 'vo2' && x.base != null ? `Schnitt ${x.base}` : x.key === 'im' ? 'Ziel 150' : '') : `${x.delta > 0 ? '+' : x.delta < 0 ? '−' : '±'}${String(Math.abs(x.delta)).replace('.', ',')} vs. ${String(x.base).replace('.', ',')}`);
  const rows = h.items.map((x) => `<div class="trow"><span class="tl">${x.label}</span><span class="tv">${fmt(x)}</span><span class="td muted">${delta(x)}</span><span class="ts" style="color:${col[x.status]}">${word[x.status]}</span></div>`).join('');
  const lv = { arzt: ['var(--red)', 'Arzt'], beobachten: ['var(--yellow)', 'Beobachten'], info: ['var(--muted)', 'Info'] };
  const flags = h.flags.map((f) => `<div class="rp-note"><i style="background:${lv[f.level][0]}"></i><div><b>${f.title}</b> ${esc(f.text)}</div></div>`).join('');
  const head = h.verdict === 'gut' ? `<div class="okline"><span class="dt-ic" style="color:var(--green)">${I.check}</span>Keine auffälligen Trends – deine Werte sind stabil.</div>` : `<div class="rp-notes" style="margin-bottom:10px">${flags}</div>`;
  return card('Gesundheits-Check', `${head}<div class="trows">${rows}</div><p class="note">Letzte 7 Tage im Vergleich zu deinen eigenen Werten der ${h.ready ? '2 Monate' : 'Tage'} davor. Keine Diagnose.</p>`, '', 'health');
}

function driversLine(d) {
  const dr = E.recoveryDrivers(d);
  if (!dr.length) return '';
  const chip = (x) => `<span class="dchip ${x.neutral ? '' : x.good ? 'good' : 'bad'}"><i>${x.neutral ? '•' : x.good ? '▲' : '▼'}</i>${esc(x.label)}</span>`;
  return `<div class="drivers">${dr.map(chip).join('')}</div>`;
}

const note = (text) => (text ? `<p class="note">${text}</p>` : '');
const trendWord = (t, upGood = true) => {
  if (!t) return '';
  if (t.dir === 'flat') return 'stabil';
  const good = (t.dir === 'up') === upGood;
  return `<span class="${good ? 'up' : 'down'}">${t.dir === 'up' ? 'steigend' : 'fallend'}</span>`;
};

function dayCard(d) {
  const rows = [];
  const clock = (min) => clockDE(((min % 1440) + 1440) % 1440);
  if (d.sleep && isNum(d.sleep.bed) && isNum(d.sleep.wake)) {
    rows.push(pillRow('sleep', I.sleep, E.fmtDur(d.sleepMin), 'Schlaf', clock(d.sleep.wake), clock(d.sleep.bed), 'data-tab="schlaf"'));
  }
  for (const a of d.acts) {
    const start = E.parseClock(a.start);
    const end = start != null && a.dur ? clock(start + a.dur / 60) : '';
    rows.push(pillRow('strain', actIcon(a.type), de1(a.strain), esc(a.name || a.type || 'Aktivität'), end, a.start || '', `data-act="act" data-idx="${d.acts.indexOf(a)}"`));
  }
  if (d.pad) rows.push(pillRow('pad', I.walk, int(d.pad.total), 'Walking-Pad', d.pad.units.length ? clock(d.pad.units[d.pad.units.length - 1][1]) : '', d.pad.units.length ? clock(d.pad.units[0][0]) : '', 'data-info="pad"'));
  if (!rows.length) return '';
  return `<section class="card acts"><h2>Aktivitäten</h2>${rows.join('')}</section>`;
}

function pillRow(kind, icon, value, name, top, bottom, attr) {
  return `<button class="prow" ${attr}><span class="pill ${kind}">${icon}<b>${value}</b></span><span class="pname">${name}</span><span class="ptimes"><span>${top}</span><span>${bottom}</span></span></button>`;
}

/** Walking-Pad-Einheiten (von PitPat über Apple Health). */
function padRow(p) {
  const times = p.units.map(([s, e]) => `${E.fmtClock(s)}–${E.fmtClock(e)}`).join(', ');
  const meta = [times, p.minutes ? `${p.minutes} Min.` : ''].filter(Boolean).join(' · ');
  const counted = p.total - p.added;
  const sub = counted > 50 ? `Uhr hatte ${int(counted)} davon schon gezählt` : 'Uhr hatte davon nichts gezählt';
  return `<div class="act tap" data-info="pad" role="button"><div class="ic" style="color:var(--strain)">${I.walk}</div>
    <div class="body"><div class="name">Walking-Pad</div><div class="meta">${esc(meta)}</div><div class="meta">${sub}</div></div>
    <div class="st">${int(p.total)}<small>Schritte</small></div></div>`;
}

const STAT_UI = {
  hrv: [I.heart, 'recovery'],
  rhr: [I.heart, 'recovery'],
  resp: [I.lungs, 'recovery'],
  perf: [I.sleep, 'schlaf'],
  sleep: [I.sleep, 'schlaf'],
  restorative: [I.sleep, 'schlaf'],
  strain: [I.strain, 'belastung'],
  kcal: [I.flame, 'belastung'],
  steps: [I.steps, 'belastung'],
  stress: [I.stress, 'recovery'],
};

function statsCard(m, i) {
  const partial = m.days[i].date === todayIso();
  const rows = E.keyStats(m, i, { partial });
  if (!rows.length) return '';
  const arrow = (r) => {
    if (!r.trend) return '<span class="arr muted">läuft</span>';
    const cls = r.good == null ? 'muted' : r.good ? 'up' : 'down';
    return `<span class="arr ${cls}">${r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : '•'}</span>`;
  };
  return `<section class="dlist">${rows
    .map((r) => {
      const [icon, tab] = STAT_UI[r.key] || [I.act, 'heute'];
      const countable = typeof r.digits === 'number' && isNum(r.value);
      const ca = countable ? ` data-count="${r.digits ? r.value.toFixed(r.digits) : Math.round(r.value)}" data-digits="${r.digits}"${!r.digits && r.value >= 1000 ? ' data-sep="1"' : ''}` : '';
      return `<button class="drow" data-tab="${tab}"><span class="dr-ic">${icon}</span><span class="dr-main"><b><span${ca}>${fmtVal(r.value, r.digits)}</span>${r.unit ? `<small>${r.unit}</small>` : ''}</b><span>${r.label}${r.base == null ? '' : ` · Ø ${fmtVal(r.base, r.digits)}`}</span></span>${arrow(r)}<span class="dr-chev">${I.chevron}</span></button>`;
    })
    .join('')}</section>${note('Ø = dein Schnitt der letzten 30 Tage · ▲▼ grün = besser als sonst, rot = schlechter')}`;
}

function actRow(a) {
  const meta = [a.start, E.fmtDurLong(a.dur / 60), a.dist ? `${(a.dist / 1000).toFixed(1).replace('.', ',')} km` : '', a.avgHr ? `Ø ${a.avgHr} bpm` : ''].filter(Boolean).join(' · ');
  return `<div class="act"><div class="ic" style="color:var(--strain)">${actIcon(a.type)}</div>
    <div class="body"><div class="name">${esc(a.name || a.type || 'Aktivität')}</div><div class="meta">${esc(meta)}</div></div>
    <div class="st">${de1(a.strain)}<small>Strain</small></div></div>`;
}

// ------------------------------------------------------------------ Recovery

function viewRecovery(anim) {
  const m = state.model;
  const i = state.sel;
  const d = m.days[i];
  const { span, labels, every } = trendSpan();
  const parts = [];
  parts.push(`<section class="hero" style="--glow:${zoneColor(d.zone)}">
    ${orbRing(ring({ value: d.recovery, max: 100, color: zoneColor(d.zone), size: 200, stroke: 19, label: d.recovery == null ? '–' : `${d.recovery}%`, sub: d.recovery == null ? 'keine Daten' : `Recovery · ${zoneName(d.zone)}`, labelSize: 54, count: d.recovery, suffix: '%', anim, glow: true }), zoneHex(d.zone), 156, [
      { k: 'HRV', v: isNum(d.hrv) ? Math.round(d.hrv) : null, u: 'ms' },
      { k: 'Ruhepuls', v: d.rhr, u: 'bpm' },
      { k: 'Atmung', v: isNum(d.resp) ? de1(d.resp) : null, u: '/min' },
      { k: isNum(d.sleep?.spo2) ? 'SpO₂' : 'Schlaf', v: isNum(d.sleep?.spo2) ? Math.round(d.sleep.spo2) : isNum(d.perf) ? Math.round(d.perf) : null, u: '%' },
    ])}
    <p class="hero-text">${d.recovery == null ? 'Für diesen Tag fehlen die Schlafdaten.' : esc(d.alarm ? 'Mehrere Werte auffällig – vielleicht ein Infekt. Heute ist Ruhe das beste Training.' : ZONE_TEXT[d.zone])} ${infoBtn('recovery')}</p>
    ${d.recovery != null ? recoveryCompare(m, i) : ''}
    ${driversLine(d)}
  </section>`);
  parts.push(factorsCard(d));
  parts.push(illnessCard(m, i));
  parts.push(bodyCheckCard(E.vitals(m, i)));
  parts.push(healthTrendsCard(m, i));
  parts.push(stressCard(d));
  if (i === m.days.length - 1) parts.push(ageCard(m));
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  const recs = span.map((x) => x.recovery).filter(isNum);
  parts.push(card('Recovery', `${bars({ values: span.map((x) => ({ v: x.recovery, color: zoneColor(x.zone) })), labels, every, max: 100, refs: [{ v: 67, color: 'var(--grid)', dash: true }, { v: 34, color: 'var(--grid)', dash: true }] })}
    ${recs.length ? note(`Ø ${Math.round(E.mean(recs))} % · <span class="up">${span.filter((x) => x.zone === 'green').length} grün</span>, <span style="color:var(--yellow)">${span.filter((x) => x.zone === 'yellow').length} gelb</span>, <span class="down">${span.filter((x) => x.zone === 'red').length} rot</span>`) : ''}`));
  const hrvNote = d.hrv7 && d.hrvNormal
    ? `Heute ${Math.round(d.hrv ?? 0)} ms · 7-Tage-Schnitt ${Math.round(d.hrv7)} ms – ${d.hrvTrend === 'low' ? '<span class="down">unter</span>' : d.hrvTrend === 'high' ? '<span class="up">über</span>' : 'in'} deinem Normalbereich (${Math.round(d.hrvNormal[0])}–${Math.round(d.hrvNormal[1])}). Trend: ${trendWord(E.trend(span.map((x) => x.hrv))) || '–'}. Höher ist besser.`
    : 'Höher ist besser. Der Normalbereich erscheint nach 3 Wochen Daten.';
  const rhrs = span.map((x) => x.rhr).filter(isNum);
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
      })}<div class="legend"><span>● Nacht</span><span>— 7-Tage-Schnitt</span><span><i style="background:var(--band)"></i>dein Normalbereich</span></div>${note(hrvNote)}`,
      '',
      'hrv',
    ),
  );
  parts.push(card('Ruhepuls', `${lines({ series: [{ values: span.map((x) => x.rhr), color: 'var(--red)', width: 1.2, opacity: 0.55, dots: state.range <= 30 }, { values: span.map((x) => x.rhr3), color: 'var(--red)', width: 2.5 }], labels, every, unit: 'bpm' })}
    ${rhrs.length ? note(`Heute ${d.rhr ?? '–'} bpm · Schnitt ${de1(E.mean(rhrs))} bpm · niedrigster ${Math.min(...rhrs)}, höchster ${Math.max(...rhrs)}. Trend: ${trendWord(E.trend(span.map((x) => x.rhr)), false) || '–'}. Niedriger ist besser – ein Anstieg um 3+ bpm deutet auf Stress, Alkohol oder einen Infekt.`) : ''}`));
  parts.push(influencesCard(m, 5));
  parts.push(`<section class="card slim">${rowLink(I.trends, 'var(--text)', 'Trends & Wochenbericht', 'Kalender, Einflüsse, lange Verläufe', 'data-tab="trends"')}</section>`);
  return parts.join('');
}

function recoveryCompare(m, i) {
  const d = m.days[i];
  const y = m.days[i - 1]?.recovery;
  const last30 = m.days.slice(Math.max(0, i - 29), i + 1).map((x) => x.recovery).filter(isNum);
  const avg = last30.length ? Math.round(E.mean(last30)) : null;
  const rank = last30.length >= 7 ? last30.filter((v) => v < d.recovery).length / last30.length : null;
  const bits = [y != null ? `gestern ${y} %` : '', avg != null ? `Ø 30 Tage ${avg} %` : '', rank != null ? (rank >= 0.8 ? 'einer deiner besten Tage' : rank <= 0.2 ? 'einer deiner schwächeren Tage' : '') : ''].filter(Boolean);
  return bits.length ? `<p class="hero-sub">${bits.join(' · ')}</p>` : '';
}

function factorsCard(d) {
  if (!d.comps.length) return '';
  const rows = d.comps
    .map((c) => {
      if (c.key === 'hrv') {
        const delta = 100 * (c.value / c.ref - 1);
        return factor('HRV', `${Math.round(c.value)} ms`, `normal ${Math.round(c.ref)} ms · <span class="${delta >= 0 ? 'up' : 'down'}">${sign(delta)} %</span>`, c.score, 'hrv');
      }
      if (c.key === 'rhr') {
        const delta = c.value - c.ref;
        return factor('Ruhepuls', `${Math.round(c.value)} bpm`, `normal ${de1(c.ref)} bpm · <span class="${delta <= 0 ? 'up' : 'down'}">${sign(delta, 1)}</span>`, c.score);
      }
      return factor('Schlaf', `${Math.round(d.perf)} %`, `${E.fmtDur(c.value)} von ${E.fmtDur(c.ref)} Std.`, c.score);
    })
    .join('');
  const pens = d.penalties
    .map((p) => (p.key === 'resp' ? factor('Atemfrequenz', `${de1(d.resp)} /Min.`, `<span class="down">${sign(p.delta, 1)} über normal · −${Math.round(p.points)} Punkte</span>`, null) : factor('Hauttemperatur', `${sign(p.delta, 1)} °C`, `<span class="down">erhöht · −${Math.round(p.points)} Punkte</span>`, null)))
    .join('');
  return card('Woraus sie sich ergibt', `${rows}${pens}${d.base.calibrating ? `<p class="muted small" style="margin-top:8px">Lernt noch: ${d.base.hrvDays} von 14 Nächten.</p>` : ''}`);
}

function factor(name, val, cmp, score, info = '') {
  return `<div class="factor"><div class="name">${name}${info ? infoBtn(info) : ''}</div><div class="val">${val}</div><div class="cmp">${cmp}</div>
    ${score == null ? '' : `<div class="meter"><i style="width:${Math.round(score)}%;background:${scoreColor(score)}"></i></div>`}</div>`;
}

function bodyCheckCard(v) {
  if (!v.items.length) return '';
  const ok = v.outside === 0;
  const head = `<div class="bc-head ${ok ? 'ok' : 'bad'}"><span class="ic">${ok ? I.check : I.alert}</span><div><b>${ok ? 'Alles im Normalbereich' : `${v.outside} ${v.outside === 1 ? 'Wert' : 'Werte'} auffällig`}</b></div></div>`;
  const rows = v.items
    .map((x) => {
      if (x.status === 'na') return `<div class="vital"><span class="vl">${x.label}</span><span class="vv">${fmtVital(x)}</span><span class="vs muted">lernt noch</span></div>`;
      const color = x.bad ? 'var(--red)' : x.status === 'ok' ? 'var(--green)' : 'var(--yellow)';
      return `<div class="vital full"><span class="vl">${x.label}</span><span class="vv" style="color:${x.bad ? 'var(--red)' : 'inherit'}">${fmtVital(x)}</span>${rangeBar(x.value, x.lo, x.hi, color)}<span class="vr muted">normal ${fmtRange(x)}</span></div>`;
    })
    .join('');
  return `<section class="card bodycheck"><h2>Körper-Check${infoBtn('body')}</h2>${head}<div class="vitals">${rows}</div></section>`;
}
const fmtVital = (x) => (x.delta ? `${sign(x.value, 1)} ${x.unit}` : `${x.digits ? de1(x.value) : Math.round(x.value)} ${x.unit}`);
const fmtRange = (x) => (x.delta ? `${sign(x.lo, 1)} bis ${sign(x.hi, 1)}` : x.digits ? `${de1(x.lo)}–${de1(x.hi)}` : `${Math.round(x.lo)}–${Math.round(x.hi)}`);

function stressCard(d) {
  const m = state.model;
  const s = E.stressSummary(d);
  if (!s.series?.length && !s.minutes && s.avg == null) return '';
  const now = E.stressNow(d);
  const isToday = d.date === todayIso();
  const gauge = now
    ? arcGauge({ value: now.value, max: 100, label: String(now.value), sub: isToday && now.at != null ? `${now.level} · ${clockDE(now.at)}` : `${now.level} · zuletzt` })
    : '';
  let chart = '';
  if (s.series?.length || s.battery?.length) {
    const slots = (series) => {
      const arr = new Array(144).fill(null);
      for (const [min, v] of series || []) arr[Math.floor(min / 10)] = v;
      return arr;
    };
    const labels = new Array(144).fill('').map((_, k) => (k % 36 === 0 ? `${k / 6}:00` : ''));
    chart = `${lines({ series: [{ values: slots(s.series), color: 'var(--awake)', width: 1.8 }, { values: slots(s.battery), color: 'var(--green)', width: 2.4 }], labels, every: 1, fixed: [0, 100], height: 130 })}
      <div class="legend"><span><i style="background:var(--awake)"></i>Stress</span><span><i style="background:var(--green)"></i>Body Battery</span></div>`;
  }
  let split = '';
  if (s.minutes) {
    const total = s.minutes.rest + s.minutes.low + s.minutes.med + s.minutes.high || 1;
    const seg = (v, c) => `<i style="width:${(100 * v) / total}%;background:${c}"></i>`;
    split = `<div class="stressbar">${seg(s.minutes.rest, 'var(--strain)')}${seg(s.minutes.low, '#1ee08e')}${seg(s.minutes.med, 'var(--yellow)')}${seg(s.minutes.high, 'var(--red)')}</div>
      <div class="legend"><span>Ruhe ${E.fmtDur(s.minutes.rest)}</span><span>Niedrig ${E.fmtDur(s.minutes.low)}</span><span>Mittel ${E.fmtDur(s.minutes.med)}</span><span>Hoch ${E.fmtDur(s.minutes.high)}</span></div>`;
  }
  const week = E.stressDays(m, d.i, 7);
  const weekChart = week.some((x) => x.v != null)
    ? `<h3 class="subhead">Letzte 7 Tage</h3>${bars({ values: week.map((x) => ({ v: x.v, color: x.v == null ? 'var(--track)' : x.v >= 50 ? 'var(--red)' : x.v >= 26 ? 'var(--yellow)' : 'var(--green)' })), labels: week.map((x) => wdShort(x.date)), max: 70, height: 96 })}`
    : '';
  const peak = E.stressPeak(s.series);
  const notes = [peak && peak.avg >= 35 ? `Am meisten Stress zwischen ${clockDE(peak.from)} und ${clockDE(peak.to)} Uhr (Ø ${Math.round(peak.avg)}).` : ''].filter(Boolean).join(' ');
  return card(
    'Stress-Monitor',
    `${gauge}${chart}${split}${weekChart}${note(notes)}<button class="btn ghost breathe-btn" data-act="breathe">${I.lungs}Atemübung starten</button>`,
    'stressmon',
    'stress',
  );
}

function ageCard(m) {
  const a = E.healthAge(m);
  if (!a) return '';
  const younger = a.diff <= 0;
  const color = younger ? '#1ee08e' : '#ffb13d';
  const rows = a.items
    .map((x) => {
      const pos = Math.max(4, Math.min(96, 50 - (x.years / 4) * 46));
      return `<div class="agerow2"><div class="ar-top"><span>${x.label}</span><b>${esc(x.value)}</b><em class="${x.years <= 0 ? 'up' : 'down'}">${sign(x.years, 1)} J.</em></div><div class="ar-track"><i style="left:${pos}%"></i></div></div>`;
    })
    .join('');
  const worst = a.items.find((x) => x.years > 0.3);
  const pace = E.paceOfAging(m);
  return card(
    'Puls-Alter',
    `<div class="agehero">
      <div class="ah-side"><b class="${younger ? 'up' : 'down'}">${de1(Math.abs(a.diff))}</b><span>Jahre ${younger ? 'jünger' : 'älter'}</span></div>
      ${orb({ size: 156, color, label: de1(a.pulsAge), sub: 'Puls-Alter' })}
      ${pace ? `<div class="ah-side"><b class="${pace.pace <= 1 ? 'up' : 'down'}">${pace.pace > 0 ? '' : '−'}${de1(Math.abs(pace.pace))}x</b><span>Tempo des Alterns</span></div>` : `<div class="ah-side"><b>${a.age}</b><span>Echtes Alter</span></div>`}
    </div>
    ${pace ? `<p class="ah-note">Echtes Alter ${a.age} · Tempo: ${pace.pace <= 1 ? 'du alterst langsamer als die Zeit' : 'du alterst gerade schneller als die Zeit'} (letzte ${pace.days} Tage)</p>` : ''}
    <div class="ar-legend"><span>älter</span><span>jünger</span></div>
    ${rows}${worst ? `<p class="small" style="margin-top:10px">Größter Hebel: <b>${worst.label}</b> – ${esc(worst.better)}</p>` : ''}`,
    'agecard',
    'age',
  );
}

function influencesCard(m, limit = Infinity) {
  const imp = E.journalImpacts(m, journal(), questions());
  const solid = imp.filter((x) => !x.pending);
  const pending = imp.filter((x) => x.pending);
  const inf = m.influences;
  const items = [];
  for (const x of solid) items.push({ label: x.label + (x.solid ? '' : ' (vorläufig)'), diff: x.diff, sub: `${Math.round(x.yes)} % statt ${Math.round(x.no)} %` });
  for (const x of inf.ready ? inf.items : []) items.push({ label: x.title, diff: x.diff, sub: `${Math.round(x.a)} % statt ${Math.round(x.b)} %` });
  items.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const more = items.length > limit ? `<button class="linkbtn" data-tab="trends">Alle ${items.length} ansehen</button>` : '';
  const html = items
    .slice(0, limit)
    .map((x) => `<div class="impact"><div class="iname">${esc(x.label)}<small>${x.sub}</small></div>${impactBar(x.diff)}<div class="ival ${x.diff >= 0 ? 'up' : 'down'}">${sign(x.diff)}</div></div>`)
    .join('');
  const empty = !items.length ? '<p class="muted small">Mach jeden Morgen den Morgen-Check – nach ein paar Wochen siehst du hier, was dir hilft und was dir schadet.</p>' : '';
  const hint = pending.length ? `<p class="muted small" style="margin-top:8px">Sammelt noch Daten: ${pending.map((x) => esc(x.label)).join(', ')}</p>` : '';
  return card('Was deine Recovery beeinflusst', `${empty}${html}${more}${hint}`, '', 'journal');
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
      ${orbRing(ring({ value: d.perf, max: 100, color: 'var(--sleep)', size: 184, stroke: 17, label: `${Math.round(d.perf)}%`, sub: 'Performance', labelSize: 48, count: Math.round(d.perf), suffix: '%', anim, glow: true }), HEX.sleep, 142, [
        { k: 'Effizienz', v: isNum(d.eff) ? Math.round(d.eff * 100) : null, u: '%' },
        { k: 'Tief', v: isNum(d.stages?.deep) ? Math.round(d.stages.deep) : null, u: '%' },
        { k: 'REM', v: isNum(d.stages?.rem) ? Math.round(d.stages.rem) : null, u: '%' },
        { k: 'Erholsam', v: isNum(d.restorative) ? E.fmtDur(d.restorative * 60) : null, u: 'h' },
      ])}
      <div class="hero-stats">
        <div><span>${E.fmtDur(d.sleepMin)}</span><small>geschlafen</small></div>
        <div><span>${E.fmtDur(d.need.total)}</span><small>Bedarf</small></div>
        <div><span>${isNum(s.bed) ? clockDE(s.bed) : '–'}</span><small>Beginn</small></div>
        <div><span>${isNum(s.wake) ? clockDE(s.wake) : '–'}</span><small>Ende</small></div>
      </div></section>`);
  } else {
    parts.push(card('', '<h3>Keine Schlafdaten für diese Nacht</h3><p class="muted small">Öffne kurz Garmin Connect, damit die Uhr synchronisiert.</p>'));
  }

  parts.push(isLatest ? tonightCard(E.bedtimePlan(m, i)) : card('Bedarf in dieser Nacht', needRows(d.need)));
  if (s?.levels?.length) parts.push(card('Schlafphasen', hypnogram(s.levels, s.bed, clockDE)));
  if (s) parts.push(stagesCard(d));
  if (s) {
    const t = [];
    if (d.restorative != null) t.push(tile('Erholsam', E.fmtDur(d.restorative), 'Std.', 'Tief + REM'));
    if (d.eff != null) t.push(tile('Effizienz', Math.round(d.eff * 100), '%'));
    if (d.consistency != null) t.push(tile('Konstanz', d.consistency, '%'));
    if (d.debt7 != null) t.push(tile('Schlafschuld', E.fmtDur(d.debt7), 'Std.', '7 Nächte'));
    if (s.score != null) t.push(tile('Garmin-Score', s.score));
    if (s.resp != null) t.push(tile('Atmung', de1(s.resp), '/Min.'));
    parts.push(card('Kennzahlen', `<div class="grid">${t.join('')}</div>`));
  }

  const { span, labels, every } = trendSpan();
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  parts.push(
    card(
      'Schlaf und Bedarf',
      `${bars({
        values: span.map((n) => ({ v: n.sleepMin != null ? n.sleepMin / 60 : null, color: n.perf == null ? 'var(--track)' : n.perf >= 85 ? 'var(--sleep)' : n.perf >= 70 ? 'var(--yellow)' : 'var(--red)' })),
        line: span.map((n) => n.need.total / 60),
        labels,
        every,
        min: 0,
        unit: 'Std.',
      })}<div class="legend"><span><i style="background:var(--sleep)"></i>≥ 85 %</span><span><i style="background:var(--yellow)"></i>70–84 %</span><span><i style="background:var(--red)"></i>&lt; 70 %</span><span>— Bedarf</span></div>${sleepNote(span)}`,
    ),
  );
  const win = span.slice(-14);
  const beds = win.map((n) => n.sleep?.bed).filter(isNum);
  const wakes = win.map((n) => n.sleep?.wake).filter(isNum);
  parts.push(card('Schlafenszeiten', `${sleepWindows(win.map((n) => ({ bed: n.sleep?.bed ?? null, wake: n.sleep?.wake ?? null, label: state.range === 7 ? wdShort(n.date) : shortDate(n.date) })), clockDE)}
    ${beds.length >= 3 ? note(`Im Schnitt eingeschlafen um ${clockDE(E.mean(beds))} (±${Math.round(E.sd(beds) || 0)} Min.), aufgewacht um ${clockDE(E.mean(wakes))} (±${Math.round(E.sd(wakes) || 0)} Min.). Je gleichmäßiger, desto besser deine Recovery.`) : ''}`));
  return parts.join('');
}

function sleepNote(span) {
  const nights = span.filter((n) => n.sleepMin != null);
  if (nights.length < 2) return '';
  const avg = E.mean(nights.map((n) => n.sleepMin));
  const need = E.mean(nights.map((n) => n.need.total));
  const ok = nights.filter((n) => n.perf >= 85).length;
  return note(`Ø ${E.fmtDur(avg)} Std. Schlaf bei Ø ${E.fmtDur(need)} Std. Bedarf · ${ok} von ${nights.length} Nächten über 85 %.`);
}

function needRows(need) {
  const row = (k, v) => `<div class="need-row"><span>${k}</span><span class="num">${v}</span></div>`;
  return [
    row('Basis', `${E.fmtDur(need.base)} Std.`),
    need.strain >= 1 ? row('+ harter Vortag', `${Math.round(need.strain)} Min.`) : '',
    need.debt >= 1 ? row('+ Schlafschuld', `${Math.round(need.debt)} Min.`) : '',
    need.recovery ? row('+ Erholung', `${need.recovery} Min.`) : '',
    `<div class="need-row total"><span>Bedarf</span><span class="num">${E.fmtDur(need.total)} Std.</span></div>`,
  ].join('');
}

function tonightCard(plan) {
  return `<section class="card"><h2>Schlafplaner · heute Nacht${infoBtn('sleep')}</h2>
    <div class="bedtimes">${plan.options.map((o, k) => `<div class="bedtime ${k === 0 ? 'main' : ''}"><div class="l">${o.label}</div><div class="t">${clockDE(o.bed)}</div><div class="l">${E.fmtDur(o.sleepMin)} Std.</div></div>`).join('')}</div>
    <p class="muted small" style="margin:10px 0">Ins Bett gehen, um ${clockDE(plan.wake)} aufzustehen.</p>
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
    .map(([name, p, color, [lo, hi], secs]) => `<div class="stage"><span>${name}</span><div class="bar"><u style="left:${lo}%;width:${hi - lo}%"></u><i style="width:${Math.min(100, p)}%;background:${color}"></i></div><span class="pv">${Math.round(p)} % · ${E.fmtDur(secs / 60)}</span></div>`)
    .join('');
  return card('Phasen', `${rows}${s.awake != null ? `<p class="muted small" style="margin-top:6px">Wach: ${Math.round(s.awake / 60)} Min. · heller Bereich = normal</p>` : ''}`);
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
    ${orbRing(ring({ value: d.strain, max: 21, color: 'var(--strain)', size: 184, stroke: 17, label: de1(d.strain), sub: 'Strain von 21', band: d.target ? [d.target.low, d.target.high] : null, labelSize: 48, count: d.strain, digits: 1, anim, glow: true }), HEX.strain, 142, [
      { k: 'Ziel', v: d.target ? `${de1(d.target.low)}–${de1(d.target.high)}` : null },
      { k: 'Zone 4–5', v: d.zoneMin ? Math.round(d.zoneMin[3] + d.zoneMin[4]) : null, u: 'min' },
      { k: 'Training', v: d.acts.length, u: d.acts.length === 1 ? 'Einheit' : 'Einh.' },
      { k: 'Stress', v: isNum(d.stats?.stress) ? Math.round(d.stats.stress) : null },
    ])}
    <div class="hero-stats three">
      <div><span>${d.stats?.kcal != null ? int(d.stats.kcal) : '–'}</span><small>kcal</small></div>
      <div><span>${d.stats?.steps != null ? int(d.stats.steps) : '–'}</span><small>Schritte</small></div>
      <div><span>${d.zoneMin ? d.zoneMin.reduce((a, b) => a + b, 0) : '–'}</span><small>aktive Min.</small></div>
    </div></section>`);

  parts.push(
    card(
      'Strain-Coach',
      `${d.target ? `<div class="row between"><span class="muted small">Dein Ziel heute</span><span class="target-pill">${de1(d.target.low)}–${de1(d.target.high)}</span></div>${strainGauge(d.strain, d.target)}` : '<p class="muted small">Ohne Recovery kein Ziel.</p>'}
      ${d.target && d.strain != null ? `<p class="small" style="margin-bottom:4px">Bisher <b>${de1(d.strain)}</b> von deinem Ziel <b>${de1(d.target.low)}–${de1(d.target.high)}</b> (passend zu Recovery ${d.recovery ?? '–'} %).</p>` : ''}
      ${coach.remaining ? `<p class="small"><b>${esc(coach.remaining.text)}</b></p>` : ''}
      ${coach.plan ? `<p class="small muted" style="margin-top:6px">${esc(coach.plan)}</p>` : ''}`,
      '',
      'strain',
    ),
  );

  if (d.acts.length) parts.push(card('Aktivitäten', d.acts.map(actRow).join('')));
  const series = d.raw.hr?.series;
  if (series?.length > 5) {
    const top = series.reduce((a, b) => (b[1] > a[1] ? b : a));
    parts.push(card('Puls im Tagesverlauf', `${hrCurve(series, zones, colors)}<div class="legend">${zones.map((z, k) => `<span><i style="background:${colors[k]}"></i>Z${z.zone}</span>`).join('')}</div>
      ${note(`Höchster Puls ${top[1]} bpm gegen ${clockDE(top[0])} Uhr · Ruhepuls ${d.rhrRef} bpm. Belastung zählt ab Zone 1 (${zones[0].lo} bpm) – je höher die Zone, desto mehr.`)}`));
  }
  if (d.zoneMin && d.zoneMin.some((v) => v > 0)) {
    const max = Math.max(1, ...d.zoneMin);
    parts.push(card('Zeit in Pulszonen', `${zones.map((z, k) => `<div class="zonebar"><span>Z${z.zone}</span><div class="bar"><i style="width:${(100 * d.zoneMin[k]) / max}%;background:${colors[k]}"></i></div><span class="m">${d.zoneMin[k]} Min.</span></div>`).join('')}
      <p class="muted small" style="margin-top:8px">${zones.map((z) => `Z${z.zone} ${z.lo}–${z.hi}`).join(' · ')} bpm</p>`));
  }
  if (d.load) {
    const r = d.load.ratio;
    const [label, color] = r > 1.5 ? ['Belastungsspitze', 'var(--red)'] : r > 1.3 ? ['Steigt schnell', 'var(--yellow)'] : r >= 0.8 ? ['Optimal', 'var(--green)'] : ['Erholungsphase', 'var(--strain)'];
    const pos = Math.max(0, Math.min(100, ((r - 0.4) / 1.4) * 100));
    parts.push(card('Trainingslast', `<div class="row between"><div class="bignum">${r.toFixed(2).replace('.', ',')}</div><div style="color:${color};font-weight:750">${label}</div></div>
      <div class="acwr"><i></i><i></i><i></i><i></i><b style="left:${pos}%"></b></div>
      <div class="acwr-l"><span>0,4</span><span>0,8</span><span>1,3</span><span>1,5</span><span>1,8</span></div>
      ${note(`Deine letzten 7 Tage im Vergleich zu den 4 Wochen davor. ${r > 1.5 ? 'Du hast deutlich mehr gemacht als gewohnt – jetzt nicht weiter steigern.' : r > 1.3 ? 'Du steigerst gerade schnell – gut beobachten.' : r >= 0.8 ? 'Genau richtig: Du baust Fitness auf, ohne dich zu überlasten.' : 'Weniger als sonst – gut zur Erholung, auf Dauer verlierst du aber Fitness.'}`)}`, '', 'load'));
  }
  const { span, labels, every } = trendSpan();
  const avg7 = span.map((x) => {
    const w = m.days.slice(Math.max(0, x.i - 6), x.i + 1).map((y) => y.strain).filter(isNum);
    return w.length >= 3 ? E.mean(w) : null;
  });
  parts.push(`<h2 class="section">Verlauf</h2>${rangeSeg()}`);
  const strains = span.filter((x) => x.strain != null);
  const peak = strains.length ? strains.reduce((a, b) => (b.strain > a.strain ? b : a)) : null;
  parts.push(card('Strain', `${bars({ values: span.map((x) => ({ v: x.strain, color: 'var(--strain)' })), line: avg7, labels, every, max: 21 })}<div class="legend"><span><i style="background:var(--strain)"></i>pro Tag</span><span>— 7-Tage-Schnitt</span></div>
    ${peak ? note(`Ø ${de1(E.mean(strains.map((x) => x.strain)))} pro Tag · höchster ${de1(peak.strain)} am ${shortDate(peak.date)} · ${strains.filter((x) => x.strain >= 14).length} harte Tage (ab 14).`) : ''}`));
  return parts.join('');
}

// ------------------------------------------------------------------ Trends (Unterseite)

function monthCard(m) {
  const r = E.monthlyAssessment(m);
  if (!r) return '';
  const c = r.current;
  const p = r.previous;
  const cell = (label, cur, prev, fmt, better) => {
    if (cur == null) return '';
    const delta = prev == null ? null : cur - prev;
    const cls = delta == null || Math.abs(delta) < 1e-6 ? 'muted' : (delta > 0) === better ? 'up' : 'down';
    return `<div class="mcell"><span>${label}</span><b>${fmt(cur)}</b><em class="${cls}">${delta == null ? '–' : `${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))}`}</em></div>`;
  };
  return `<section class="card"><h2>Monatsbericht</h2>
    <div class="verdict ${r.verdict.tone}">${esc(r.verdict.label)}</div>
    <p style="margin:10px 0 12px">${esc(r.verdict.text)}</p>
    <div class="mgrid">
      ${cell('Recovery', c.recovery, p.recovery, (v) => `${Math.round(v)} %`, true)}
      ${cell('HRV', c.hrv, p.hrv, (v) => `${Math.round(v)} ms`, true)}
      ${cell('Ruhepuls', c.rhr, p.rhr, (v) => `${de1(v)}`, false)}
      ${cell('Schlaf', c.sleep, p.sleep, (v) => E.fmtDur(v), true)}
      ${cell('Strain', c.strain, p.strain, (v) => de1(v), true)}
      ${cell('Schritte', c.steps, p.steps, (v) => int(v), true)}
    </div>
    <p class="note">Letzte 30 Tage gegen die 30 davor · ${c.green} grüne Tage · ${c.training} Trainingstage${r.best ? ` · beste Recovery ${r.best.recovery} % am ${shortDate(r.best.date)}` : ''}</p>
  </section>`;
}

function habitsCard(m) {
  const t = E.journalTrends(journal(), questions(), m.days[m.days.length - 1].date, 30);
  if (!t.answered) return '';
  const max = Math.max(1, ...t.items.map((x) => x.count));
  const rows = t.items
    .map((x) => `<div class="hrow"><span>${esc(x.label)}</span><div class="hbar"><i style="width:${(100 * x.count) / max}%"></i></div><b>${x.count}×</b></div>`)
    .join('');
  return card('Gewohnheiten · 30 Tage', `${rows || '<p class="muted small">Noch nichts angekreuzt.</p>'}<p class="note">An ${t.answered} von 30 Tagen beantwortet.</p>`);
}

function viewTrends() {
  const m = state.model;
  const last = m.days.length - 1;
  const w = E.weeklyAssessment(m, last);
  const c = w.current;
  const p = w.previous;
  const row = (name, cur, prev, fmt, better, fmtDelta = (v) => sign(v, Math.abs(v) < 10 ? 1 : 0)) => {
    if (cur == null) return '';
    const delta = prev == null ? null : cur - prev;
    const good = delta == null || Math.abs(delta) < 1e-9 ? '' : (delta > 0) === better ? 'up' : 'down';
    return `<tr><td>${name}</td><td>${fmt(cur)}</td><td class="muted">${prev == null ? '–' : fmt(prev)}</td><td class="${good}">${delta == null ? '' : fmtDelta(delta)}</td></tr>`;
  };
  const parts = [];
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
    </table></section>`);
  parts.push(lifeInsightsCard());
  parts.push(monthCard(m));
  parts.push(calendarCard(m));
  parts.push(influencesCard(m));
  parts.push(habitsCard(m));
  parts.push(journalListCard(m));
  const span = m.days.slice(Math.max(0, last - 89));
  parts.push(card('HRV · 3 Monate', `${lines({ series: [{ values: span.map((x) => x.hrv7), color: 'var(--sleep)', width: 2.5 }], band: { lo: span.map((x) => x.hrvNormal?.[0] ?? null), hi: span.map((x) => x.hrvNormal?.[1] ?? null) }, labels: span.map((x) => shortDate(x.date)), every: 21, unit: 'ms' })}`));
  const weeks = [];
  for (let k = last; k >= 0 && weeks.length < 13; k -= 7) weeks.unshift(m.days.slice(Math.max(0, k - 6), k + 1));
  const wavg = (f) => weeks.map((wk) => {
    const v = wk.map(f).filter(isNum);
    return v.length ? E.mean(v) : null;
  });
  const wl = weeks.map((wk) => shortDate(wk[0].date));
  parts.push(card('Wochenschnitt Recovery', bars({ values: wavg((x) => x.recovery).map((v) => ({ v, color: v == null ? 'var(--track)' : scoreColor(v) })), labels: wl, every: 3, max: 100 })));
  parts.push(card('Wochenschnitt Schlaf', bars({ values: wavg((x) => (x.sleepMin == null ? null : x.sleepMin / 60)).map((v) => ({ v, color: 'var(--sleep)' })), labels: wl, every: 3, min: 0, unit: 'Std.' })));
  return parts.join('');
}

function calendarCard(m) {
  const last = m.days.length - 1;
  const lastDate = m.days[last].date;
  const offset = (E.weekday(lastDate) + 6) % 7;
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
    const tr = T.sessionsOn(d, T.effectiveLabels(m, splitLabels()).map);
    const mark = tr.length ? `<em class="k-${tr[0].kind}">${esc(tr[0].label)}${tr.length > 1 ? '+' : ''}</em>` : '';
    cells.push(`<button class="cal ${d.zone ? 'z' : 'none'} ${idx === state.sel ? 'on' : ''}" data-goto="${idx}"${d.zone ? ` style="--z:${zoneColor(d.zone)}"` : ''}><span>${Number(date.slice(8))}</span>${d.recovery != null ? `<small>${d.recovery}</small>` : ''}${mark}</button>`);
  }
  return card('Kalender · Recovery und Training', `<div class="calgrid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((x) => `<span class="calh">${x}</span>`).join('')}${cells.join('')}</div>`);
}

function journalListCard(m) {
  const j = journal();
  const last = m.days.length - 1;
  const rows = [];
  for (let k = last - 1; k >= Math.max(0, last - 7); k--) {
    const date = m.days[k].date;
    const a = j[date];
    const yes = a?._done ? questions().filter((q) => a[q.id]).map((q) => q.label) : null;
    rows.push(`<button class="jrow" data-act="journal" data-date="${date}"><span class="jd">${wdShort(date)} ${shortDate(date)}</span><span class="jt ${yes ? '' : 'muted'}">${yes ? esc(yes.join(' · ') || 'Nichts Besonderes') : 'offen – antippen'}</span><span class="go">›</span></button>`);
  }
  return card('Morgen-Check · letzte Tage', rows.join(''));
}

// ------------------------------------------------------------------ Coach (Chat)

const coachApp = {
  model: () => state.model,
  journal,
  trainingOpts: () => ({ labels: splitLabels(), feel: feelOn(state.model.days[state.model.days.length - 1].date) }),
  reportExtra,
  saveJournal: (date, answers) => saveJournal(date, answers),
  saveSettings: (patch) => {
    const user = { ...ls.get(LS.settings, {}), ...patch };
    ls.set(LS.settings, user);
    state.model = E.analyze(state.store, user);
  },
  profile,
  saveProfile: (patch) => {
    ls.set(LS.profile, { ...profile(), ...patch });
  },
  changed: () => {},
};

function viewCoach() {
  const cfg = Coach.coachConfig();
  if (!cfg.apiKey) {
    return `<section class="card coach-empty">
      <div class="bigic">${I.coach}</div>
      <h3>Dein persönlicher Coach</h3>
      <p class="muted">Frag alles zu Training, Schlaf und Erholung – der Coach kennt deine Daten der letzten 90 Tage.</p>
      <button class="btn" data-act="setup-coach">Coach aktivieren</button>
    </section>`;
  }
  const chat = Coach.loadChat();
  const msgs = Coach.visibleMessages(chat);
  const bubbles = msgs.map((m) => (m.role === 'user' ? `<div class="msg user">${esc(m.text)}</div>` : `<div class="msg bot">${Coach.md(m.text)}</div>`)).join('');
  const welcome = `<div class="msg bot"><p>Hi! Ich kenne deine Garmin-Daten und deine Recovery. Frag mich einfach – zum Beispiel:</p></div>
    <div class="suggest">${Coach.SUGGESTIONS.map((q) => `<button class="qchip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  const live = state.chat.busy
    ? `<div class="msg bot" id="livebubble">${state.chat.stream ? Coach.md(state.chat.stream) : `<span class="typing"><i></i><i></i><i></i></span>`}${state.chat.status && !state.chat.stream ? `<p class="muted small">${esc(state.chat.status)}</p>` : ''}</div>`
    : '';
  const err = state.chat.error ? `<div class="msg err">${esc(state.chat.error)}</div>` : '';
  return `<div class="chat" id="chat">${msgs.length ? '' : welcome}${bubbles}${live}${err}</div>
    <form class="composer" data-form="ask">
      <textarea id="askbox" rows="1" placeholder="Frag deinen Coach …" enterkeyhint="send"></textarea>
      <button class="sendbtn" type="submit" ${state.chat.busy ? 'disabled' : ''} aria-label="Senden">${I.send}</button>
    </form>`;
}

function scrollChat() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
}

const chatUi = {
  update() {
    if (state.tab === 'coach') {
      render();
      scrollChat();
    }
  },
  stream(text) {
    state.chat.stream = text;
    if (text) state.chat.status = '';
    const el = document.getElementById('livebubble');
    if (el && text) {
      el.innerHTML = Coach.md(text);
      scrollChat();
    }
  },
  status(text) {
    state.chat.status = text;
    if (state.tab === 'coach' && !state.chat.stream) render();
  },
};

async function askCoach(text) {
  const q = text.trim();
  if (!q || state.chat.busy) return;
  if (!state.model || state.model.empty) return toast('Noch keine Daten für den Coach.');
  state.chat = { busy: true, stream: null, status: '', error: '' };
  render();
  scrollChat();
  try {
    await Coach.ask(q, coachApp, chatUi);
  } catch (e) {
    state.chat.error = e.message;
  } finally {
    state.chat.busy = false;
    state.chat.stream = null;
    if (state.tab === 'coach') {
      render();
      scrollChat();
    }
  }
}

// ------------------------------------------------------------------ Sheets (Morgen-Check, Erklärungen, Einrichtung)

function openSheet(sheet) {
  state.sheet = sheet;
  renderSheet();
}
function closeSheet() {
  state.sheet = null;
  renderSheet();
}

function renderSheet() {
  const sh = state.sheet;
  if (!sh) {
    sheetEl.innerHTML = '';
    sheetEl.hidden = true;
    return;
  }
  let body = '';
  if (sh.type === 'journal') {
    const answers = journal()[sh.date] || {};
    const dayName = dayTitle(sh.date) === 'Gestern' ? 'gestern' : `am ${longDate(sh.date)}`;
    const t = answers._t || {};
    body = `<h3>Morgen-Check</h3><p class="muted">Was war ${dayName}? Antippen, was passt.</p>
      <div class="lf-grid big">${questions().map((q) => `<button class="lf-btn qchip ${answers[q.id] ? 'on' : ''}" data-q="${q.id}"><span class="lf-ic">${lifeIcon(q.id)}${t[q.id]?.length ? `<b>${t[q.id].length}</b>` : ''}</span><span class="lf-l">${esc(Life.byId[q.id]?.ask || q.label)}</span>${t[q.id]?.length ? `<small>${t[q.id].join(' · ')}</small>` : ''}</button>`).join('')}<button class="lf-btn add" data-act="q-add"><span class="lf-ic">${I.plus}</span><span class="lf-l">Eigene Frage</span></button></div>
      <button class="btn" data-act="sheet-save">Speichern</button>
      <button class="btn ghost" data-act="sheet-none">Nichts davon</button>`;
  } else if (sh.type === 'logged') {
    const b = Life.byId[sh.id];
    body = `<div class="lg-head"><span class="lf-ic on">${lifeIcon(sh.id)}</span><div><h3>${esc(b.label)} · ${esc(sh.time)}</h3><p class="muted small">Eingetragen</p></div></div>
      <ul class="lg-list">${sh.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="muted small">${esc(Life.why(sh.id))}</p>
      <button class="btn" data-act="sheet-close">Alles klar</button>
      <button class="btn ghost" data-act="life-undo" data-id="${sh.id}" data-t="${esc(sh.time)}">Doch nicht – rückgängig</button>`;
  } else if (sh.type === 'lifemore') {
    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    body = `<h3>Eintragen</h3><p class="muted small">Für heute – auch mit anderer Uhrzeit, falls du es vergessen hast.</p>
      <label class="field"><span>Uhrzeit</span><input id="life-time" type="time" value="${cur}"></label>
      <div class="lf-grid big">${Life.BEHAVIORS.map((b) => `<button class="lf-btn" data-act="life-at" data-id="${b.id}"><span class="lf-ic">${lifeIcon(b.id)}</span><span class="lf-l">${esc(b.label)}</span></button>`).join('')}</div>
      <button class="btn ghost" data-act="sheet-close">Fertig</button>`;
  } else if (sh.type === 'info') {
    const [title, text] = INFO[sh.key] || ['', ''];
    body = `<h3>${title}</h3><p style="margin:10px 0 18px">${text}</p><button class="btn ghost" data-act="sheet-close">Verstanden</button>`;
  } else if (sh.type === 'setup-sync') {
    const gh = ghConfig();
    const url = `https://github.com/settings/personal-access-tokens/new?name=Puls+Sync&description=Startet+den+Garmin-Abruf+der+Puls-App&target_name=${encodeURIComponent((gh.repo || 'x/').split('/')[0])}&expires_in=365&actions=write`;
    body = `<h3>Automatisch aktualisieren</h3>
      <p class="muted">Damit Puls bei jedem Öffnen sofort neue Daten holt, braucht die App einen GitHub-Schlüssel, der nur den Abruf starten darf.</p>
      <ol class="steps">
        <li>Tippe auf <b>Schlüssel erstellen</b> – GitHub öffnet sich mit allem vorausgefüllt.</li>
        <li>Bei <b>Repository access</b>: <b>Only select repositories</b> → <b>puls</b> wählen.</li>
        <li>Ganz unten <b>Generate token</b>, dann den Schlüssel kopieren.</li>
        <li>Zurück zu Puls und hier einfügen.</li>
      </ol>
      <a class="btn ghost" href="${url}" target="_blank" rel="noopener">Schlüssel erstellen ↗</a>
      <input id="gh-token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(gh.token)}" style="margin-top:10px">
      <button class="btn" data-act="save-sync">Speichern & testen</button>`;
  } else if (sh.type === 'setup-coach') {
    const cfg = Coach.coachConfig();
    body = `<h3>KI-Coach aktivieren</h3>
      <p class="muted">Der Coach nutzt Claude von Anthropic. Dafür brauchst du einen eigenen Schlüssel – er bleibt nur auf diesem iPhone.</p>
      <ol class="steps">
        <li>Tippe auf <b>Schlüssel erstellen</b> und melde dich an bzw. lege ein Konto an.</li>
        <li>Unter <b>Billing</b> etwas Guthaben aufladen (z. B. 5 €). Eine Frage kostet ca. 2–4 Cent.</li>
        <li><b>Create Key</b> tippen, Namen „Puls“ eingeben, Schlüssel kopieren.</li>
        <li>Hier einfügen.</li>
      </ol>
      <a class="btn ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Schlüssel erstellen ↗</a>
      <input id="coach-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(cfg.apiKey)}" style="margin-top:10px">
      <button class="btn" data-act="save-coach">Speichern & testen</button>`;
  } else if (sh.type === 'breathe') {
    body = `<h3>Atemübung</h3><p class="muted small">4 Sekunden ein, 6 Sekunden aus – senkt Puls und Stress spürbar. 2 Minuten.</p>
      <div class="breath"><div class="breath-orb"></div><div class="breath-txt" id="breath-txt">Bereit</div></div>
      <div class="breath-time" id="breath-time">2:00</div>
      <button class="btn" data-act="breath-start" id="breath-btn">Start</button>
      <button class="btn ghost" data-act="sheet-close">Schließen</button>`;
  } else if (sh.type === 'goals') {
    const g = { train: 4, sleepH: 7.5, steps: 8000, ...ls.get(LS.goals, {}) };
    body = `<h3>Wochenziele</h3>
      <div class="fields2" style="margin-top:12px">
        <label class="field"><span>Trainingstage pro Woche</span><input data-goal="train" type="number" inputmode="numeric" min="1" max="7" value="${g.train}"></label>
        <label class="field"><span>Schlaf pro Nacht (Std.)</span><input data-goal="sleepH" type="number" inputmode="decimal" step="0.25" min="5" max="10" value="${g.sleepH}"></label>
      </div>
      <label class="field"><span>Schritte pro Tag</span><input data-goal="steps" type="number" inputmode="numeric" step="500" min="1000" max="40000" value="${g.steps}"></label>
      <button class="btn" data-act="goals-save">Speichern</button>`;
  } else if (sh.type === 'act') {
    const d = state.model.days[state.sel];
    const a = d.acts[sh.idx];
    if (a) {
      const t = (k, v, u = '') => (v == null || v === '' ? '' : tile(k, v, u));
      const ml = E.muscleLoad(a);
      const zt = Array.isArray(a.zones) ? a.zones.reduce((x, y) => x + (y || 0), 0) : 0;
      const zc = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
      const zones = zt ? `<h3 class="subhead">Zeit in Pulszonen</h3>${a.zones.map((z, k) => `<div class="zonebar"><span>Z${k + 1}</span><div class="bar"><i style="width:${(100 * (z || 0)) / zt}%;background:${zc[k]}"></i></div><span class="m">${Math.round((z || 0) / 60)} Min.</span></div>`).join('')}` : '';
      body = `<h3>${esc(a.name || a.type || 'Aktivität')}</h3><p class="muted small">${esc(longDate(d.date))} · ${esc(a.start || '')}</p>
        <div class="grid" style="margin-top:12px">${t('Strain', de1(a.strain))}${t('Dauer', E.fmtDur(a.dur / 60), 'Std.')}${t('Ø Puls', a.avgHr, 'bpm')}${t('Max. Puls', a.maxHr, 'bpm')}${t('Kalorien', a.kcal != null ? int(a.kcal) : null, 'kcal')}${t('Distanz', a.dist ? (a.dist / 1000).toFixed(1).replace('.', ',') : null, 'km')}${t('Aerob', a.te != null ? de1(a.te) : null)}${t('Anaerob', a.ate != null ? de1(a.ate) : null)}${ml ? t('Muskeln', `${de1(ml.score)}`, ml.level) : ''}</div>
        ${zones}<button class="btn ghost" data-act="sheet-close" style="margin-top:14px">Schließen</button>`;
    }
  } else if (sh.type === 'profile') {
    const p = profile();
    const gp = state.store?.profile || {};
    const opt = (v, label, cur) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
    body = `<h3>Über dich</h3>
      <p class="muted small">Damit Puls dich wie ein persönlicher Arzt, Trainer und Ernährungscoach beraten kann. Alles bleibt auf diesem iPhone und geht nur an deinen KI-Coach.</p>
      <div class="fields2" style="margin-top:12px">
        <label class="field"><span>Dein Ziel</span><select data-profile="goal">${opt('', 'bitte wählen', p.goal)}${Object.entries(E.GOALS).map(([k, v]) => opt(k, v, p.goal)).join('')}</select></label>
        <label class="field"><span>Ernährung</span><select data-profile="diet">${Object.entries(E.DIETS).map(([k, v]) => opt(k, v, p.diet || 'alles')).join('')}</select></label>
        <label class="field"><span>Gewicht (kg)</span><input data-profile="weight" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="${gp.weight ? `Garmin: ${String(gp.weight).replace('.', ',')}` : 'z. B. 78'}" value="${p.weight || ''}"></label>
        <label class="field"><span>Größe (cm)</span><input data-profile="height" type="number" inputmode="numeric" min="120" max="230" placeholder="${gp.height ? `Garmin: ${gp.height}` : 'z. B. 180'}" value="${p.height || ''}"></label>
      </div>
      <label class="field"><span>Training & Wünsche</span><textarea data-profile="training" rows="2" placeholder="z. B. 3× Kraft, 2× Laufen · Halbmarathon im April · Rücken stärken">${esc(p.training || '')}</textarea></label>
      <label class="field"><span>Essen</span><textarea data-profile="food" rows="2" placeholder="z. B. kein Fisch, Laktoseintoleranz, esse gern Pasta, wenig Zeit mittags">${esc(p.food || '')}</textarea></label>
      <label class="field"><span>Gesundheit (optional)</span><textarea data-profile="health" rows="2" placeholder="z. B. Bluthochdruck, Betablocker, Knieprobleme, Heuschnupfen">${esc(p.health || '')}</textarea></label>
      <button class="btn" data-act="profile-done" style="margin-top:12px">Fertig</button>`;
  } else if (sh.type === 'setup-pad') {
    const gh = ghConfig();
    const url = `https://api.github.com/repos/${gh.repo || 'DEIN-NAME/puls'}/actions/workflows/${WORKFLOW}/dispatches`;
    const copy = (label, value) => `<button class="copyrow" data-act="copy" data-copy="${esc(value)}"><span>${label}</span><b>Kopieren</b></button>`;
    body = `<h3>Walking-Pad (PitPat)</h3>
      <p class="muted">Am Schreibtisch zählt die Uhr kaum mit, weil dein Arm still bleibt. So kommen die Schritte von PitPat automatisch in Puls. Einmal einrichten, ca. 5 Minuten.</p>
      ${gh.token ? '' : '<p class="small" style="margin:8px 0"><b>Zuerst:</b> „Automatisch aktualisieren“ einrichten – der Kurzbefehl nutzt denselben Schlüssel.</p>'}
      <h4>1 · PitPat</h4>
      <p class="small">In PitPat die Verbindung zu <b>Apple Health</b> einschalten und <b>Schritte</b> erlauben. Danach einmal kurz laufen, damit PitPat in Health auftaucht.</p>
      <h4>2 · Kurzbefehl bauen (2 Aktionen)</h4>
      <ol class="steps small">
        <li>App <b>Kurzbefehle</b> → <b>+</b>. Oben auf den Namen tippen → <b>Puls Walking-Pad</b>.</li>
        <li>Aktion <b>Health-Messungen suchen</b>: Typ <b>Schritte</b>. Über <b>Filter hinzufügen</b>: <b>Quelle</b> ist <b>PitPat</b> und <b>Startdatum</b> ist <b>heute</b>.</li>
        <li>Aktion <b>Inhalte von URL abrufen</b>. Ins URL-Feld die Adresse einfügen ↓ (steht dort „Health-Messungen“, vorher löschen).</li>
        <li>Pfeil <b>›</b> antippen: Methode <b>POST</b> · <b>Header hinzufügen</b>: Schlüssel <b>Authorization</b>, Text = Schlüssel ↓.</li>
        <li><b>Haupttext anfordern: JSON</b> → <b>Neues Feld hinzufügen</b> → Text: <b>ref</b> = <b>main</b>. Nochmal → Wörterbuch: <b>inputs</b> → darin Text: <b>walk</b>.</li>
        <li>Ins Feld <b>walk</b>: Variable <b>Health-Messungen</b> → antippen → <b>Startdatum</b>, dann <b>;</b> tippen, wieder Health-Messungen → <b>Enddatum</b>, <b>;</b>, Health-Messungen → <b>Wert</b>.</li>
        <li>Unten <b>▶</b> antippen und Zugriff auf Health und GitHub <b>erlauben</b>.</li>
      </ol>
      ${copy('URL', url)}
      ${copy('Schlüssel (Authorization)', gh.token ? `Bearer ${gh.token}` : '')}
      <h4>3 · Automatisch starten</h4>
      <p class="small">Kurzbefehle → <b>Automation</b> → <b>+</b> → <b>App</b> → <b>PitPat</b> → <b>Wird geschlossen</b> → <b>Sofort ausführen</b> → Kurzbefehl <b>Puls Walking-Pad</b>.</p>
      <p class="muted small" style="margin-top:10px">Etwa 1 Minute nach dem Laufen steht die Einheit unter Heute → Dein Tag. Was die Uhr in der Zeit schon gezählt hat, zieht Puls ab – nichts zählt doppelt.</p>
      <button class="btn" data-act="sheet-close" style="margin-top:12px">Fertig</button>`;
  } else if (sh.type === 'setup-push') {
    body = `<h3>Benachrichtigungen</h3>
      <p class="muted">Puls meldet sich nur, wenn es etwas zu sagen gibt:</p>
      <ul class="steps"><li><b>Morgens</b>, sobald deine Nacht da ist: Recovery, Ziel und Schlaf.</li><li><b>Mittags</b>: wenn du kaum gelaufen bist oder dein Stress hoch ist.</li><li><b>Nachmittags</b>: wie viel Training bis zu deinem Ziel fehlt.</li><li><b>Früher Abend</b>: wie viele Schritte noch fehlen.</li><li><b>Abends</b>: wann du ins Bett solltest.</li></ul>
      <p class="muted small">Nur wenn es etwas zu sagen gibt – jede Art einzeln abschaltbar in den Einstellungen.</p>
      ${isStandalone() ? '' : '<p class="small" style="margin:8px 0"><b>Wichtig:</b> Das klappt nur, wenn du Puls vom Home-Bildschirm aus öffnest.</p>'}
      <button class="btn" data-act="enable-push" style="margin-top:12px">Benachrichtigungen erlauben</button>`;
  }
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<div class="backdrop" data-act="sheet-close"></div><div class="sheet" role="dialog"><div class="grab"></div>${body}</div>`;
}

let breathTimer = null;
function startBreath() {
  const box = sheetEl.querySelector('.breath');
  const txt = document.getElementById('breath-txt');
  const time = document.getElementById('breath-time');
  const btn = document.getElementById('breath-btn');
  if (!box || !txt) return;
  clearInterval(breathTimer);
  box.classList.add('run');
  btn.hidden = true;
  const t0 = Date.now();
  const total = 120;
  const tick = () => {
    if (!document.body.contains(box)) return clearInterval(breathTimer);
    const sec = (Date.now() - t0) / 1000;
    const phase = sec % 10;
    txt.textContent = phase < 4 ? 'Einatmen' : 'Ausatmen';
    const left = Math.max(0, Math.ceil(total - sec));
    time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (sec >= total) {
      clearInterval(breathTimer);
      box.classList.remove('run');
      txt.textContent = 'Geschafft';
      btn.hidden = false;
      btn.textContent = 'Nochmal';
    }
  };
  tick();
  breathTimer = setInterval(tick, 250);
}

function saveProfileFields() {
  const p = { ...profile() };
  sheetEl.querySelectorAll('[data-profile]').forEach((el) => {
    const k = el.dataset.profile;
    const v = el.value.trim();
    if (k === 'weight') {
      const n = Number(v.replace(',', '.'));
      if (v && n >= 30 && n <= 300) p.weight = Math.round(n * 10) / 10;
      else if (!v) delete p.weight;
    } else if (k === 'height') {
      const n = Number(v);
      if (v && n >= 120 && n <= 230) p.height = Math.round(n);
      else if (!v) delete p.height;
    } else if (v) p[k] = v.slice(0, 600);
    else delete p[k];
  });
  ls.set(LS.profile, p);
}
sheetEl.addEventListener('change', (e) => {
  if (e.target.matches('[data-profile]')) saveProfileFields();
});

sheetEl.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-q]');
  if (chip) {
    chip.classList.toggle('on');
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'sheet-close') closeSheet();
  if (act === 'life-at') {
    const time = document.getElementById('life-time')?.value || null;
    logLife(t.dataset.id, time);
  }
  if (act === 'life-undo') {
    const date = Life.logDate();
    saveJournal(date, Life.removeLog(journal()[date], t.dataset.id, t.dataset.t));
    closeSheet();
    render();
  }
  if (act === 'breath-start') startBreath();
  if (act === 'goals-save') {
    const g = {};
    sheetEl.querySelectorAll('[data-goal]').forEach((el) => {
      const v = Number(el.value.replace(',', '.'));
      if (Number.isFinite(v) && v > 0) g[el.dataset.goal] = v;
    });
    ls.set(LS.goals, { ...ls.get(LS.goals, {}), ...g });
    closeSheet();
    render();
    toast('Wochenziele gespeichert.');
  }
  if (act === 'q-add') {
    const label = (prompt('Eigene Frage für den Morgen-Check, z. B. „Ashwagandha“ oder „Lesen vor dem Schlafen“:') || '').trim().slice(0, 40);
    if (label) {
      const list = ls.get(LS.customQ, []);
      list.push({ id: `c_${Date.now().toString(36)}`, label });
      ls.set(LS.customQ, list);
      renderSheet();
    }
  }
  if (act === 'profile-done') {
    saveProfileFields();
    closeSheet();
    render();
    toast('Gespeichert – deine Empfehlungen sind jetzt persönlicher.');
  }
  if (act === 'copy') {
    const text = t.dataset.copy;
    if (!text) return toast('Zuerst „Automatisch aktualisieren“ einrichten.');
    try {
      await navigator.clipboard.writeText(text);
      toast('Kopiert.');
    } catch {
      prompt('Kopieren:', text);
    }
  }
  if (act === 'sheet-save' || act === 'sheet-none') {
    const prev = journal()[state.sheet.date] || {};
    const answers = { _done: true, ...(prev._t ? { _t: prev._t } : {}) };
    if (act === 'sheet-save') sheetEl.querySelectorAll('.qchip.on').forEach((c) => (answers[c.dataset.q] = true));
    saveJournal(state.sheet.date, answers);
    closeSheet();
    render();
    toast('Gespeichert – danke!');
  }
  if (act === 'save-sync') {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) return toast('Bitte den Schlüssel einfügen.');
    t.disabled = true;
    t.textContent = 'Teste …';
    const gh = ghConfig();
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/workflows/${WORKFLOW}`, { headers: ghHeaders(token) });
      if (!res.ok) throw new Error(res.status === 404 ? 'Repo nicht gefunden – „puls“ beim Schlüssel ausgewählt?' : 'Schlüssel ungültig.');
      ls.set(LS.gh, { ...ls.get(LS.gh, {}), token });
      closeSheet();
      render();
      toast('Klappt! Puls holt jetzt bei jedem Öffnen frische Daten.');
      ls.del(LS.lastTrigger);
      triggerSync({}, { quiet: true });
    } catch (err) {
      toast(err.message || 'Test fehlgeschlagen.');
      t.disabled = false;
      t.textContent = 'Speichern & testen';
    }
  }
  if (act === 'save-coach') {
    const key = document.getElementById('coach-key').value.trim();
    if (!key) return toast('Bitte den Schlüssel einfügen.');
    t.disabled = true;
    t.textContent = 'Teste …';
    const r = await Coach.testKey(key);
    if (r.ok) {
      Coach.saveCoachConfig({ apiKey: key });
      closeSheet();
      setTab('coach');
      render();
      toast('Coach ist bereit.');
    } else {
      toast(r.msg);
      t.disabled = false;
      t.textContent = 'Speichern & testen';
    }
  }
  if (act === 'enable-push') enablePush();
});

// ------------------------------------------------------------------ Einführung (erster Start)

const ONBOARDING = [
  { color: 'var(--green)', value: 78, max: 100, label: '78%', title: 'Recovery', text: 'Jeden Morgen: Wie erholt bist du? Grün heißt Gas geben, Gelb moderat, Rot Pause.' },
  { color: 'var(--strain)', value: 11.4, max: 21, label: '11,4', band: [12, 15], title: 'Strain', text: 'Wie sehr du dich heute belastest (0–21). Der äußere Bogen ist dein Tagesziel.' },
  { color: 'var(--sleep)', value: 92, max: 100, label: '92%', title: 'Schlaf', text: 'Wie viel deines Schlafbedarfs du geschafft hast – und wann du heute ins Bett solltest.' },
  { color: 'var(--green)', icon: true, title: 'Coach', text: 'Frag einfach: „Was soll ich heute trainieren?“ Der Coach kennt deine Daten.' },
];

function renderOnboarding() {
  let el = document.getElementById('onboarding');
  if (state.onboarding == null || state.view !== 'main') {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'onboarding';
    document.body.appendChild(el);
  }
  const k = state.onboarding;
  const s = ONBOARDING[k];
  const visual = s.icon ? `<div class="ob-icon">${I.coach}</div>` : ring({ value: s.value, max: s.max, color: s.color, size: 170, stroke: 14, label: s.label, band: s.band || null, labelSize: 44, glow: true });
  el.innerHTML = `<div class="ob">
    <button class="ob-skip" data-ob="done">Überspringen</button>
    <div class="ob-visual">${visual}</div>
    <h2>${s.title}</h2><p>${s.text}</p>
    <div class="ob-dots">${ONBOARDING.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn" data-ob="${k === ONBOARDING.length - 1 ? 'done' : 'next'}">${k === ONBOARDING.length - 1 ? 'Los geht’s' : 'Weiter'}</button>
  </div>`;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ob]');
  if (!t) return;
  if (t.dataset.ob === 'next') state.onboarding += 1;
  else {
    state.onboarding = null;
    ls.set(LS.onboarded, true);
  }
  render();
});

// ------------------------------------------------------------------ Einstellungen (Unterseite)

/** Geheimer Link zum Trainingskalender: kal-<HMAC(Passwort)>.ics – derselbe Name wie im Abruf. */
async function calendarUrl() {
  const pass = ls.get(LS.pass);
  if (!pass || !crypto?.subtle) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('puls-kalender-v1')));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  return new URL(`kal-${hex}.ics`, location.href.split('#')[0].split('?')[0]).href;
}

/** Schlüssel und Adresse fürs Widget (aus dem Daten-Passwort abgeleitet, wie im Abruf). */
async function widgetSetup() {
  const pass = ls.get(LS.pass);
  if (!pass || !crypto?.subtle) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = async (msg) => [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const base = location.href.split('#')[0].split('?')[0];
  const url = new URL(`w-${(await hex('puls-widget-v1')).slice(0, 24)}.json`, base).href;
  return { url, keyHex: await hex('puls-widget-key-v1'), app: new URL('./', base).href };
}

function widgetCard() {
  if (state.demo) return '';
  if (state.widget === undefined) {
    state.widget = null;
    widgetSetup()
      .then((w) => {
        state.widget = w || '';
        if (state.tab === 'settings') render();
      })
      .catch(() => (state.widget = ''));
  }
  if (!state.widget) return '';
  return `<section class="card"><h2>iPhone-Widgets</h2>
    <p class="small">Recovery, Schlaf, Strain und dein Training heute auf dem Home- und Sperrbildschirm – über die kostenlose App <b>Scriptable</b>. Die Daten bleiben verschlüsselt.</p>
    <ol class="steps">
      <li><a href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener">Scriptable</a> aus dem App Store laden.</li>
      <li>Hier <b>Widget-Code kopieren</b> tippen.</li>
      <li>Scriptable öffnen → oben rechts <b>+</b> → einfügen → oben den Namen auf <b>Puls</b> ändern → <b>Fertig</b>.</li>
      <li>Homebildschirm lange drücken → <b>+</b> → <b>Scriptable</b> → Größe wählen (klein, mittel, groß) → hinzufügen.</li>
      <li>Das neue Widget lange drücken → <b>Widget bearbeiten</b> → Script: <b>Puls</b>.</li>
    </ol>
    <button class="btn" data-act="widget-copy">Widget-Code kopieren</button>
    <p class="muted small" style="margin-top:8px">Sperrbildschirm: lange drücken → Anpassen → Sperrbildschirm → Widget-Feld → Scriptable (rund oder rechteckig) → antippen → Script: Puls. Das Widget aktualisiert sich etwa alle 20 Minuten.</p>
  </section>`;
}

function calSubscribeCard() {
  if (state.demo) return '';
  if (state.calUrl === undefined) {
    state.calUrl = null;
    calendarUrl()
      .then((u) => {
        state.calUrl = u || '';
        if (state.tab === 'settings') render();
      })
      .catch(() => (state.calUrl = ''));
  }
  const url = state.calUrl;
  if (!url) return '';
  const webcal = url.replace(/^https:/, 'webcal:');
  return `<section class="card"><h2>Trainingskalender</h2>
    <p class="small">Jedes Training als ganztägiges Ereignis – „Push“, „Pull“, „Cardio · Rad“ – in deinem Kalender. Neue Trainings kommen automatisch dazu.</p>
    <div class="calurl"><code>${esc(url)}</code></div>
    <button class="btn" data-act="cal-copy">Link kopieren</button>
    <details style="margin-top:10px"><summary>In Google Kalender abonnieren</summary><p>1. Am Computer <b>calendar.google.com</b> öffnen (in der Google-App auf dem iPhone geht das Abonnieren nicht).<br>2. Links bei „Weitere Kalender“ auf <b>+</b> → <b>Per URL</b>.<br>3. Link einfügen → <b>Kalender hinzufügen</b>. Fertig – „Puls Training“ erscheint auch in der Google-App. Google lädt Abos alle paar Stunden neu.</p></details>
    <details><summary>In Apple Kalender abonnieren</summary><p>Auf dem iPhone hier tippen: <a href="${esc(webcal)}">Kalender abonnieren</a> → <b>Abonnieren</b>. Unter Einstellungen → Kalender → Accounts → Abrufen kannst du „Alle 15 Minuten“ wählen.</p></details>
    <p class="muted small" style="margin-top:8px">Der Link ist geheim: Wer ihn kennt, sieht nur Datum und Art deiner Trainings – keine Gesundheitswerte. Push/Pull: Tippe in „Training heute“ einmal an, was dein letztes Gym war – Puls ergänzt den Rest im Wechsel.</p>
  </section>`;
}

function viewSettings() {
  const m = state.model;
  const S = m && !m.empty ? m.settings : E.resolveSettings(ls.get(LS.settings, {}), state.store?.profile || {}, []);
  const user = ls.get(LS.settings, {});
  const st = state.store?.status || {};
  const setup = setupState();
  const cfg = Coach.coachConfig();
  const authText = { ok: 'verbunden', mfa: 'wartet auf Code', error: 'Anmeldung fehlgeschlagen' }[st.auth] || 'unbekannt';
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const status = (ok) => `<span class="${ok ? 'up' : 'muted'}">${ok ? 'aktiv' : 'aus'}</span>`;

  const look = Hud.isHud() ? 'scifi' : 'premium';
  return `
  <section class="card"><h2>Darstellung</h2>
    <div class="seg look">${[['premium', 'Premium'], ['scifi', 'Sci-Fi']].map(([k, l]) => `<button data-look="${k}" class="${look === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small">${look === 'premium' ? 'Ruhig und minimalistisch. Bewegung nur in den Ringen und Kugeln.' : 'Volles HUD: Hologramm-Rahmen, Partikel-Hintergrund, Systemstart beim Öffnen.'}</p>
  </section>

  <section class="card"><h2>Einrichtung</h2>
    <button class="setrow" data-act="setup-sync"><span>Automatisch aktualisieren</span>${status(setup.sync)}</button>
    <button class="setrow" data-act="setup-coach"><span>KI-Coach</span>${status(setup.coach)}</button>
    <button class="setrow" data-act="setup-push"><span>Benachrichtigungen</span>${status(setup.push)}</button>
    <button class="setrow" data-act="setup-pad"><span>Walking-Pad (PitPat)</span>${status(setup.pad)}</button>
    ${setup.coach ? `<label class="field" style="margin-top:12px"><span>Coach-Modell</span><select data-coach-model>${Object.entries(Coach.MODELS).map(([id, mm]) => opt(id, `${mm.label} – ${mm.note}`, cfg.model)).join('')}</select></label>
    <label class="toggle"><span><b>Tagesbericht automatisch</b><small>jeden Morgen, sobald die Nacht da ist · ca. 5–15 Cent</small></span><input type="checkbox" data-report-auto ${ls.get(LS.reportAuto, true) === false ? '' : 'checked'}><i></i></label>` : ''}
  </section>

  ${setup.push ? `<section class="card"><h2>Benachrichtigungen</h2>
    ${PUSH_KINDS.map(([k, label, sub]) => `<label class="toggle"><span><b>${label}</b><small>${sub}</small></span><input type="checkbox" data-pushpref="${k}" ${ls.get(LS.pushPrefs, {})[k] === false ? '' : 'checked'}><i></i></label>`).join('')}
  </section>` : ''}

  ${widgetCard()}
  ${calSubscribeCard()}

  <section class="card"><h2>Garmin</h2>
    <p class="small">Letzter Abruf: <b>${state.demo ? 'Demo' : ago(state.store?.generated)}</b> · Garmin: <b>${authText}</b></p>
    <button class="btn" data-act="sync" style="margin-top:10px" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Aktualisiere …' : 'Jetzt aktualisieren'}</button>
    <details ${st.auth === 'mfa' ? 'open' : ''}><summary>Garmin-Code eingeben</summary>
      <p>Nur nötig, wenn Garmin dir einen Bestätigungscode per E-Mail schickt.</p>
      <input id="mfa" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" style="margin:10px 0">
      <button class="btn ghost" data-act="mfa">Code senden</button>
    </details>
  </section>

  <section class="card"><h2>Über dich</h2>
    <button class="setrow" data-act="profile"><span>Ziel, Gewicht, Ernährung & Gesundheit</span><span class="${profile().goal && (profile().weight || state.store?.profile?.weight) ? 'up' : 'muted'}">${profile().goal ? esc(E.GOALS[profile().goal] || '') : 'ausfüllen'}</span></button>
    <div class="fields2" style="margin-top:10px">
      <label class="field"><span>Geschlecht</span><select data-setting="sex">${opt('', `Auto: ${S.sex === 'female' ? 'weiblich' : 'männlich'}`, user.sex || '')}${opt('male', 'männlich', user.sex)}${opt('female', 'weiblich', user.sex)}</select></label>
      <label class="field"><span>Geburtsjahr</span><input data-setting="birthYear" type="number" inputmode="numeric" min="1930" max="2015" placeholder="${S.birthYear || 'z. B. 1990'}" value="${user.birthYear || ''}"></label>
      <label class="field"><span>Max-Puls</span><input data-setting="maxHr" type="number" inputmode="numeric" min="140" max="230" placeholder="auto: ${S.maxHrAuto}" value="${user.maxHr || ''}"></label>
      <label class="field"><span>Schlafbedarf (Std.)</span><input data-setting="sleepNeedH" type="number" inputmode="decimal" step="0.25" min="6" max="10" placeholder="auto: ${String(Math.round((S.sleepNeedAuto / 60) * 4) / 4).replace('.', ',')}" value="${user.sleepNeed ? user.sleepNeed / 60 : ''}"></label>
      <label class="field"><span>Weckzeit</span><input data-setting="wakeTime" type="time" value="${user.wakeTime || ''}"></label>
      <label class="field"><span>Hauptsport</span><select data-setting="sport">${Object.entries(E.SPORTS).map(([k, v]) => opt(k, v, S.sport)).join('')}</select></label>
    </div>
    <p class="muted small">Leer lassen = automatisch aus deinen Daten.</p>
  </section>

  <section class="card"><h2>So rechnet Puls</h2>
    <details><summary>Recovery</summary><p>HRV 50 %, Ruhepuls 20 %, Schlaf 30 % – jeweils verglichen mit deinen letzten 30 Tagen. Abzüge bei erhöhter Atemfrequenz oder Hauttemperatur. Grün ab 67 %, Gelb ab 34 %.</p></details>
    <details><summary>Strain</summary><p>Herz-Kreislauf-Belastung aus deinem Tagespuls (Banister-TRIMP), logarithmisch von 0 bis 21. Ruhetag 4–8, Training 10–14, sehr hart ab 17.</p></details>
    <details><summary>Training heute</summary><p>Puls schaut sich deine Garmin-Aktivitäten der letzten 6 Wochen an: was du trainierst (Gym, Rad …), wie oft, wie lange deine Fahrten sind und mit welchem Puls. Gym oder Rad hängt davon ab, was länger her ist als üblich und ob die Muskeln vom Vortag noch Ruhe brauchen (rund 48 Std.); bei Push/Pull kommt der jeweils andere Split. Die Dosis: Recovery unter 34 % locker, unter 50 % moderat, ab 80 % hart – eine Stufe weniger bei kurzer Nacht, HRV-Wochenschnitt unter normal oder stark gestiegener Last. Rad: Dauer aus deiner typischen Fahrt, passend zum Ziel-Strain, Puls aus deinen eigenen lockeren, normalen und zügigen Fahrten. Gym: −40 %, −20 %, volles Volumen oder +1 Satz, mit Wiederholungen in Reserve (HRV-gesteuertes Training, Autoregulation über RIR).</p></details>
    <details><summary>Infekt-Frühwarnung</summary><p>Ruhepuls, HRV, Atemfrequenz und Hauttemperatur der Nacht gegen deinen eigenen Normalwert (Tag −45 bis −3). Je Signal 1 Punkt (leicht: Ruhepuls +2, HRV −10 %, Atmung +0,5, Temperatur +0,3) oder 2 Punkte (deutlich: +4 bpm, −20 %, +1,0, +0,6 °C), +1 für die zweite auffällige Nacht in Folge, +1 für sinkenden HRV-Wochenschnitt, +3 wenn du dich angeschlagen fühlst. Ab 2 Punkten „beobachten“, ab 4 „erhöht“ (Recovery höchstens 55 %, nur lockeres Training), ab 6 „hoch“ (Recovery höchstens 33 %, Pause). Puls zeigt außerdem, welches Signal bei dir früher zuerst auffiel.</p></details>
    <details><summary>Ziel-Strain</summary><p>Mitte = 5,5 + 0,125 × Recovery, Bereich ±1,5. Gesenkt, wenn deine Last stark steigt oder Warnsignale da sind.</p></details>
    <details><summary>Schlafbedarf</summary><p>Basis + 4 Min. je Strain-Punkt über 10 am Vortag + Teil der Schlafschuld (max. 60 Min.) + 15 Min. nach roter Recovery. Schlafenszeit = Weckzeit − Bedarf ÷ Schlafeffizienz − 10 Min.</p></details>
    <details><summary>Tagesbericht</summary><p>Jeden Morgen bekommt der KI-Coach (Claude) alle deine Werte: Recovery mit Bestandteilen, Schlaf, die letzten 14 Tage, den Gesundheits-Check, deinen Morgen-Check, die berechneten Ernährungsziele und deine Angaben (Ziel, Training, Essen, Gesundheit). Er schreibt daraus eine persönliche Einschätzung wie ein Sportarzt, Trainer und Ernährungscoach. Die Zahlen rechnet Puls selbst – der Coach erklärt und verknüpft sie.</p></details>
    <details><summary>Gesundheits-Check</summary><p>Schnitt der letzten 7 Tage gegen deine eigenen Werte der bis zu 60 Tage davor: Ruhepuls (auffällig ab +4 bpm, Arzt ab +8 bpm über eine Woche oder dauerhaft über 90), HRV (auffällig ab −12 %), Atemfrequenz (Infekt-Frühzeichen), Schlaf (unter 6 Std.), Schlafrhythmus (Schwankung über 60 Min.), Blutsauerstoff (mehrere Nächte unter 92 % → Schlafapnoe abklären), Bewegung (WHO: 150 Min./Woche), VO₂max im Vergleich zum Altersschnitt.</p></details>
    <details><summary>Ernährung</summary><p>Verbrauch = dein Garmin-Gesamtverbrauch (Median der letzten 14 Tage), angepasst an den Ziel-Strain von heute (±3 % pro Strain-Punkt). Ziel: Abnehmen −18 % (an roten Tagen −10 %), Muskelaufbau +8 %. Eiweiß 1,4–2,0 g/kg (ISSN), Kohlenhydrate 3–7 g/kg je nach Belastung (ACSM), Fett mindestens 0,8 g/kg, Ballaststoffe 30 g, Wasser 35 ml/kg + 0,6 L pro Trainingsstunde, Koffein bis 8 Std. vor dem Schlafen. Bei BMI über 27 wird mit dem Normalgewicht gerechnet.</p></details>
    <details><summary>Puls-Alter</summary><p>VO₂max, Ruhepuls, Schlafdauer und -rhythmus, aktive Minuten und Schritte der letzten 30 Tage – jeder Faktor verschiebt das Alter um wenige Jahre. Eine Schätzung, kein medizinischer Wert.</p></details>
    <p class="muted small" style="margin-top:10px">Puls ist kein Medizinprodukt. Bei Beschwerden zum Arzt.</p>
  </section>

  <section class="card"><h2>Gerät</h2>
    <button class="btn ghost" data-act="journal-export">Morgen-Check sichern</button>
    <button class="btn ghost" data-act="journal-import">Morgen-Check einfügen</button>
    <button class="btn ghost" data-act="replay-onboarding">Einführung nochmal zeigen</button>
    ${state.demo ? '<button class="btn" data-act="demo-off">Demo beenden</button>' : '<button class="btn ghost" data-act="demo">Demo-Daten ansehen</button>'}
    <button class="btn danger" data-act="logout">Abmelden</button>
    <p class="muted small" style="margin-top:10px">Puls ${VERSION}</p>
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
  toast('Gespeichert.');
}

// ------------------------------------------------------------------ Ereignisse

app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab],[data-range],[data-day],[data-goto],[data-info],[data-ask],[data-look]');
  if (!t) return;
  if (t.dataset.look) {
    Hud.setTheme(t.dataset.look);
    state.animate = true;
    render();
    return;
  }
  if (t.dataset.info) return openSheet({ type: 'info', key: t.dataset.info });
  if (t.dataset.tab) return setTab(t.dataset.tab);
  if (t.dataset.day) return selectDay(Number(t.dataset.day));
  if (t.dataset.ask) return askCoach(t.dataset.ask);
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
      setTab('settings');
      break;
    case 'back':
      setTab(state.view === 'main' ? state.backTab || 'heute' : 'heute');
      break;
    case 'journal':
      openSheet({ type: 'journal', date: t.dataset.date });
      break;
    case 'life':
      logLife(t.dataset.id);
      break;
    case 'life-del': {
      const date = Life.logDate();
      saveJournal(date, Life.removeLog(journal()[date], t.dataset.id, t.dataset.t));
      render();
      break;
    }
    case 'life-more':
      openSheet({ type: 'lifemore' });
      break;
    case 'feel': {
      const date = state.model.days[state.model.days.length - 1].date;
      const on = feelOn(date) === 'sick';
      ls.set(LS.feel, on ? {} : { date });
      toast(on ? 'Schön, dass es dir besser geht.' : 'Notiert – Puls plant heute Ruhe ein.');
      render();
      break;
    }
    case 'split': {
      const labels = splitLabels();
      labels[t.dataset.id] = t.dataset.split;
      ls.set(LS.splits, labels);
      render();
      break;
    }
    case 'more-insights':
      state.showAllInsights = !state.showAllInsights;
      render();
      break;
    case 'setup-sync':
    case 'setup-coach':
    case 'setup-push':
    case 'setup-pad':
      openSheet({ type: t.dataset.act });
      break;
    case 'profile':
      openSheet({ type: 'profile' });
      break;
    case 'report-refresh':
      makeReport();
      break;
    case 'breathe':
    case 'goals':
      openSheet({ type: t.dataset.act });
      break;
    case 'act':
      openSheet({ type: 'act', idx: Number(t.dataset.idx) });
      break;
    case 'day-prev':
      selectDay(state.sel - 1);
      break;
    case 'day-next':
      selectDay(state.sel + 1);
      break;
    case 'setup-hide':
      ls.set(LS.setupHidden, true);
      render();
      toast('Ausgeblendet – du findest alles in den Einstellungen.');
      break;
    case 'chat-new':
      Coach.resetChat();
      state.chat = { busy: false, stream: null, status: '', error: '' };
      render();
      break;
    case 'reload':
      state.error = null;
      await loadData();
      break;
    case 'demo':
      startDemo();
      break;
    case 'demo-off':
      stopDemo();
      break;
    case 'sync':
      ls.del(LS.lastTrigger);
      triggerSync();
      break;
    case 'mfa': {
      const code = document.getElementById('mfa')?.value.trim();
      if (!/^\d{4,8}$/.test(code || '')) toast('Bitte den Code aus der Garmin-E-Mail eingeben.');
      else triggerSync({ mfa_code: code });
      break;
    }
    case 'replay-onboarding':
      state.onboarding = 0;
      render();
      break;
    case 'journal-export': {
      const text = JSON.stringify(ls.get(LS.journal, {}));
      try {
        await navigator.clipboard.writeText(text);
        toast('Kopiert – z. B. in Notizen einfügen.');
      } catch {
        prompt('Diesen Text kopieren:', text);
      }
      break;
    }
    case 'journal-import': {
      const text = prompt('Gesicherte Antworten einfügen:');
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
    case 'widget-copy':
      if (state.widget) {
        const code = widgetScript(state.widget);
        navigator.clipboard?.writeText(code).then(
          () => toast('Widget-Code kopiert – jetzt in Scriptable einfügen.'),
          () => toast('Kopieren ging nicht.'),
        );
      }
      break;
    case 'cal-copy':
      if (state.calUrl) {
        navigator.clipboard?.writeText(state.calUrl).then(
          () => toast('Link kopiert.'),
          () => toast('Kopieren ging nicht – Link bitte markieren.'),
        );
      }
      break;
    case 'logout':
      if (confirm('Passwort und Schlüssel auf diesem Gerät löschen? Morgen-Check-Antworten bleiben.')) {
        [LS.pass, LS.key, LS.demo].forEach(ls.del);
        Object.assign(state, { demo: false, store: null, model: null, box: null, view: 'loading', tab: 'heute' });
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

let prefTimer = null;
function savePushPref(el) {
  const prefs = { ...ls.get(LS.pushPrefs, {}), [el.dataset.pushpref]: el.checked };
  ls.set(LS.pushPrefs, prefs);
  clearTimeout(prefTimer);
  prefTimer = setTimeout(async () => {
    try {
      await dispatch({ push_subscription: JSON.stringify({ prefs }) });
      toast('Gespeichert – gilt ab dem nächsten Abruf.');
    } catch (err) {
      toast(err.message || 'Konnte nicht gespeichert werden.');
    }
  }, 1500);
}

app.addEventListener('change', (e) => {
  if (e.target.matches('[data-pushpref]')) savePushPref(e.target);
  if (e.target.matches('[data-report-auto]')) {
    ls.set(LS.reportAuto, e.target.checked);
    toast(e.target.checked ? 'Tagesbericht kommt jeden Morgen automatisch.' : 'Tagesbericht nur noch auf Knopfdruck.');
  }
  if (e.target.matches('[data-setting]')) saveSetting(e.target);
  if (e.target.matches('[data-coach-model]')) {
    Coach.saveCoachConfig({ model: e.target.value });
    toast('Coach-Modell gespeichert.');
  }
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
  if (e.target.dataset.form === 'ask') {
    const box = document.getElementById('askbox');
    const text = box.value;
    box.value = '';
    askCoach(text);
  }
});

app.addEventListener('keydown', (e) => {
  if (e.target.id === 'askbox' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'askbox') {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
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
    if (!touch || !touch.top || state.view !== 'main' || state.tab === 'coach') return;
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

// Beim Öffnen und Zurückkehren: Daten nachladen und ggf. frischen Abruf anstoßen
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || state.view !== 'main' || state.demo) return;
  if (Date.now() - state.lastFetch > 60e3) await loadData({ silent: true });
  autoSync();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.view === 'main' && !state.demo && !state.syncing && !state.chat.busy) loadData({ silent: true });
}, 5 * 60e3);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Neue Version: sobald der neue Service Worker übernimmt, einmal neu laden.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 30 * 60e3);
    })
    .catch(() => {});
}

// Für den Selbsttest (tests/live_check.mjs): nur Anzahlen, keine Werte
window.__puls = {
  version: VERSION,
  summary() {
    const m = state.model;
    if (!m || m.empty) return { version: VERSION, view: state.view, status: state.store?.status || null, days: 0 };
    const count = (f) => m.days.filter(f).length;
    return {
      version: VERSION,
      view: state.view,
      status: state.store?.status || null,
      days: m.days.length,
      latestIsToday: m.days[m.days.length - 1].date === todayIso(),
      sleep: count((d) => d.sleep),
      levels: count((d) => d.sleep?.levels?.length),
      hrv: count((d) => d.hrv != null),
      rhr: count((d) => d.rhr != null),
      hist: count((d) => Array.isArray(d.raw.hr?.hist)),
      series: count((d) => d.raw.hr?.series?.length),
      stressSeries: count((d) => d.stressSeries?.length),
      acts: m.days.reduce((s, d) => s + d.acts.length, 0),
      recovery: count((d) => d.recovery != null),
      zones: { green: count((d) => d.zone === 'green'), yellow: count((d) => d.zone === 'yellow'), red: count((d) => d.zone === 'red') },
      healthAge: !!E.healthAge(m),
      training: (() => {
        // Nur Anzahlen und Garmin-Typen (keine Werte): greift die Erkennung Gym/Rad?
        const acts = m.days.slice(-42).flatMap((d) => d.acts);
        const kinds = { gym: 0, bike: 0, run: 0, other: 0 };
        for (const a of acts) kinds[T.activityKind(a)]++;
        const gymActs = acts.filter((a) => T.activityKind(a) === 'gym');
        return { kinds, types: [...new Set(acts.map((a) => a.type))], gymWithSplit: gymActs.filter((a) => T.splitOf(a)).length, planKind: T.trainingPlan(m, m.days.length - 1).kind };
      })(),
      coachContextChars: E.coachContext(m, journal()).length,
    };
  },
  skipOnboarding() {
    state.onboarding = null;
    ls.set(LS.onboarded, true);
    render();
  },
};

(async () => {
  Hud.enablePings();
  Hud.boot();
  render();
  await loadData();
  autoSync();
})();
