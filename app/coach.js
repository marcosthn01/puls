// Puls-Coach: Chat mit Claude über deine Daten.
// Läuft komplett im Browser mit deinem eigenen API-Schlüssel (nur auf diesem Gerät gespeichert).
//
// Wichtig für Claude-Modelle mit "preserved thinking": der Verlauf wird nur angehängt, nie
// umgeschrieben. Der System-Prompt (inkl. Datenstand) wird zu Beginn eines Chats eingefroren;
// neue Daten kommen als zusätzliche System-Nachricht hinter die nächste Frage.

import * as E from './engine.js';
import { esc } from './charts.js';

const SDK_URL = './vendor/anthropic-sdk-1.3.0.mjs';
const LS_KEY = 'puls.coach';
const LS_CHAT = 'puls.chat';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', note: 'beste Qualität (Standard)' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'schneller, halber Preis' },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', note: 'sehr günstig' },
};
const DEFAULT_MODEL = 'claude-opus-5-5';

export const SUGGESTIONS = [
  'Wie bin ich heute drauf?',
  'Mach mir einen Trainingsplan für diese Woche',
  'Warum ist meine Recovery so?',
  'Wie schlafe ich besser?',
  'Was hat mir zuletzt am meisten geschadet?',
];

const store = {
  get(k, f = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? f : JSON.parse(v);
    } catch {
      return f;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* voll oder privat */
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

export const coachConfig = () => ({ apiKey: '', model: DEFAULT_MODEL, ...store.get(LS_KEY, {}) });
export const saveCoachConfig = (patch) => store.set(LS_KEY, { ...coachConfig(), ...patch });

let sdkPromise = null;
async function client() {
  const { apiKey } = coachConfig();
  sdkPromise ||= import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  return { Anthropic, api: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }) };
}

/** Prüft den Schlüssel ohne Token-Kosten (Modell-Info abrufen). */
export async function testKey(apiKey) {
  sdkPromise ||= import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  const api = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    await api.models.retrieve(DEFAULT_MODEL);
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, msg: 'Der Schlüssel ist ungültig.' };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, msg: 'Der Schlüssel hat keine Berechtigung.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, msg: 'Keine Verbindung zu Claude.' };
    if (err instanceof Anthropic.APIError) return { ok: false, msg: `Claude antwortet mit Fehler ${err.status}.` };
    return { ok: false, msg: 'Unbekannter Fehler.' };
  }
}

// ------------------------------------------------------------------ System-Prompt und Werkzeuge

const PERSONA = `Du bist der Puls-Coach: ein persönlicher Coach für Training, Erholung und Schlaf in der iPhone-App „Puls“, ähnlich wie der Whoop Coach. Die App wertet die Garmin-Daten (Venu 4S) des Nutzers aus. Du duzt, sprichst Deutsch, bist motivierend und ehrlich.

So antwortest du:
- Kurz und klar: meist 2–6 Sätze oder eine knappe Liste. Fachbegriffe nur mit kurzer Erklärung.
- Immer mit konkreten Zahlen aus den Daten (z. B. „HRV 47 ms, 8 % unter deinem Schnitt“).
- Trainingsempfehlungen konkret: Sportart, Dauer, Pulsbereich in bpm (Zonen unten), Intensität – passend zu Recovery und Ziel-Strain.
- Wochenpläne als kurze Liste, ein Tag pro Zeile.
- Wenn Daten fehlen, sag das und rate nicht. Für Tage außerhalb der Übersicht nutze die Werkzeuge.
- Keine medizinischen Diagnosen. Bei Warnsignalen rätst du zu Ruhe und bei Beschwerden zum Arzt.
- Formatierung: **fett** für Kernaussagen, Listen mit „- “. Keine Tabellen, keine Überschriften.
- Einstellungen änderst und Morgen-Check-Antworten speicherst du nur, wenn der Nutzer das ausdrücklich will.

So rechnet Puls (falls der Nutzer fragt):
- Recovery 0–100 %: HRV 50 %, Ruhepuls 20 %, Schlaf 30 % (Schlafperformance + Qualität), jeweils gegen die letzten 30 Tage; Abzüge bei erhöhter Atemfrequenz/Hauttemperatur. Grün ab 67, Gelb ab 34.
- Strain 0–21: Herz-Kreislauf-Belastung des Tages aus dem Puls (Banister-TRIMP), logarithmisch.
- Ziel-Strain: Mitte 5,5 + 0,125 × Recovery, ±1,5; gesenkt bei stark steigender Trainingslast oder Warnsignalen.
- Schlafbedarf: Basis + Belastung des Vortags + Teil der Schlafschuld + Extra nach roter Recovery.
- Einflüsse: Tage mit einem Verhalten (Morgen-Check) gegen Tage ohne, gemessen an der Recovery am nächsten Morgen.`;

