// Sportarten: Puls übernimmt die Sportart, die du auf der Garmin-Uhr gewählt hast (activityType.typeKey),
// und zeigt alle Werte, die Garmin dazu misst (Leistung, Trittfrequenz, Tempo, Höhenmeter, Sätze …).
// Der Name der Aktivität entscheidet nur, wenn Garmin keine eindeutige Sportart liefert.
// Keine Abhängigkeiten – wird von Engine, Training, App und Abruf-Skripten genutzt.

/** Garmin-Sportart → deutscher Name und Art (gym | bike | run | other). */
export const SPORTS = {
  // Rad
  cycling: ['Radfahren', 'bike'],
  road_biking: ['Rennrad', 'bike'],
  indoor_cycling: ['Indoor-Rad', 'bike'],
  virtual_ride: ['Virtuelles Rad', 'bike'],
  mountain_biking: ['Mountainbike', 'bike'],
  gravel_cycling: ['Gravel', 'bike'],
  cyclocross: ['Cyclocross', 'bike'],
  e_bike_fitness: ['E-Bike', 'bike'],
  e_bike_mountain: ['E-MTB', 'bike'],
  e_enduro_mtb: ['E-Enduro', 'bike'],
  enduro_mtb: ['Enduro', 'bike'],
  downhill_biking: ['Downhill', 'bike'],
  recumbent_cycling: ['Liegerad', 'bike'],
  track_cycling: ['Bahnrad', 'bike'],
  bmx: ['BMX', 'bike'],
  hand_cycling: ['Handbike', 'bike'],
  indoor_hand_cycling: ['Indoor-Handbike', 'bike'],
  spinning: ['Spinning', 'bike'],
  // Laufen
  running: ['Laufen', 'run'],
  treadmill_running: ['Laufband', 'run'],
  indoor_running: ['Indoor-Laufen', 'run'],
  trail_running: ['Trailrun', 'run'],
  track_running: ['Bahnlauf', 'run'],
  street_running: ['Straßenlauf', 'run'],
  virtual_run: ['Virtueller Lauf', 'run'],
  ultra_run: ['Ultralauf', 'run'],
  obstacle_run: ['Hindernislauf', 'run'],
  // Kraft & Fitness
  strength_training: ['Krafttraining', 'gym'],
  hiit: ['HIIT', 'gym'],
  functional_strength_training: ['Funktionelles Krafttraining', 'gym'],
  bouldering: ['Bouldern', 'gym'],
  indoor_climbing: ['Klettern (Halle)', 'gym'],
  // Cardio-Geräte und Sonstiges
  indoor_cardio: ['Cardio', 'other'],
  fitness_equipment: ['Fitnessgerät', 'other'],
  elliptical: ['Crosstrainer', 'other'],
  stair_climbing: ['Treppensteiger', 'other'],
  indoor_rowing: ['Rudergerät', 'other'],
  rowing: ['Rudern', 'other'],
  walking: ['Gehen', 'other'],
  casual_walking: ['Spaziergang', 'other'],
  speed_walking: ['Walking', 'other'],
  indoor_walking: ['Gehen (Halle)', 'other'],
  hiking: ['Wandern', 'other'],
  mountaineering: ['Bergsteigen', 'other'],
  lap_swimming: ['Schwimmen (Bahn)', 'other'],
  open_water_swimming: ['Freiwasser', 'other'],
  swimming: ['Schwimmen', 'other'],
  yoga: ['Yoga', 'other'],
  pilates: ['Pilates', 'other'],
  breathwork: ['Atemübung', 'other'],
  meditation: ['Meditation', 'other'],
  tennis: ['Tennis', 'other'],
  padel: ['Padel', 'other'],
  squash: ['Squash', 'other'],
  badminton: ['Badminton', 'other'],
  table_tennis: ['Tischtennis', 'other'],
  soccer: ['Fußball', 'other'],
  basketball: ['Basketball', 'other'],
  volleyball: ['Volleyball', 'other'],
  golf: ['Golf', 'other'],
  boxing: ['Boxen', 'other'],
  mixed_martial_arts: ['Kampfsport', 'other'],
  dance: ['Tanzen', 'other'],
  inline_skating: ['Inlineskaten', 'other'],
  resort_skiing_snowboarding_ws: ['Ski/Snowboard', 'other'],
  resort_skiing: ['Ski alpin', 'other'],
  resort_snowboarding: ['Snowboard', 'other'],
  cross_country_skiing_ws: ['Langlauf', 'other'],
  backcountry_skiing: ['Skitour', 'other'],
  stand_up_paddleboarding_v2: ['SUP', 'other'],
  kayaking_v2: ['Kajak', 'other'],
  multi_sport: ['Multisport', 'other'],
  other: ['Sonstiges', 'other'],
};

