// Essens-Tracker: Mahlzeiten (vom Foto oder Text, geschätzt von Claude), Tagesbilanz gegen die Ziele aus
// engine.nutritionPlan, Nährstoffe, Tipps, Wochen-Trends und der Zusammenhang mit Schlaf und Recovery.
// Reines Modul ohne DOM – läuft im Browser und in den Node-Tests (tests/food.test.mjs).
//
// Richtwerte: DGE-Referenzwerte für Erwachsene (Vitamine, Mineralstoffe, Ballaststoffe ≥ 30 g, Salz ≤ 6 g),
// WHO (freie Zucker < 10 % der Energie), EFSA (EPA+DHA 250 mg), 400 g+ Obst & Gemüse („5 am Tag“).
// Werte vom Foto sind Schätzungen – Puls zeigt sie als solche.

/** Mahlzeit-Arten in Tagesreihenfolge. */
export const MEAL_TYPES = {
  fruehstueck: 'Frühstück',
  mittagessen: 'Mittagessen',
  abendessen: 'Abendessen',
  snack: 'Snack',
  getraenk: 'Getränk',
};
const TYPE_ORDER = ['fruehstueck', 'mittagessen', 'snack', 'abendessen', 'getraenk'];

/** Nährwerte je Lebensmittel (Kurzname → Bezeichnung, Einheit). */
export const NUTRIENTS = {
  kcal: ['Kalorien', 'kcal'],
  p: ['Eiweiß', 'g'],
  c: ['Kohlenhydrate', 'g'],
  f: ['Fett', 'g'],
  fib: ['Ballaststoffe', 'g'],
  sug: ['Zucker', 'g'],
  sat: ['Gesättigte Fette', 'g'],
  salt: ['Salz', 'g'],
  alc: ['Alkohol', 'g'],
  caf: ['Koffein', 'mg'],
  veg: ['Obst & Gemüse', 'g'],
  h2o: ['Getränke', 'ml'],
};
const ITEM_KEYS = Object.keys(NUTRIENTS);