export const TOOLS = [
  {
    name: 'get_days',
    description:
      'Liefert Tageswerte (Recovery, HRV, Ruhepuls, Schlafstunden, Schlaf-%, Strain, Schritte, Stress, Trainings, Morgen-Check-Verhalten des Tages) für einen Zeitraum von höchstens 90 Tagen. Rufe das auf, wenn der Nutzer nach Tagen oder Zeiträumen fragt, die nicht in der 14-Tage-Übersicht stehen, oder nach längeren Verläufen.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Startdatum YYYY-MM-DD' },
        to: { type: 'string', description: 'Enddatum YYYY-MM-DD' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'get_day_details',
    description:
      'Liefert alle Details eines Tages: Recovery-Bestandteile, Schlafphasen und -zeiten, Schlafbedarf, Trainings mit Puls und Strain, Pulszonen, Stress, Hinweise. Rufe das auf, wenn der Nutzer nach einem bestimmten Tag oder einer bestimmten Nacht fragt.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Datum YYYY-MM-DD' } },
      required: ['date'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'save_morning_check',
    description: `Speichert den Morgen-Check für einen Tag (welches Verhalten an diesem Tag zutraf), ersetzt bestehende Antworten dieses Tages. Nur aufrufen, wenn der Nutzer ausdrücklich etwas eintragen will. Erlaubte ids: ${E.JOURNAL_QUESTIONS.map((q) => `${q.id} (${q.label})`).join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Tag des Verhaltens, YYYY-MM-DD (meist gestern)' },
        items: { type: 'array', items: { type: 'string', enum: E.JOURNAL_QUESTIONS.map((q) => q.id) }, description: 'Zutreffende Verhalten; leer = nichts davon' },
      },
      required: ['date', 'items'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'update_settings',
    description: 'Ändert persönliche Einstellungen der App. Nur aufrufen, wenn der Nutzer das ausdrücklich möchte. Nicht genannte Felder bleiben unverändert.',
    input_schema: {
      type: 'object',
      properties: {
        max_hr: { type: 'integer', description: 'Maximaler Puls in bpm (140–230)' },
        sleep_need_hours: { type: 'number', description: 'Basis-Schlafbedarf in Stunden (6–10)' },
        wake_time: { type: 'string', description: 'Feste Weckzeit HH:MM' },
        sport: { type: 'string', enum: Object.keys(E.SPORTS), description: 'Hauptsportart' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Führt ein Werkzeug aus. ``app`` liefert Zugriff auf Daten und Speicher der App. */
export function runTool(name, input, app) {
  const model = app.model();
  if (!input || typeof input !== 'object') return { error: 'INVALID_INPUT' };
  switch (name) {
    case 'get_days': {
      if (!isDate(input.from) || !isDate(input.to)) return { error: 'from/to müssen YYYY-MM-DD sein' };
      const from = input.to < input.from ? input.to : input.from;
      let to = input.to < input.from ? input.from : input.to;
      if (E.addDays(from, 90) < to) to = E.addDays(from, 90);
      return { days: E.daysTable(model, from, to, app.journal()) };
    }
    case 'get_day_details':
      if (!isDate(input.date)) return { error: 'date muss YYYY-MM-DD sein' };
      return E.dayDetails(model, input.date, app.journal());
    case 'save_morning_check': {
      const ids = new Set(E.JOURNAL_QUESTIONS.map((q) => q.id));
      if (!isDate(input.date) || !Array.isArray(input.items) || !input.items.every((x) => ids.has(x))) return { error: 'Ungültige Eingabe' };
      const answers = { _done: true };
      for (const id of input.items) answers[id] = true;
      app.saveJournal(input.date, answers);
      return { saved: true, date: input.date, items: input.items };
    }
    case 'update_settings': {
      const patch = {};
      if (input.max_hr != null) {
        if (!Number.isInteger(input.max_hr) || input.max_hr < 140 || input.max_hr > 230) return { error: 'max_hr außerhalb 140–230' };
        patch.maxHr = input.max_hr;
      }
      if (input.sleep_need_hours != null) {
        if (typeof input.sleep_need_hours !== 'number' || input.sleep_need_hours < 6 || input.sleep_need_hours > 10) return { error: 'sleep_need_hours außerhalb 6–10' };
        patch.sleepNeed = Math.round(input.sleep_need_hours * 60);
      }
      if (input.wake_time != null) {
        if (E.parseClock(input.wake_time) == null) return { error: 'wake_time muss HH:MM sein' };
        patch.wakeTime = input.wake_time;
      }
      if (input.sport != null) {
        if (!E.SPORTS[input.sport]) return { error: 'unbekannte Sportart' };
        patch.sport = input.sport;
      }
      if (!Object.keys(patch).length) return { error: 'Nichts zu ändern' };
      app.saveSettings(patch);
      return { saved: true, settings: patch };
    }
    default:
      return { error: `Unbekanntes Werkzeug ${name}` };
  }
}

// ------------------------------------------------------------------ Chat-Sitzung

export function loadChat() {
  return store.get(LS_CHAT, null);
}
function saveChat(chat) {
  // Älteste Runden abschneiden wäre eine Verlaufsänderung – stattdessen bei sehr langen Chats neu beginnen.
  store.set(LS_CHAT, chat);
}
export function resetChat() {
  store.del(LS_CHAT);
}

function newChat(app) {
  const model = app.model();
  return {
    started: Date.now(),
    dataStamp: model.generated,
    system: `${PERSONA}\n\n<daten>\n${E.coachContext(model, app.journal())}\n</daten>`,
    messages: [],
  };
}

/** Hängt neue Nachrichten an und lässt Claude antworten (inkl. Werkzeug-Schleife). */
export async function ask(text, app, ui) {
  let chat = loadChat();
  const tooOld = chat && Date.now() - chat.started > 12 * 3600e3;
  const tooLong = chat && JSON.stringify(chat.messages).length > 300_000;
  if (!chat || tooOld || tooLong) chat = newChat(app);

  chat.messages.push({ role: 'user', content: text });
  const model = app.model();
  let newStamp = null;
  if (chat.messages.length > 1 && model.generated && model.generated !== chat.dataStamp) {
    // Neue Daten seit Chatbeginn: als System-Nachricht anhängen (System-Prompt bleibt unverändert).
    chat.messages.push({ role: 'system', content: `Neuer Datenstand (ersetzt die Werte für heute):\n${E.coachContext(model, app.journal()).split('\n## Woche')[0]}` });
    newStamp = model.generated;
  }
  saveChat(chat);
  ui.update();

  const { Anthropic, api } = await client();
  const cfg = coachConfig();
  const params = () => {
    const p = {
      model: cfg.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: chat.system, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: chat.messages,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
    };
    // Bei einer Ablehnung durch die Sicherheitsfilter übernimmt serverseitig ein Ersatzmodell.
    if (cfg.model !== 'claude-haiku-5-5') {
      p.betas = ['server-side-fallback-2026-07-01'];
      p.fallbacks = 'default';
    }
    return p;
  };
  const stripThinking = () => {
    for (const m of chat.messages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        m.content = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
      }
    }
  };

  let strippedOnce = false;
  let jsonRetries = 0;
  for (let round = 0; round < 8; round++) {
    let message;
    ui.stream('');
    try {
      const stream = api.beta.messages.stream(params());
      let acc = '';
      stream.on('text', (delta) => {
        acc += delta;
        ui.stream(acc);
      });
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') ui.status(TOOL_STATUS[block.name] || 'Arbeite …');
      });
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && !strippedOnce) {
        // Einmalige Reparatur: Denkblöcke entfernen (z. B. nach Modellwechsel) und erneut senden.
        strippedOnce = true;
        stripThinking();
        continue;
      }
      if (!(err instanceof Anthropic.APIError) && !(err instanceof Anthropic.APIConnectionError) && jsonRetries++ < 2) continue; // unlesbare Werkzeug-Eingabe
      chat.messages = dropTrailingUser(chat.messages);
      saveChat(chat);
      throw friendlyError(err, Anthropic);
    }

    if (message.stop_reason === 'refusal') {
      chat.messages = dropTrailingUser(chat.messages);
      saveChat(chat);
      throw new Error('Dazu kann der Coach leider nichts sagen. Formuliere die Frage bitte anders.');
    }
    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length && message.stop_reason === 'max_tokens') {
      chat.messages = dropTrailingUser(chat.messages);
      saveChat(chat);
      throw new Error('Die Antwort war zu lang. Bitte stelle die Frage etwas enger.');
    }
    chat.messages.push({ role: 'assistant', content: message.content });
    saveChat(chat);

    if (!toolUses.length || message.stop_reason === 'end_turn') break;
    const results = toolUses.map((t) => {
      let content;
      try {
        content = JSON.stringify(runTool(t.name, t.input, app));
      } catch (e) {
        content = JSON.stringify({ error: String(e?.message || e) });
      }
      return { type: 'tool_result', tool_use_id: t.id, content };
    });
    chat.messages.push({ role: 'user', content: results });
    saveChat(chat);
    if (toolUses.some((t) => t.name === 'save_morning_check' || t.name === 'update_settings')) app.changed();
  }
  if (newStamp) chat.dataStamp = newStamp;
  saveChat(chat);
  ui.stream(null);
  ui.update();
}

const TOOL_STATUS = {
  get_days: 'Schaut sich deine Tage an …',
  get_day_details: 'Schaut sich den Tag genauer an …',
  save_morning_check: 'Speichert deinen Morgen-Check …',
  update_settings: 'Ändert deine Einstellungen …',
};

function dropTrailingUser(messages) {
  // Nur das Ende kürzen (nie frühere Runden ändern): unbeantwortete Frage samt Daten-Update entfernen.
  const out = [...messages];
  while (out.length && out[out.length - 1].role !== 'assistant') {
    const last = out[out.length - 1];
    if (last.role === 'user' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) break;
    out.pop();
  }
  return out;
}

function friendlyError(err, Anthropic) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Dein Claude-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('Der Schlüssel darf das nicht. Prüfe ihn in der Claude-Konsole.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Gerade zu viele Anfragen. Versuch es in einer Minute nochmal.');
  if (err instanceof Anthropic.BadRequestError) return new Error(`Claude lehnt die Anfrage ab: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new Error('Keine Verbindung. Bist du online?');
  if (err instanceof Anthropic.APIError) return new Error(`Claude ist gerade nicht erreichbar (Fehler ${err.status}).`);
  return new Error('Etwas ist schiefgelaufen. Bitte nochmal versuchen.');
}

// ------------------------------------------------------------------ Darstellung

/** Sichtbare Unterhaltung aus dem API-Verlauf: nur Nutzerfragen und Antworttext. */
export function visibleMessages(chat) {
  const out = [];
  for (const m of chat?.messages || []) {
    if (m.role === 'user' && typeof m.content === 'string') out.push({ role: 'user', text: m.content });
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) out.push({ role: 'assistant', text });
    }
  }
  return out;
}

/** Sehr kleines Markdown: **fett**, Listen, Absätze. */
export function md(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let list = null;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(\S.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-•]\s+(.*)$/.exec(line);
    const num = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const type = bullet ? 'ul' : 'ol';
      if (list !== type) {
        if (list) html += `</${list}>`;
        html += `<${type}>`;
        list = type;
      }
      html += `<li>${inline((bullet || num)[bullet ? 1 : 2])}</li>`;
      continue;
    }
    if (list) {
      html += `</${list}>`;
      list = null;
    }
    if (line) html += `<p>${inline(line.replace(/^#+\s*/, ''))}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