// Garmins übergeordnete Sportarten (activityType.parentTypeId), falls die genaue Art unbekannt ist
const PARENT_KIND = { 1: 'run', 2: 'bike', 9: 'other', 26: 'other', 29: 'other' };

const lower = (v) => String(v || '').toLowerCase();
const GYM_T = /strength|weight|krafttraining|hiit|functional|crossfit|boulder|climb/;
const BIKE_T = /cycl|bik|ride|spinning|gravel|mountain|mtb/;
const RUN_T = /run|treadmill/;
const GYM_N = /\b(push|pull|gym|kraft|krafttraining|beine|legs|oberkörper|unterkörper|ganzkörper|hypertrophie)\b/;
const BIKE_N = /\b(rad|radtour|radfahren|indoor-rad|indoor-radfahren|bike|spinning|rennrad|mtb|ergometer|zwift|cycling)\b/;
const RUN_N = /\b(lauf|laufen|run|joggen|jogging)\b/;
const AMBIGUOUS = /^(other|fitness_equipment|indoor_cardio|generic|multi_sport)$/;

/**
 * Art einer Aktivität: Die Sportart von Garmin hat immer Vorrang (Indoor-Rad bleibt Rad, auch wenn die
 * Einheit „Gym“ heißt). Nur bei unklaren Arten (Fitnessgerät, Cardio, Sonstiges, leer) zählt der Name.
 */
export function activityKind(a) {
  const t = lower(a?.type);
  const n = lower(a?.name);
  const known = SPORTS[t];
  if (known && known[1] !== 'other') return known[1];
  if (BIKE_T.test(t)) return 'bike';
  if (RUN_T.test(t)) return 'run';
  if (GYM_T.test(t)) return 'gym';
  const ambiguous = !t || AMBIGUOUS.test(t);
  if (ambiguous) {
    if (BIKE_N.test(n)) return 'bike';
    if (RUN_N.test(n)) return 'run';
    if (GYM_N.test(n)) return 'gym';
    if (t === 'fitness_equipment') return 'gym';
    const p = PARENT_KIND[a?.ptype];
    if (p) return p;
  }
  return 'other';
}