/** Vitamine und Mineralstoffe: Bezeichnung, Einheit, Tages-Richtwert (Mann, Frau). */
export const MICROS = {
  vitc: ['Vitamin C', 'mg', 110, 95],
  vitd: ['Vitamin D', 'µg', 20, 20],
  b12: ['Vitamin B12', 'µg', 4, 4],
  fol: ['Folat', 'µg', 300, 300],
  fe: ['Eisen', 'mg', 11, 16],
  zn: ['Zink', 'mg', 14, 8],
  mg: ['Magnesium', 'mg', 350, 300],
  ca: ['Calcium', 'mg', 1000, 1000],
  k: ['Kalium', 'mg', 4000, 4000],
  o3: ['Omega-3 (EPA+DHA)', 'g', 0.25, 0.25],
};
export const microRef = (key, sex) => MICROS[key][sex === 'female' ? 3 : 2];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, max = 1e5) => (isNum(Number(v)) && Number(v) > 0 ? Math.min(Number(v), max) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmtG = (v) => (v >= 100 ? String(Math.round(v)) : String(r1(v)).replace('.', ','));
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ Analyse von Claude übernehmen

/** Antwort der Foto-/Text-Analyse (deutsche Schlüssel aus dem JSON-Schema) → Mahlzeit im Puls-Format. */
export function mealFromAnalysis(a, { id, date, time, src = 'foto', note = '', model = '' } = {}) {
  const items = (Array.isArray(a?.lebensmittel) ? a.lebensmittel : []).slice(0, 30).map((x) => ({
    name: String(x?.name || 'Lebensmittel').slice(0, 80),
    menge: String(x?.menge || '').slice(0, 60),
    g: num(x?.gramm, 5000),
    kcal: num(x?.kcal, 5000),
    p: num(x?.eiweiss, 500),
    c: num(x?.kohlenhydrate, 1000),
    f: num(x?.fett, 500),
    fib: num(x?.ballaststoffe, 200),
    sug: num(x?.zucker, 500),
    sat: num(x?.gesaettigte_fette, 300),
    salt: num(x?.salz, 50),
    alc: num(x?.alkohol, 300),
    caf: num(x?.koffein_mg, 2000),
    veg: num(x?.obst_gemuese_gramm, 3000),
    h2o: num(x?.getraenk_ml, 5000),
    proc: ['frisch', 'verarbeitet', 'hochverarbeitet'].includes(x?.verarbeitung) ? x.verarbeitung : 'verarbeitet',
    // Woher die Nährwerte stammen: Etikett auf dem Foto, Lebensmitteltabelle (Claude) – später ggf. Open Food Facts
    src: x?.quelle === 'etikett' ? 'etikett' : 'tabelle',
    code: /^\d{8,14}$/.test(String(x?.barcode || '').replace(/\D/g, '')) ? String(x.barcode).replace(/\D/g, '') : '',
  }));
  const m = a?.mikro || {};
  const micro = {
    vitc: num(m.vitamin_c_mg, 5000),
    vitd: num(m.vitamin_d_ug, 500),
    b12: num(m.vitamin_b12_ug, 500),
    fol: num(m.folat_ug, 5000),
    fe: num(m.eisen_mg, 200),
    zn: num(m.zink_mg, 200),
    mg: num(m.magnesium_mg, 3000),
    ca: num(m.calcium_mg, 5000),
    k: num(m.kalium_mg, 20000),
    o3: num(m.omega3_g, 50),
  };
  return {
    id: id || newId(),
    date,
    time,
    type: MEAL_TYPES[a?.mahlzeit] ? a.mahlzeit : guessType(time),
    title: String(a?.titel || items.map((x) => x.name).join(', ') || 'Mahlzeit').slice(0, 90),
    items,
    micro,
    conf: ['hoch', 'mittel', 'niedrig'].includes(a?.sicherheit) ? a.sicherheit : 'mittel',
    ask: String(a?.rueckfrage || '').slice(0, 200),
    fazit: String(a?.fazit || '').slice(0, 300),
    tipp: String(a?.tipp || '').slice(0, 300),
    src,
    note: String(note || '').slice(0, 500),
    model,
    at: Date.now(),
  };
}

/** Herkunft der Nährwerte eines Lebensmittels (für die Anzeige). */
export const SOURCES = {
  etikett: 'Nährwerttabelle vom Foto',
  off: 'Open Food Facts (Barcode)',
  tabelle: 'Lebensmitteltabelle (BLS/USDA-Werte)',
  rezept: 'Rezept',
};

/**
 * Produkt aus Open Food Facts übernehmen: Nährwerte je 100 g × gegessene Menge (exakte Herstellerangaben).
 * Koffein, Obst & Gemüse und Getränkemenge bleiben von Claude; ohne Energieangabe bleibt alles, wie es war.
 */
export function applyProduct(item, product) {
  const n = product?.nutriments || {};
  const per = (k) => (isNum(Number(n[`${k}_100g`])) ? Number(n[`${k}_100g`]) : null);
  const kcal100 = per('energy-kcal') ?? (per('energy') != null ? per('energy') / 4.184 : null);
  if (kcal100 == null || !(item.g > 0)) return item;
  const k = item.g / 100;
  const val = (key, fallback) => (per(key) != null ? r1(per(key) * k) : fallback);
  const name = [product.brands?.split(',')[0]?.trim(), product.product_name].filter(Boolean).join(' ');
  return {
    ...item,
    name: name ? name.slice(0, 80) : item.name,
    kcal: Math.round(kcal100 * k),
    p: val('proteins', item.p),
    c: val('carbohydrates', item.c),
    sug: val('sugars', item.sug),
    f: val('fat', item.f),
    sat: val('saturated-fat', item.sat),
    fib: val('fiber', item.fib),
    salt: val('salt', item.salt),
    src: 'off',
  };
}

/**
 * Nachgeholtes zu einer Mahlzeit hinzufügen („Nachschlag Nudeln“, „noch ein Dessert“): Lebensmittel anhängen,
 * Mikronährstoffe addieren, Tipp aktualisieren.
 */
export function mergeAddon(meal, addon) {
  const micro = Object.fromEntries(Object.keys(MICROS).map((k) => [k, r1((meal.micro?.[k] || 0) + (addon.micro?.[k] || 0))]));
  return {
    ...meal,
    items: [...meal.items, ...addon.items.map((x) => ({ ...x, add: true }))],
    micro,
    tipp: addon.tipp || meal.tipp,
    note: [meal.note, addon.note].filter(Boolean).join(' · ').slice(0, 500),
    at: Date.now(),
  };
}

/** Gekochtes Rezept als Mahlzeit eintragen (Nährwerte pro Portion × gegessene Portionen). */
export function mealFromRecipe(recipe, { date, time, portions = 1 } = {}) {
  const pp = recipe?.pro_portion || {};
  const k = Math.max(0.25, Math.min(6, Number(portions) || 1));
  const item = {
    name: String(recipe?.name || 'Rezept').slice(0, 80),
    menge: k === 1 ? '1 Portion' : `${String(k).replace('.', ',')} Portionen`,
    g: Math.round(num(pp.gramm, 3000) * k),
    kcal: Math.round(num(pp.kcal) * k),
    p: r1(num(pp.eiweiss) * k),
    c: r1(num(pp.kohlenhydrate) * k),
    f: r1(num(pp.fett) * k),
    fib: r1(num(pp.ballaststoffe) * k),
    sug: r1(num(pp.zucker) * k),
    sat: r1(num(pp.gesaettigte_fette) * k),
    salt: r1(num(pp.salz) * k),
    alc: 0,
    caf: 0,
    veg: Math.round(num(pp.obst_gemuese_gramm) * k),
    h2o: 0,
    proc: 'frisch',
    src: 'rezept',
    code: '',
  };
  return {
    id: newId(),
    date,
    time,
    type: guessType(time),
    title: item.name,
    items: [item],
    micro: Object.fromEntries(Object.keys(MICROS).map((key) => [key, 0])),
    conf: 'hoch',
    ask: '',
    fazit: String(recipe?.kurz || '').slice(0, 300),
    tipp: '',
    src: 'rezept',
    note: '',
    model: '',
    at: Date.now(),
  };
}

export const newId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Mahlzeit-Art nach Uhrzeit, wenn Claude keine nennt. */
export function guessType(time) {
  const t = toMin(time) ?? 12 * 60;
  return t < 10.5 * 60 ? 'fruehstueck' : t < 14.5 * 60 ? 'mittagessen' : t < 17.5 * 60 ? 'snack' : 'abendessen';
}

/** Menge eines Lebensmittels ändern: alle Nährwerte (und die Mikros der Mahlzeit anteilig) skalieren. */
export function scaleItem(meal, idx, grams) {
  const it = meal.items[idx];
  if (!it || !isNum(grams) || grams < 0) return meal;
  const k = it.g > 0 ? grams / it.g : 0;
  const before = mealTotals(meal).kcal;
  const items = meal.items.map((x, j) => {
    if (j !== idx) return x;
    const out = { ...x, g: Math.round(grams) };
    for (const key of ITEM_KEYS) if (key !== 'g') out[key] = r1((x[key] || 0) * k);
    out.menge = `${Math.round(grams)} g`;
    return out;
  });
  return withMicroScaled({ ...meal, items }, before);
}

/** Lebensmittel entfernen (Mikros anteilig nach Kalorien). */
export function removeItem(meal, idx) {
  const before = mealTotals(meal).kcal;
  return withMicroScaled({ ...meal, items: meal.items.filter((_, j) => j !== idx) }, before);
}

function withMicroScaled(meal, kcalBefore) {
  const after = mealTotals(meal).kcal;
  const k = kcalBefore > 0 ? after / kcalBefore : 1;
  const micro = Object.fromEntries(Object.entries(meal.micro || {}).map(([key, v]) => [key, r1((v || 0) * k)]));
  return { ...meal, micro };
}

// ------------------------------------------------------------------ Summen

export function mealTotals(meal) {
  const out = Object.fromEntries(ITEM_KEYS.map((k) => [k, 0]));
  out.g = 0;
  out.procKcal = 0;
  for (const it of meal?.items || []) {
    for (const k of ITEM_KEYS) out[k] += it[k] || 0;
    out.g += it.g || 0;
    if (it.proc === 'hochverarbeitet') out.procKcal += it.kcal || 0;
  }
  for (const k of Object.keys(out)) out[k] = r1(out[k]);
  return out;
}

export function dayTotals(meals) {
  const out = Object.fromEntries([...ITEM_KEYS, 'g', 'procKcal'].map((k) => [k, 0]));
  const micro = Object.fromEntries(Object.keys(MICROS).map((k) => [k, 0]));
  for (const m of meals || []) {
    const t = mealTotals(m);
    for (const k of Object.keys(out)) out[k] += t[k];
    for (const k of Object.keys(micro)) micro[k] += m.micro?.[k] || 0;
  }
  for (const k of Object.keys(out)) out[k] = r1(out[k]);
  for (const k of Object.keys(micro)) micro[k] = Math.round(micro[k] * 100) / 100;
  return { ...out, micro, meals: (meals || []).length };
}

/** Mahlzeiten eines Tages, nach Uhrzeit sortiert. */
export function mealsOn(food, date) {
  return (food || []).filter((m) => m.date === date).sort((a, b) => (toMin(a.time) ?? 0) - (toMin(b.time) ?? 0));
}

/** Zählt als „richtig“ eingetragener Tag (für Vergleiche): mind. 2 Mahlzeiten und 800 kcal. */
export const loggedDay = (meals) => meals.filter((m) => m.type !== 'getraenk').length >= 2 && dayTotals(meals).kcal >= 800;

// ------------------------------------------------------------------ Tagesbilanz und Tipps

/**
 * Bilanz eines Tages gegen die Ziele von Puls (engine.nutritionPlan).
 * ctx: { sex, isToday, nowMin, plan } – plan liefert kcal/Eiweiß/KH/Fett/Wasser, letzte Mahlzeit, Koffein-Grenze.
 * Ergebnis: { totals, targets, pct, score, items: [{ tone: 'good'|'warn'|'info', key, text }], micro: [...] }
 */
export function dayReview(meals, ctx = {}) {
  if (!meals?.length) return null;
  const plan = ctx.plan && !ctx.plan.missing ? ctx.plan : null;
  const t = dayTotals(meals);
  const nowMin = ctx.isToday ? (ctx.nowMin ?? 24 * 60) : 24 * 60;
  const done = !ctx.isToday || nowMin >= 20 * 60; // Tagesbilanz erst abends endgültig
  const items = [];
  const add = (tone, key, text) => items.push({ tone, key, text });
  const targets = plan ? { kcal: plan.kcal, p: plan.protein, c: plan.carbs, f: plan.fat, fib: plan.fiber || 30, h2o: Math.round((plan.water || 2.5) * 1000) } : { fib: 30 };
  const pct = (k) => (targets[k] ? t[k] / targets[k] : null);
  let score = 100;

  // Kalorien
  if (plan) {
    const diff = t.kcal - plan.kcal;
    if (done) {
      if (Math.abs(diff) <= plan.kcal * 0.1) add('good', 'kcal', `Kalorien im Ziel: ${int(t.kcal)} von ${int(plan.kcal)} kcal.`);
      else if (diff > plan.kcal * 0.15) {
        add('warn', 'kcal', `${int(diff)} kcal über deinem Ziel (${int(t.kcal)} von ${int(plan.kcal)}).`);
        score -= 15;
      } else if (diff < -plan.kcal * 0.2) {
        add('warn', 'kcal', `${int(-diff)} kcal unter deinem Ziel – ${plan.goal === 'abnehmen' ? 'ein zu großes Defizit kostet Muskeln und Erholung' : 'zu wenig für deine Belastung'}.`);
        score -= 10;
      }
    } else {
      add('info', 'kcal', `Noch ${int(Math.max(0, -diff))} kcal bis zu deinem Tagesziel von ${int(plan.kcal)}.`);
    }
  }

  // Eiweiß gesamt und verteilt
  if (plan) {
    const left = plan.protein - t.p;
    if (t.p >= plan.protein * 0.9) add('good', 'protein', `Eiweiß geschafft: ${Math.round(t.p)} von ${plan.protein} g.`);
    else if (done) {
      add('warn', 'protein', `Eiweiß: ${Math.round(t.p)} von ${plan.protein} g – ${Math.round(left)} g fehlen (z. B. 250 g Skyr ≈ 28 g).`);
      score -= 15;
    } else add('info', 'protein', `Noch ${Math.round(left)} g Eiweiß offen – z. B. 250 g Skyr (≈ 28 g) oder 150 g Hähnchen (≈ 35 g).`);
    const per = plan.perMeal || 30;
    const rich = meals.filter((m) => mealTotals(m).p >= per * 0.75).length;
    if (done && rich >= 3) add('good', 'protein-dist', `Eiweiß gut verteilt: ${rich} Mahlzeiten mit ≥ ${Math.round(per * 0.75)} g.`);
  }

  // Ballaststoffe, Obst & Gemüse
  if (done && t.fib < 20) {
    add('warn', 'fiber', `Nur ${fmtG(t.fib)} g Ballaststoffe (Ziel ≥ 30 g) – Vollkorn, Hülsenfrüchte, Gemüse.`);
    score -= 8;
  } else if (t.fib >= 30) add('good', 'fiber', `Ballaststoffe top: ${fmtG(t.fib)} g.`);
  if (done && t.veg < 250) {
    add('warn', 'veg', `Obst & Gemüse: ${Math.round(t.veg)} g – Ziel sind 400 g und mehr („5 am Tag“).`);
    score -= 8;
  } else if (t.veg >= 400) add('good', 'veg', `${Math.round(t.veg)} g Obst & Gemüse – „5 am Tag“ geschafft.`);

  // Zucker, gesättigte Fette, Salz, hochverarbeitet (nur bei relevanter Menge)
  if (t.kcal >= 600) {
    const sugPct = (t.sug * 4) / t.kcal;
    if (sugPct > 0.1) {
      add('warn', 'sugar', `Zucker: ${Math.round(t.sug)} g = ${Math.round(sugPct * 100)} % der Kalorien (WHO: unter 10 %).`);
      score -= 8;
    }
    const satPct = (t.sat * 9) / t.kcal;
    if (satPct > 0.12) {
      add('warn', 'sat', `Gesättigte Fette: ${Math.round(satPct * 100)} % der Kalorien (Ziel unter 10 %) – öfter Olivenöl, Nüsse, Fisch.`);
      score -= 5;
    }
    const procPct = t.procKcal / t.kcal;
    if (procPct > 0.4) {
      add('warn', 'processed', `${Math.round(procPct * 100)} % der Kalorien aus hochverarbeiteten Lebensmitteln – je weniger, desto besser für Sättigung und Schlaf.`);
      score -= 8;
    }
  }
  if (t.salt > 6) {
    add('warn', 'salt', `Salz: ${fmtG(t.salt)} g (DGE: höchstens 6 g).`);
    score -= 5;
  }
  if (t.alc > 0) {
    add('warn', 'alcohol', `Alkohol: ${fmtG(t.alc)} g – kostet Tiefschlaf und HRV in der Nacht danach.`);
    score -= Math.min(20, 5 + t.alc / 4);
  }

  // Timing: letzte Mahlzeit und Koffein vs. Schlafenszeit
  const food = meals.filter((m) => m.type !== 'getraenk' && mealTotals(m).kcal >= 150);
  const last = food.length ? food[food.length - 1] : null;
  const cut = toMin(plan?.lastMeal);
  if (last && cut != null && (toMin(last.time) ?? 0) > cut && (toMin(last.time) ?? 0) > 17 * 60) {
    add('warn', 'late', `Letzte Mahlzeit um ${last.time} – später als 3 Std. vor dem Schlafen (bis ${plan.lastMeal}).`);
    score -= 8;
  }
  const cafCut = toMin(plan?.caffeineCut);
  const lateCaf = cafCut != null ? meals.filter((m) => (toMin(m.time) ?? 0) > cafCut && mealTotals(m).caf >= 30) : [];
  if (lateCaf.length) {
    add('warn', 'caffeine', `Koffein um ${lateCaf[lateCaf.length - 1].time} – nach deiner Grenze ${plan.caffeineCut}, das stört den Tiefschlaf.`);
    score -= 6;
  }

  // Trinken
  if (targets.h2o && t.h2o > 0) {
    if (t.h2o >= targets.h2o * 0.9) add('good', 'water', `Getrunken: ${fmtL(t.h2o)} von ${fmtL(targets.h2o)} L.`);
    else if (done) add('info', 'water', `Getrunken (eingetragen): ${fmtL(t.h2o)} von ${fmtL(targets.h2o)} L.`);
  }

  // Mikronährstoffe: Abdeckung des Tagesbedarfs (geschätzt)
  const micro = Object.keys(MICROS).map((k) => {
    const ref = microRef(k, ctx.sex);
    return { key: k, label: MICROS[k][0], unit: MICROS[k][1], value: t.micro[k], ref, pct: ref ? t.micro[k] / ref : null };
  });
  if (done && meals.length >= 3) {
    const low = micro.filter((x) => x.pct != null && x.pct < 0.5).map((x) => x.label);
    if (low.length) add('info', 'micro', `Wenig ${low.slice(0, 3).join(', ')} heute (geschätzt unter 50 % des Bedarfs).`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { totals: t, targets, pct: { kcal: pct('kcal'), p: pct('p'), c: pct('c'), f: pct('f'), fib: pct('fib'), h2o: pct('h2o') }, score: done ? score : null, done, items, micro };
}

const int = (v) => Math.round(v).toLocaleString('de-DE');
const fmtL = (ml) => (Math.round(ml / 100) / 10).toFixed(1).replace('.', ',');

// ------------------------------------------------------------------ Woche und Zusammenhänge

/** Letzte 7 Tage bis ``date``: Summen je Tag und Schnitt der eingetragenen Tage. */
export function weekStats(food, date, targetFor = () => null) {
  const days = [];
  for (let k = 6; k >= 0; k--) {
    const d = addDays(date, -k);
    const meals = mealsOn(food, d);
    const tot = meals.length ? dayTotals(meals) : null;
    days.push({ date: d, meals: meals.length, logged: loggedDay(meals), totals: tot, target: targetFor(d) });
  }
  const logged = days.filter((x) => x.logged);
  const avg = (f) => (logged.length ? Math.round(mean(logged.map(f))) : null);
  const withTarget = logged.filter((x) => x.target?.protein);
  return {
    days,
    logged: logged.length,
    kcal: avg((x) => x.totals.kcal),
    p: avg((x) => x.totals.p),
    fib: avg((x) => x.totals.fib),
    veg: avg((x) => x.totals.veg),
    proteinDays: withTarget.filter((x) => x.totals.p >= x.target.protein * 0.9).length,
    proteinOf: withTarget.length,
  };
}

/** Mindestens so viele Tage je Gruppe, bevor Puls einen Unterschied zeigt. */
export const MIN_DAYS = 14;

/**
 * Was dein Essen mit Schlaf und Recovery macht: eingetragene Tage mit vs. ohne Merkmal, verglichen in der
 * Nacht danach (Recovery, HRV, Schlafleistung am nächsten Morgen). Erst ab MIN_DAYS Tagen je Gruppe.
 * days: model.days (Puls-Auswertung); planFor(date) → Ziele des Tages.
 */
export function foodEffects(food, days, planFor = () => null) {
  const byDate = new Map(days.map((d, i) => [d.date, i]));
  const rows = [];
  const dates = [...new Set((food || []).map((m) => m.date))].sort();
  for (const date of dates) {
    const meals = mealsOn(food, date);
    if (!loggedDay(meals)) continue;
    const next = byDate.get(addDays(date, 1));
    if (next == null) continue;
    const n = days[next];
    if (n.recovery == null) continue;
    const t = dayTotals(meals);
    const plan = planFor(date);
    const solid = meals.filter((m) => m.type !== 'getraenk' && mealTotals(m).kcal >= 150);
    const lastMin = solid.length ? toMin(solid[solid.length - 1].time) : null;
    const cut = toMin(plan?.lastMeal) ?? 20 * 60;
    rows.push({
      date,
      rec: n.recovery,
      hrv: n.hrv ?? null,
      perf: n.perf ?? null,
      late: lastMin != null && lastMin > cut,
      protein: plan?.protein ? t.p >= plan.protein * 0.9 : null,
      alcohol: t.alc > 0,
      sugar: t.kcal > 0 ? (t.sug * 4) / t.kcal > 0.1 : null,
      veg: t.veg >= 400,
    });
  }
  const FACTORS = [
    ['late', 'Späte letzte Mahlzeit', 'spät gegessen', 'rechtzeitig'],
    ['alcohol', 'Alkohol', 'mit Alkohol', 'ohne'],
    ['protein', 'Eiweiß-Ziel erreicht', 'erreicht', 'nicht erreicht'],
    ['sugar', 'Viel Zucker (> 10 %)', 'viel Zucker', 'wenig Zucker'],
    ['veg', '400 g+ Obst & Gemüse', '400 g+', 'weniger'],
  ];
  const out = [];
  for (const [key, label, yes, no] of FACTORS) {
    const a = rows.filter((r) => r[key] === true);
    const b = rows.filter((r) => r[key] === false);
    const ready = a.length >= MIN_DAYS && b.length >= MIN_DAYS;
    const m = (arr, f) => mean(arr.map(f).filter(isNum));
    const entry = { key, label, yes, no, n: [a.length, b.length], ready };
    if (ready) {
      entry.rec = Math.round(m(a, (r) => r.rec) - m(b, (r) => r.rec));
      const ha = m(a, (r) => r.hrv);
      const hb = m(b, (r) => r.hrv);
      entry.hrv = ha != null && hb ? Math.round((100 * (ha - hb)) / hb) : null;
      const pa = m(a, (r) => r.perf);
      const pb = m(b, (r) => r.perf);
      entry.perf = pa != null && pb != null ? Math.round(pa - pb) : null;
    }
    out.push(entry);
  }
  return { rows: rows.length, factors: out };
}

// ------------------------------------------------------------------ Für den KI-Coach

/** Ernährungstagebuch als Text für Coach und Bericht (heute ausführlich, dazu die letzten 7 Tage). */
export function foodBlock(food, date, plan, { sex } = {}) {
  const meals = mealsOn(food, date);
  const L = ['## Ernährungstagebuch (vom Foto/Text, Werte von Claude geschätzt)'];
  if (!(food || []).length) {
    L.push('Noch nichts eingetragen.');
    return L.join('\n');
  }
  if (meals.length) {
    for (const m of meals) {
      const t = mealTotals(m);
      L.push(`- ${m.time} ${MEAL_TYPES[m.type] || ''}: ${m.title} – ${Math.round(t.kcal)} kcal, Eiweiß ${Math.round(t.p)} g, KH ${Math.round(t.c)} g, Fett ${Math.round(t.f)} g${t.alc ? `, Alkohol ${fmtG(t.alc)} g` : ''}${t.caf ? `, Koffein ${Math.round(t.caf)} mg` : ''}`);
    }
    const r = dayReview(meals, { sex, plan, isToday: true, nowMin: 24 * 60 });
    const t = r.totals;
    L.push(`Heute bisher: ${Math.round(t.kcal)} kcal${plan?.kcal ? ` von ${plan.kcal}` : ''}, Eiweiß ${Math.round(t.p)}${plan?.protein ? `/${plan.protein}` : ''} g, KH ${Math.round(t.c)} g, Fett ${Math.round(t.f)} g, Ballaststoffe ${fmtG(t.fib)} g, Zucker ${Math.round(t.sug)} g, Obst & Gemüse ${Math.round(t.veg)} g, Salz ${fmtG(t.salt)} g.`);
    const low = r.micro.filter((x) => x.pct != null && x.pct < 0.5).map((x) => x.label);
    if (low.length && meals.length >= 3) L.push(`Mikronährstoffe heute knapp (geschätzt): ${low.join(', ')}.`);
  } else {
    L.push('Heute noch nichts eingetragen.');
  }
  const w = weekStats(food, date);
  if (w.logged) L.push(`Letzte 7 Tage (${w.logged} Tage vollständig eingetragen): Ø ${w.kcal} kcal, Ø Eiweiß ${w.p} g, Ø Ballaststoffe ${w.fib} g, Ø Obst & Gemüse ${w.veg} g.`);
  return L.join('\n');
}

/** Typische Mahlzeit-Reihenfolge für die Anzeige. */
export const typeRank = (t) => TYPE_ORDER.indexOf(t);