/** Deutscher Name der Sportart, wie auf der Uhr gewählt („Indoor-Rad“, „Krafttraining“ …). */
export function sportLabel(a) {
  const t = lower(a?.type);
  if (SPORTS[t]) return SPORTS[t][0];
  if (!t) return 'Training';
  const s = t.replace(/_v\d+$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const nameKind = (n) => (BIKE_N.test(n) ? 'bike' : RUN_N.test(n) ? 'run' : GYM_N.test(n) ? 'gym' : null);

/** Titel einer Einheit: eigener Name, wenn du einen vergeben hast – sonst die Sportart. */
export function activityTitle(a) {
  const name = String(a?.name || '').trim();
  const label = sportLabel(a);
  if (!name) return label;
  const t = lower(a?.type);
  if (!t || AMBIGUOUS.test(t)) return name; // Garmin weiß es nicht genauer – dein Name zählt
  // Name widerspricht der Sportart (z. B. das Studio heißt „Gym“, du warst aber auf dem Rad)
  const nk = nameKind(lower(name));
  if (nk && nk !== activityKind(a)) return label;
  // Garmins Standardnamen („Ort Indoor-Radfahren“, „Krafttraining“) bringen nichts Neues
  const generic = /(radfahren|rad|cycling|ride|krafttraining|strength training|strength|laufen|lauf|running|run|laufband|treadmill|gehen|walking|wandern|hiking|cardio|hiit|schwimmen|swimming|yoga)$/i.test(name);
  return generic && nk !== 'gym' ? label : generic && /^(krafttraining|strength( training)?)$/i.test(name) ? label : name;
}

const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const int = (v) => Math.round(v).toLocaleString('de-DE');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}`;
};
const pace = (mps) => {
  if (!isNum(mps) || mps <= 0) return null;
  const s = Math.round(1000 / mps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Übungs-Kategorie von Garmin → Deutsch (Kraft-Einheiten mit Satz-Erkennung). */
const EXERCISES = {
  BENCH_PRESS: 'Bankdrücken',
  SQUAT: 'Kniebeuge',
  DEADLIFT: 'Kreuzheben',
  SHOULDER_PRESS: 'Schulterdrücken',
  ROW: 'Rudern',
  PULL_UP: 'Klimmzüge',
  PUSH_UP: 'Liegestütze',
  LUNGE: 'Ausfallschritte',
  CURL: 'Bizeps-Curls',
  TRICEPS_EXTENSION: 'Trizeps',
  LATERAL_RAISE: 'Seitheben',
  CHEST_FLY: 'Butterfly',
  LEG_CURL: 'Beinbeuger',
  LEG_RAISE: 'Beinheben',
  CALF_RAISE: 'Waden',
  CRUNCH: 'Crunches',
  PLANK: 'Plank',
  HIP_RAISE: 'Hüftheben',
  HIP_STABILITY: 'Hüfte',
  CORE: 'Rumpf',
  SHRUG: 'Shrugs',
  SIT_UP: 'Sit-ups',
  CARRY: 'Tragen',
  CARDIO: 'Cardio',
  TOTAL_BODY: 'Ganzkörper',
  OLYMPIC_LIFT: 'Olympisches Heben',
  FLYE: 'Butterfly',
  PULL_DOWN: 'Latzug',
  LEG_PRESS: 'Beinpresse',
  LEG_EXTENSION: 'Beinstrecker',
  UNKNOWN: 'Übung',
};
export const exerciseName = (c) => EXERCISES[String(c || '').toUpperCase()] || String(c || 'Übung').toLowerCase().replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

/**
 * Alle Messwerte einer Einheit, passend zur Sportart: [{ k, v, u }].
 * Reihenfolge = Wichtigkeit (Rad: Leistung, Trittfrequenz …; Laufen: Pace, Kadenz …; Kraft: Sätze …).
 */
export function sportFacts(a) {
  const kind = activityKind(a);
  const out = [];
  const add = (k, v, u = '') => {
    if (v != null && v !== '') out.push({ k, v, u });
  };
  const km = isNum(a?.dist) && a.dist >= 50 ? a.dist / 1000 : null;
  if (kind === 'bike') {
    add('Ø Leistung', isNum(a.pwr) ? int(a.pwr) : null, 'W');
    add('Norm. Leistung', isNum(a.np) ? int(a.np) : null, 'W');
    add('Max. Leistung', isNum(a.maxPwr) ? int(a.maxPwr) : null, 'W');
    add('Ø Trittfrequenz', isNum(a.cad) ? int(a.cad) : null, 'U/min');
    add('Distanz', km != null ? n1(km) : null, 'km');
    add('Ø Tempo', isNum(a.spd) && km != null ? n1(a.spd * 3.6) : null, 'km/h');
    add('Max. Tempo', isNum(a.maxSpd) && km != null ? n1(a.maxSpd * 3.6) : null, 'km/h');
    add('Höhenmeter', isNum(a.elev) && a.elev >= 1 ? int(a.elev) : null, 'm');
  } else if (kind === 'run') {
    add('Distanz', km != null ? n1(km) : null, 'km');
    add('Ø Pace', km != null ? pace(a.spd) : null, 'min/km');
    add('Ø Kadenz', isNum(a.cad) ? int(a.cad) : null, 'spm');
    add('Ø Leistung', isNum(a.pwr) ? int(a.pwr) : null, 'W');
    add('Höhenmeter', isNum(a.elev) && a.elev >= 1 ? int(a.elev) : null, 'm');
    add('Schritte', isNum(a.steps) ? int(a.steps) : null);
  } else if (kind === 'gym') {
    add('Sätze', isNum(a.sets) ? int(a.sets) : null);
    add('Wiederholungen', isNum(a.reps) ? int(a.reps) : null);
  } else {
    add('Distanz', km != null ? n1(km) : null, 'km');
    add('Ø Tempo', isNum(a.spd) && km != null ? n1(a.spd * 3.6) : null, 'km/h');
    add('Ø Leistung', isNum(a.pwr) ? int(a.pwr) : null, 'W');
    add('Ø Frequenz', isNum(a.cad) ? int(a.cad) : null, '/min');
    add('Höhenmeter', isNum(a.elev) && a.elev >= 1 ? int(a.elev) : null, 'm');
    add('Bahnen', isNum(a.lengths) ? int(a.lengths) : null);
    add('Schritte', isNum(a.steps) ? int(a.steps) : null);
  }
  if (isNum(a?.moving) && isNum(a?.dur) && a.dur - a.moving >= 120) add('In Bewegung', dur(a.moving), a.moving >= 3600 ? 'Std.' : 'Min.');
  add('Ø Atmung', isNum(a?.resp) ? n1(a.resp) : null, '/min');
  return out;
}

/** Kurzzeile für Listen: die zwei, drei wichtigsten Werte der Sportart. */
export function sportMeta(a) {
  const f = sportFacts(a);
  const want = { bike: ['Ø Leistung', 'Ø Trittfrequenz', 'Distanz'], run: ['Distanz', 'Ø Pace'], gym: ['Sätze', 'Wiederholungen'], other: ['Distanz', 'Ø Leistung'] }[activityKind(a)];
  return want
    .map((k) => f.find((x) => x.k === k))
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => (x.k === 'Sätze' || x.k === 'Wiederholungen' ? `${x.v} ${x.k}` : `${x.v} ${x.u}`.trim()));
}

const SUB_EXERCISES = {
  LAT_PULLDOWN: 'Latzug',
  DUMBBELL_FLYE: 'Kurzhantel-Fliegende',
  JUMP_ROPE: 'Seilspringen',
  BARBELL_DEADLIFT: 'Kreuzheben (Langhantel)',
  ROMANIAN_DEADLIFT: 'Rumänisches Kreuzheben',
  BARBELL_BENCH_PRESS: 'Bankdrücken (Langhantel)',
  DUMBBELL_BENCH_PRESS: 'Bankdrücken (Kurzhantel)',
  INCLINE_DUMBBELL_BENCH_PRESS: 'Schrägbank (Kurzhantel)',
  BARBELL_BACK_SQUAT: 'Kniebeuge (Langhantel)',
  GOBLET_SQUAT: 'Goblet Squat',
  BENT_OVER_ROW: 'Vorgebeugtes Rudern',
  SEATED_CABLE_ROW: 'Rudern am Kabel',
  DUMBBELL_ROW: 'Kurzhantel-Rudern',
  CABLE_CROSSOVER: 'Kabelzug-Fliegende',
  TRICEPS_PRESSDOWN: 'Trizepsdrücken am Kabel',
  HAMMER_CURL: 'Hammer-Curls',
  CHIN_UP: 'Klimmzüge (Untergriff)',
};

/** Übungen einer Kraft-Einheit (von der Uhr erkannt): [{ name, sets, reps }]. */
export function exercises(a) {
  return (Array.isArray(a?.ex) ? a.ex : [])
    .filter((x) => x && (x.r || (x.s && x.c !== 'UNKNOWN')))
    .map((x) => ({ name: SUB_EXERCISES[x.sc] || exerciseName(x.c), sets: x.s || null, reps: x.r || null }));
}

// ------------------------------------------------------------------ Sportart korrigieren

/** Auswahl, wenn Garmin die falsche Sportart gespeichert hat (z. B. Krafttraining statt Indoor-Rad). */
export const CHOICES = ['indoor_cycling', 'cycling', 'road_biking', 'mountain_biking', 'strength_training', 'hiit', 'running', 'treadmill_running', 'walking', 'hiking', 'indoor_cardio', 'elliptical', 'indoor_rowing', 'yoga', 'lap_swimming', 'other'];

/** Deine Korrekturen anwenden: Markierung „sport:<art>“ je Einheit (Garmins Angabe bleibt in typeGarmin). */
export function applySportLabels(store, labels = {}) {
  if (!store?.days) return store;
  const fix = Object.entries(labels || {}).filter(([, v]) => typeof v === 'string' && v.startsWith('sport:'));
  if (!fix.length && !Object.values(store.days).some((d) => d?.acts?.some((a) => a.typeGarmin))) return store;
  const map = Object.fromEntries(fix);
  const days = {};
  for (const [date, d] of Object.entries(store.days)) {
    if (!d?.acts?.length) {
      days[date] = d;
      continue;
    }
    days[date] = {
      ...d,
      acts: d.acts.map((a) => {
        const v = map[String(a.id)];
        const garmin = a.typeGarmin ?? a.type;
        if (v && v !== 'sport:garmin') return { ...a, type: v.slice(6), typeGarmin: garmin };
        if (v === 'sport:garmin' || a.typeGarmin) {
          const { typeGarmin, ...rest } = a;
          return { ...rest, type: garmin };
        }
        return a;
      }),
    };
  }
  return { ...store, days };
}

/**
 * Sieht eine „Kraft“-Einheit eher nach etwas anderem aus? Die Uhr zählt beim Krafttraining Sätze –
 * erkennt sie in 15+ Minuten höchstens 2 Sätze und kaum Wiederholungen, war es meist eine andere Sportart
 * (z. B. Indoor-Rad mit dem falschen Profil gestartet).
 */
export function suspicious(a) {
  if (!a || a.typeGarmin || activityKind(a) !== 'gym' || !isNum(a.dur) || a.dur < 900 || !isNum(a.sets)) return null;
  if (a.sets > 2 || (a.reps ?? 0) > 10) return null;
  const min = Math.round(a.dur / 60);
  return `Deine Uhr hat in ${min} Min. nur ${a.sets === 1 ? '1 Satz' : `${a.sets} Sätze`} erkannt – war das wirklich Krafttraining?`;
}

/** Eine Zeile für den KI-Coach: Sportart, Dauer und die wichtigsten Messwerte. */
export function sportLine(a) {
  const f = sportFacts(a)
    .slice(0, 5)
    .map((x) => `${x.k} ${x.v}${x.u ? ` ${x.u}` : ''}`);
  const ex = exercises(a)
    .slice(0, 6)
    .map((x) => `${x.name}${x.sets ? ` ${x.sets}×` : ''}${x.reps ? `${x.reps}` : ''}`);
  const title = activityTitle(a);
  const label = sportLabel(a);
  return [title === label ? label : `${title} (${label})`, ...f, ex.length ? `Übungen: ${ex.join(', ')}` : ''].filter(Boolean).join(', ');
}
