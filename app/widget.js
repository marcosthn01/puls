// iPhone-Widgets über die App „Scriptable“ (kostenlos im App Store).
//
// Der Abruf legt bei jedem Lauf eine kleine verschlüsselte Datei w-<token>.json auf die Seite
// (Recovery, Schlaf, Strain, Training heute). Das Widget lädt sie, prüft sie und entschlüsselt sie
// mit einem Schlüssel, der aus deinem Daten-Passwort abgeleitet ist – das Passwort selbst steht nicht
// im Widget-Code.
//
// Verfahren (ohne Krypto-Bibliothek, damit es in Scriptable läuft):
//   key  = HMAC-SHA256(Passwort, "puls-widget-key-v1")
//   name = "w-" + hex(HMAC-SHA256(Passwort, "puls-widget-v1"))[0:24] + ".json"
//   Schlüsselstrom Block k = HMAC-SHA256(key, iv ‖ k als 4 Byte), Klartext XOR Schlüsselstrom
//   mac  = HMAC-SHA256(key, iv ‖ ct) – wird vor dem Entschlüsseln geprüft

/* Die folgenden Funktionen werden 1:1 in den Widget-Code kopiert – daher ohne Abhängigkeiten. */
function sha256(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  m[total - 4] = (bits >>> 24) & 255;
  m[total - 3] = (bits >>> 16) & 255;
  m[total - 2] = (bits >>> 8) & 255;
  m[total - 1] = bits & 255;
  m[total - 5] = Math.floor(bits / 4294967296) & 255;
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  H.forEach((v, i) => {
    out[4 * i] = (v >>> 24) & 255;
    out[4 * i + 1] = (v >>> 16) & 255;
    out[4 * i + 2] = (v >>> 8) & 255;
    out[4 * i + 3] = v & 255;
  });
  return out;
}

function hmacSha256(key, msg) {
  let k = key.length > 64 ? sha256(key) : key;
  const pad = new Uint8Array(64);
  pad.set(k);
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = pad[i] ^ 0x36;
    outer[i] = pad[i] ^ 0x5c;
  }
  inner.set(msg, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

function b64decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((j) => (i + j < clean.length ? A.indexOf(clean[i + j]) : 0));
    const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    out.push((v >> 16) & 255);
    if (i + 2 < clean.length) out.push((v >> 8) & 255);
    if (i + 3 < clean.length) out.push(v & 255);
  }
  return new Uint8Array(out);
}

function hexBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
  return out;
}

function utf8(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

/** Entschlüsselt die Widget-Datei; wirft bei falschem Schlüssel oder veränderter Datei. */
function openWidgetBox(box, keyHex) {
  const key = hexBytes(keyHex);
  const iv = b64decode(box.iv);
  const ct = b64decode(box.ct);
  const both = new Uint8Array(iv.length + ct.length);
  both.set(iv);
  both.set(ct, iv.length);
  const mac = hmacSha256(key, both);
  const want = b64decode(box.mac);
  let diff = mac.length ^ want.length;
  for (let i = 0; i < Math.min(mac.length, want.length); i++) diff |= mac[i] ^ want[i];
  if (diff) throw new Error('Widget-Daten passen nicht zum Schlüssel');
  const pt = new Uint8Array(ct.length);
  for (let blk = 0; blk * 32 < ct.length; blk++) {
    const seed = new Uint8Array(iv.length + 4);
    seed.set(iv);
    seed[iv.length] = (blk >>> 24) & 255;
    seed[iv.length + 1] = (blk >>> 16) & 255;
    seed[iv.length + 2] = (blk >>> 8) & 255;
    seed[iv.length + 3] = blk & 255;
    const ks = hmacSha256(key, seed);
    for (let j = 0; j < 32 && blk * 32 + j < ct.length; j++) pt[blk * 32 + j] = ct[blk * 32 + j] ^ ks[j];
  }
  return JSON.parse(utf8(pt));
}

export { sha256, hmacSha256, b64decode, hexBytes, utf8, openWidgetBox, render };


/**
 * Darstellung im Widget (läuft in Scriptable, wird 1:1 in den Widget-Code kopiert).
 * env = { fam: Widget-Größe, param: Widget-Parameter, link(q): Adresse beim Antippen, life: Lifestyle-Knöpfe zeigen }
 */
function render(d, env) {
  const C = {
    green: '#16EC06', yellow: '#FFDE00', red: '#FF0026', sleep: '#7BA1BB', strain: '#0093E7',
    text: '#FFFFFF', muted: '#8A9099', dim: '#5C636B', card: '#16191D', card2: '#1F2328',
    gym: '#E8913A', bike: '#0093E7', run: '#16EC06', other: '#5C636B',
  };
  const fam = env.fam || 'large';
  const param = String(env.param || '').trim().toLowerCase();
  const zoneC = C[d.zone] || C.muted;
  const NUM = (s) => new Font('AvenirNextCondensed-Bold', s);
  const DEMI = (s) => new Font('AvenirNextCondensed-DemiBold', s);
  const de = (v, n = 0) => (v == null ? '–' : (Math.round(v * 10 ** n) / 10 ** n).toFixed(n).replace('.', ','));
  const pct = (v) => (v == null ? '–' : `${v}%`);
  const dots = (v) => (v == null ? '–' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
  const hm = (min) => (min == null ? '–' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);
  const frac = (v, max) => (v == null ? 0 : Math.max(0, Math.min(1, v / max)));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const stale = d.date !== today && now.getHours() >= 10;
  const at = d.at ? new Date(d.at) : null;
  const atText = at && !isNaN(at) ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';

  const w = new ListWidget();
  w.url = env.link('');
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  // ---- Bausteine
  function ring(size, f, color, text, sub, o = {}) {
    const c = new DrawContext();
    c.size = new Size(size, size);
    c.opaque = false;
    c.respectScreenScale = true;
    const lw = o.lw || Math.max(3, size * 0.09);
    const r = (size - lw) / 2 - 0.5;
    const cx = size / 2;
    const arc = (f0, f1) => {
      const p = new Path();
      const n = Math.max(2, Math.ceil(90 * (f1 - f0)));
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const a = -Math.PI / 2 + 2 * Math.PI * (f0 + ((f1 - f0) * k) / n);
        pts.push(new Point(cx + r * Math.cos(a), cx + r * Math.sin(a)));
      }
      p.addLines(pts);
      return p;
    };
    c.setLineWidth(lw);
    c.setStrokeColor(new Color(o.track || '#FFFFFF', o.trackAlpha == null ? 0.11 : o.trackAlpha));
    c.addPath(arc(0, 1));
    c.strokePath();
    const v = Math.max(0, Math.min(1, f || 0));
    if (v > 0.004) {
      c.setStrokeColor(new Color(color));
      c.addPath(arc(0, v));
      c.strokePath();
      c.setFillColor(new Color(color));
      for (const t of [0, v]) {
        const a = -Math.PI / 2 + 2 * Math.PI * t;
        c.fillEllipse(new Rect(cx + r * Math.cos(a) - lw / 2, cx + r * Math.sin(a) - lw / 2, lw, lw));
      }
    }
    c.setTextAlignedCenter();
    const ts = size * (o.textScale || (sub ? 0.3 : 0.34)) * (String(text).length >= 4 ? 0.84 : 1);
    c.setTextColor(new Color(o.textColor || C.text));
    c.setFont(NUM(ts));
    c.drawTextInRect(text, new Rect(0, cx - ts * 0.66 - (sub ? size * 0.06 : 0), size, ts * 1.35));
    if (sub) {
      const ss = size * 0.105;
      c.setTextColor(new Color(o.subColor || C.muted));
      c.setFont(DEMI(ss));
      c.drawTextInRect(sub, new Rect(0, cx + size * 0.13, size, ss * 1.4));
    }
    return c.getImage();
  }
  function txt(stack, text, font, color, o = {}) {
    const t = stack.addText(String(text));
    t.font = font;
    t.textColor = new Color(color || C.text);
    t.lineLimit = o.lines || 1;
    t.minimumScaleFactor = o.scale == null ? 0.6 : o.scale;
    if (o.center) t.centerAlignText();
    if (o.right) t.rightAlignText();
    return t;
  }
  function sym(stack, name, size, color) {
    const s = SFSymbol.named(name);
    if (!s) return null;
    s.applyFont(Font.semiboldSystemFont(size));
    const im = stack.addImage(s.image);
    im.imageSize = new Size(size, size);
    im.tintColor = new Color(color || C.text);
    return im;
  }
  function centered(stack, fn) {
    const row = stack.addStack();
    row.addSpacer();
    fn(row);
    row.addSpacer();
    return row;
  }
  const PLAN_SYM = { gym: 'dumbbell.fill', bike: 'bicycle', rest: 'bed.double.fill', done: 'checkmark', none: 'hourglass' };
  const PLAN_C = { gym: C.gym, bike: C.bike, rest: C.sleep, done: C.green, none: C.dim };
  const planKind = d.plan?.kind || (d.plan ? (/rad/i.test(d.plan.short || '') ? 'bike' : /pause/i.test(d.plan.short || '') ? 'rest' : 'gym') : 'none');
  const ill = d.ill && d.ill.level >= 2;
  const sleepSub = d.sleepMin != null ? `${hm(d.sleepMin)} Std.` : '';
  const strainSub = d.target ? `Ziel ${de(d.target[0], 0)}–${de(d.target[1], 0)}` : '';

  // ---- Sperrbildschirm
  if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const kind = /schlaf|sleep/.test(param) ? 'sleep' : /strain|belast/.test(param) ? 'strain' : 'rec';
    const img =
      kind === 'sleep'
        ? ring(62, frac(d.sleep, 100), '#FFFFFF', d.sleep == null ? '–' : String(d.sleep), 'SCHLAF', { trackAlpha: 0.25, lw: 5.5, subColor: '#FFFFFF' })
        : kind === 'strain'
          ? ring(62, frac(d.strain, 21), '#FFFFFF', de(d.strain, 1), 'STRAIN', { trackAlpha: 0.25, lw: 5.5, subColor: '#FFFFFF' })
          : ring(62, frac(d.recovery, 100), '#FFFFFF', d.recovery == null ? '–' : String(d.recovery), 'REC', { trackAlpha: 0.25, lw: 5.5, subColor: '#FFFFFF' });
    w.url = env.link(kind === 'sleep' ? 'tab=schlaf' : kind === 'strain' ? 'tab=belastung' : 'tab=recovery');
    centered(w, (row) => row.addImage(img));
    return w;
  }
  if (fam === 'accessoryInline') {
    txt(w, `${d.recovery == null ? '–' : d.recovery} % Recovery${d.plan ? ` · ${d.plan.short}` : ''}`, Font.semiboldSystemFont(12));
    return w;
  }
  if (fam === 'accessoryRectangular') {
    if (/train|plan|text/.test(param)) {
      txt(w, `${pct(d.recovery)} RECOVERY`, Font.heavySystemFont(14));
      if (ill) txt(w, `⚠︎ Infekt-Warnung: ${d.ill.label}`, Font.semiboldSystemFont(12));
      else if (d.plan) txt(w, d.plan.title, Font.semiboldSystemFont(12));
      txt(w, `Schlaf ${pct(d.sleep)} · Strain ${de(d.strain, 1)}`, Font.mediumSystemFont(11));
      return w;
    }
    const c = new DrawContext();
    c.size = new Size(156, 66);
    c.opaque = false;
    c.respectScreenScale = true;
    const items = [
      [frac(d.sleep, 100), d.sleep == null ? '–' : String(d.sleep), 'SCHLAF'],
      [frac(d.recovery, 100), d.recovery == null ? '–' : String(d.recovery), 'RECOVERY'],
      [frac(d.strain, 21), de(d.strain, 1), 'STRAIN'],
    ];
    items.forEach(([f, t], k) => c.drawImageInRect(ring(46, f, '#FFFFFF', t, null, { trackAlpha: 0.28, lw: 4.5, textScale: 0.36 }), new Rect(3.5 + k * 53, 1, 46, 46)));
    c.setTextAlignedCenter();
    c.setTextColor(new Color('#FFFFFF'));
    c.setFont(DEMI(9));
    items.forEach(([, , label], k) => c.drawTextInRect(label, new Rect(k * 53, 50, 53, 13)));
    w.url = env.link('tab=heute');
    w.addImage(c.getImage());
    return w;
  }

  // ---- Homebildschirm
  const g = new LinearGradient();
  g.colors = [new Color('#1A1E23'), new Color('#060708')];
  g.locations = [0, 1];
  w.backgroundGradient = g;

  function dial(parent, size, f, color, text, label, sub, q) {
    const col = parent.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.url = env.link(q);
    centered(col, (row) => row.addImage(ring(size, f, color, text, null, { lw: size * 0.085 })));
    col.addSpacer(4);
    centered(col, (row) => txt(row, label, DEMI(size > 80 ? 12 : 11), C.text, { center: true }));
    if (sub) centered(col, (row) => txt(row, sub, Font.mediumSystemFont(10), C.muted, { center: true }));
    return col;
  }
  function planRow(parent, height, o = {}) {
    const box = parent.addStack();
    box.backgroundColor = new Color(ill ? '#3A0A10' : C.card);
    box.cornerRadius = 12;
    box.setPadding(7, 9, 7, 10);
    box.centerAlignContent();
    box.url = env.link('tab=heute');
    if (height) box.size = new Size(0, height);
    const chip = box.addStack();
    chip.size = new Size(30, 30);
    chip.cornerRadius = 9;
    chip.backgroundColor = new Color(ill ? C.red : PLAN_C[planKind] || C.dim);
    chip.centerAlignContent();
    centered(chip, (row) => sym(row, ill ? 'exclamationmark.triangle.fill' : PLAN_SYM[planKind] || 'figure.walk', 15, '#FFFFFF'));
    box.addSpacer(9);
    const tx = box.addStack();
    tx.layoutVertically();
    if (ill) {
      txt(tx, `Infekt-Frühwarnung: ${d.ill.label}`, Font.boldSystemFont(13), '#FFFFFF');
      txt(tx, d.plan ? `Heute: ${d.plan.short}` : 'Heute ruhig angehen', Font.mediumSystemFont(11), '#FFB3BC');
    } else {
      txt(tx, d.plan ? d.plan.title : 'Warte auf deine Nacht', Font.boldSystemFont(13.5), C.text);
      if (d.plan?.sub) txt(tx, d.plan.sub, Font.mediumSystemFont(11), C.muted);
    }
    box.addSpacer();
    if (o.bed && d.bed) {
      const b = box.addStack();
      b.layoutVertically();
      txt(b, 'INS BETT', DEMI(9.5), C.muted, { right: true });
      txt(b, d.bed, NUM(17), C.sleep, { right: true });
    }
    return box;
  }

  if (fam === 'small') {
    w.setPadding(12, 12, 10, 12);
    w.url = env.link('tab=recovery');
    const top = w.addStack();
    top.centerAlignContent();
    txt(top, 'RECOVERY', DEMI(12), C.muted);
    top.addSpacer();
    if (ill) sym(top, 'exclamationmark.triangle.fill', 12, C.red);
    else if (stale) sym(top, 'clock', 11, C.yellow);
    w.addSpacer(3);
    centered(w, (row) => row.addImage(ring(80, frac(d.recovery, 100), zoneC, d.recovery == null ? '–' : `${d.recovery}%`)));
    w.addSpacer(5);
    const b = w.addStack();
    b.centerAlignContent();
    sym(b, 'moon.fill', 10, C.sleep);
    b.addSpacer(3);
    txt(b, pct(d.sleep), NUM(14));
    b.addSpacer();
    sym(b, 'bolt.fill', 10, C.strain);
    b.addSpacer(3);
    txt(b, de(d.strain, 1), NUM(14));
    if (d.plan) txt(w, d.plan.short, Font.semiboldSystemFont(11), C.muted);
    return w;
  }

  if (fam === 'medium') {
    w.setPadding(12, 14, 12, 14);
    const row = w.addStack();
    row.centerAlignContent();
    dial(row, 70, frac(d.sleep, 100), C.sleep, pct(d.sleep), 'SCHLAF', null, 'tab=schlaf');
    dial(row, 70, frac(d.recovery, 100), zoneC, pct(d.recovery), 'RECOVERY', null, 'tab=recovery');
    dial(row, 70, frac(d.strain, 21), C.strain, de(d.strain, 1), 'STRAIN', null, 'tab=belastung');
    w.addSpacer(8);
    planRow(w, 44, { bed: true });
    return w;
  }

  // ---- Groß: alles auf einen Blick (mit Lifestyle-Knöpfen etwas kompakter)
  const tight = !!env.life;
  w.setPadding(tight ? 11 : 13, 14, tight ? 10 : 12, 14);
  const head = w.addStack();
  head.centerAlignContent();
  txt(head, 'PULS', NUM(15), C.text);
  head.addSpacer(6);
  const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const dd = new Date(`${d.date}T12:00:00`);
  txt(head, isNaN(dd) ? '' : `${WD[dd.getDay()]}, ${dd.getDate()}.${dd.getMonth() + 1}.`, Font.semiboldSystemFont(12), C.muted);
  head.addSpacer();
  if (stale) txt(head, 'Noch keine Daten von heute', Font.semiboldSystemFont(10.5), C.yellow);
  else if (atText) txt(head, `Stand ${atText}`, Font.mediumSystemFont(10.5), C.dim);
  w.addSpacer(tight ? 5 : 8);

  const rings = w.addStack();
  rings.centerAlignContent();
  // drei gleich breite Spalten (jede Spalte dehnt sich über ihre zentrierten Zeilen)
  dial(rings, tight ? 72 : 82, frac(d.sleep, 100), C.sleep, pct(d.sleep), 'SCHLAF', sleepSub, 'tab=schlaf');
  dial(rings, tight ? 72 : 82, frac(d.recovery, 100), zoneC, pct(d.recovery), 'RECOVERY', d.recY != null ? `gestern ${d.recY}%` : '', 'tab=recovery');
  dial(rings, tight ? 72 : 82, frac(d.strain, 21), C.strain, de(d.strain, 1), 'STRAIN', strainSub, 'tab=belastung');
  w.addSpacer(tight ? 6 : 9);

  // Körperwerte
  const tiles = w.addStack();
  const tile = (icon, color, label, value, unit, sub, subColor, q) => {
    const t = tiles.addStack();
    t.layoutVertically();
    t.backgroundColor = new Color(C.card);
    t.cornerRadius = 10;
    t.setPadding(6, 8, 6, 6);
    t.size = new Size(0, tight ? 48 : 52);
    t.url = env.link(q);
    const l = t.addStack();
    l.centerAlignContent();
    sym(l, icon, 9, color);
    l.addSpacer(3);
    txt(l, label, DEMI(9.5), C.muted);
    l.addSpacer();
    t.addSpacer(1);
    const v = t.addStack();
    v.bottomAlignContent();
    txt(v, value, NUM(18));
    if (unit) {
      v.addSpacer(2);
      txt(v, unit, DEMI(9.5), C.muted);
    }
    if (sub) txt(t, sub, Font.mediumSystemFont(9), subColor || C.dim);
    return t;
  };
  const vs = (v, base, goodUp, unit) => {
    if (v == null || base == null) return [base != null ? `Ø ${base}` : '', null];
    const diff = v - base;
    const good = goodUp ? diff >= 0 : diff <= 0;
    const big = Math.abs(diff) >= (unit === '%' ? 0 : 1);
    const t = unit === '%' ? `${diff >= 0 ? '+' : '−'}${Math.abs(Math.round((100 * diff) / base))}% vs. Ø` : `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} vs. Ø`;
    return [t, big ? (good ? C.green : C.red) : C.dim];
  };
  const [hrvSub, hrvC] = vs(d.hrv, d.hrvBase, true, '%');
  const [rhrSub, rhrC] = vs(d.rhr, d.rhrBase, false, 'bpm');
  tile('waveform.path.ecg', C.green, 'HRV', d.hrv == null ? '–' : String(d.hrv), 'ms', hrvSub, hrvC, 'tab=recovery');
  tiles.addSpacer(6);
  tile('heart.fill', C.red, 'RUHEPULS', d.rhr == null ? '–' : String(d.rhr), 'bpm', rhrSub, rhrC, 'tab=recovery');
  tiles.addSpacer(6);
  const stepsDone = d.steps != null && d.stepGoal ? d.steps >= d.stepGoal : false;
  tile('figure.walk', C.strain, 'SCHRITTE', dots(d.steps), '', d.stepGoal ? `Ziel ${dots(d.stepGoal)}` : '', stepsDone ? C.green : C.dim, 'tab=belastung');
  tiles.addSpacer(6);
  if (d.bb != null) tile('bolt.fill', C.yellow, 'BATTERY', String(d.bb), '', d.stress != null ? `Stress ${d.stress}` : '', C.dim, 'tab=heute');
  else tile('moon.fill', C.sleep, 'BEDARF', hm(d.needMin), 'h', 'Schlaf heute Nacht', C.dim, 'tab=schlaf');
  w.addSpacer(tight ? 6 : 8);

  planRow(w, tight ? 42 : 46, { bed: true });
  w.addSpacer(tight ? 6 : 8);

  // Woche Mo–So: Training und Recovery-Zone
  if (Array.isArray(d.wk) && d.wk.length === 7) {
    const wk = w.addStack();
    wk.url = env.link('tab=heute');
    d.wk.forEach((x, k) => {
      if (k) wk.addSpacer();
      const cell = wk.addStack();
      cell.layoutVertically();
      cell.centerAlignContent();
      cell.size = new Size(38, 34);
      cell.cornerRadius = 8;
      cell.backgroundColor = new Color(x.t ? C.card2 : C.card, x.f ? 0.4 : 1);
      cell.setPadding(3, 2, 3, 2);
      const top = centered(cell, (row) => {
        txt(row, x.d.toUpperCase(), DEMI(9.5), x.t ? C.text : C.muted, { center: true });
        if (x.z) {
          row.addSpacer(2);
          const dot = row.addStack();
          dot.size = new Size(5, 5);
          dot.cornerRadius = 2.5;
          dot.backgroundColor = new Color(C[x.z] || C.dim);
        }
      });
      top.centerAlignContent();
      cell.addSpacer(2);
      centered(cell, (row) => {
        if (x.l) {
          const pill = row.addStack();
          pill.backgroundColor = new Color(C[x.k] || C.other);
          pill.cornerRadius = 4;
          pill.setPadding(1, 3, 1, 3);
          txt(pill, x.n > 1 ? `${x.l}+` : x.l, DEMI(9.5), '#FFFFFF', { scale: 0.5 });
        } else txt(row, x.f ? ' ' : '–', DEMI(9.5), C.dim, { center: true });
      });
    });
  }

  // Lifestyle-Knöpfe (nur wenn Puls direkt aufgeht) – sonst die Woche als Satz
  w.addSpacer(tight ? 6 : 8);
  if (env.life) {
    const lf = w.addStack();
    lf.centerAlignContent();
    const L = [
      ['koffein', 'cup.and.saucer.fill'], ['alkohol', 'wineglass.fill'], ['spaetessen', 'fork.knife'], ['stress', 'brain.head.profile'],
      ['sauna', 'flame.fill'], ['meditation', 'figure.mind.and.body'], ['kalt', 'snowflake'],
    ];
    L.forEach(([id, icon], k) => {
      if (k) lf.addSpacer();
      const b = lf.addStack();
      b.size = new Size(32, 32);
      b.cornerRadius = 16;
      b.backgroundColor = new Color(C.card2);
      b.centerAlignContent();
      b.url = env.link(`log=${id}`);
      centered(b, (row) => sym(row, icon, 14, '#D7DCE1'));
    });
    lf.addSpacer();
    const pad = lf.addStack();
    pad.size = new Size(32, 32);
    pad.cornerRadius = 16;
    pad.backgroundColor = new Color(C.strain, 0.25);
    pad.centerAlignContent();
    pad.url = env.link('open=laufband');
    centered(pad, (row) => sym(row, 'figure.walk', 14, C.strain));
  } else {
    const f = w.addStack();
    f.centerAlignContent();
    sym(f, 'calendar', 10, C.muted);
    f.addSpacer(4);
    txt(f, `Diese Woche ${d.week || '–'}${d.wkPrev != null ? ` · Vorwoche ${d.wkPrev}` : ''}`, Font.mediumSystemFont(11), C.muted);
  }
  return w;
}

/** Fertiger Code für Scriptable, mit Adresse und Schlüssel (aus deinem Passwort abgeleitet). */
export function widgetScript({ url, keyHex, app }) {
  const fns = [sha256, hmacSha256, b64decode, hexBytes, utf8, openWidgetBox, render].map((f) => f.toString()).join('\n\n');
  return `// Puls-Widget für Scriptable – Recovery, Schlaf, Strain, Körperwerte, Training und Woche.
// Einrichten: Scriptable öffnen → + → diesen Code einfügen → Namen „Puls“ geben.
// Homebildschirm: Scriptable-Widget (klein, mittel oder groß) → Script „Puls“.
// Sperrbildschirm: rund (Parameter: recovery, schlaf oder strain) oder rechteckig (leer = drei Ringe, „training“ = Text).
// Im Scriptable-App starten: Vorschau und Test, ob ein Tippen Puls direkt öffnen kann.
// variant: dark  icon-color: green  icon-glyph: heartbeat
const URL_ = ${JSON.stringify(url)};
const KEY = ${JSON.stringify(keyHex)};
const APP = ${JSON.stringify(app)};

${fns}

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'puls-widget.json');
const SETTINGS = fm.joinPath(fm.documentsDirectory(), 'puls-widget-settings.json');

function settings() {
  try {
    return fm.fileExists(SETTINGS) ? JSON.parse(fm.readString(SETTINGS)) : {};
  } catch (e) {
    return {};
  }
}

/** Wohin ein Tippen führt: direkt in die Puls-App (falls dein iOS das kann) oder in dieses Script. */
function makeLink(s) {
  const base = APP.replace(/\\/?$/, '/');
  return (q) => {
    if (s.open === 'webapp') return (s.variant === 'b' ? 'webapp://' + base : 'webapp://' + base.replace(/^https?:\\/\\//, '')) + (q ? '?' + q : '');
    return 'scriptable:///run/' + encodeURIComponent(Script.name()) + (q ? '?' + q : '');
  };
}

async function load() {
  try {
    const req = new Request(URL_ + '?t=' + Date.now());
    req.timeoutInterval = 12;
    const data = openWidgetBox(await req.loadJSON(), KEY);
    fm.writeString(CACHE, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(CACHE)) return JSON.parse(fm.readString(CACHE));
    throw e;
  }
}

function errorWidget(e) {
  const w = new ListWidget();
  w.backgroundColor = new Color('#000000');
  const t = w.addText('Puls: ' + ((e && e.message) || 'keine Daten'));
  t.textColor = Color.white();
  t.font = Font.mediumSystemFont(12);
  return w;
}

const wait = (ms) => new Promise((r) => Timer.schedule(ms, false, r));
async function ask(title, message, actions, cancel) {
  const a = new Alert();
  a.title = title;
  a.message = message || '';
  for (const x of actions) a.addAction(x);
  if (cancel) a.addCancelAction(cancel);
  return a.presentAlert();
}

/** Test: Kann ein Tippen deine Puls-App vom Homebildschirm direkt öffnen? (inoffizieller iOS-Weg) */
async function testDirect(s) {
  for (const variant of ['a', 'b']) {
    const go = await ask(\`Test \${variant === 'a' ? 1 : 2} von 2\`, 'Ich versuche jetzt, deine Puls-App vom Homebildschirm zu öffnen. Komm danach zu Scriptable zurück.', ['Los'], 'Abbrechen');
    if (go === -1) return;
    Safari.open(makeLink({ open: 'webapp', variant })(''));
    await wait(1500);
    const ok = await ask('Hat sich Puls geöffnet?', 'Als App vom Homebildschirm – nicht in Safari.', ['Ja, Puls ging auf', 'Nein'], null);
    if (ok === 0) {
      fm.writeString(SETTINGS, JSON.stringify({ ...s, open: 'webapp', variant }));
      await ask('Klappt!', 'Ab jetzt öffnet ein Tippen aufs Widget Puls direkt. Ringe springen in den passenden Bereich, und im großen Widget erscheinen die Lifestyle-Knöpfe. Das Widget übernimmt das bei der nächsten Aktualisierung.', ['OK'], null);
      return;
    }
  }
  fm.writeString(SETTINGS, JSON.stringify({ ...s, open: 'run' }));
  await ask('Geht auf deinem iPhone nicht', 'iOS lässt Widgets anderer Apps keine Web-App vom Homebildschirm öffnen. Tippen aufs Widget öffnet dann dieses Script. Tipp: Leg das Puls-Symbol direkt neben das Widget.', ['OK'], null);
}

async function inApp(data, s) {
  const q = args.queryParameters || {};
  if ((q.log || q.open || q.tab) && s.open !== 'webapp') {
    await ask('Puls direkt öffnen', 'Dafür muss dein iPhone Puls direkt aus dem Widget öffnen können. Teste es jetzt.', ['Testen'], 'Später');
  }
  const env = (fam) => ({ fam, param: '', link: makeLink(s), life: s.open === 'webapp' });
  for (;;) {
    const a = new Alert();
    a.title = 'Puls-Widget';
    a.message = s.open === 'webapp' ? 'Tippen aufs Widget öffnet Puls direkt.' : 'Tippen aufs Widget öffnet im Moment Scriptable. Teste, ob dein iPhone Puls direkt öffnen kann.';
    a.addAction('Puls direkt öffnen – testen');
    a.addAction('Vorschau groß');
    a.addAction('Vorschau mittel');
    a.addAction('Vorschau klein');
    a.addCancelAction('Fertig');
    const i = await a.presentSheet();
    if (i === 0) {
      await testDirect(s);
      s = settings();
    } else if (i === 1) await render(data, env('large')).presentLarge();
    else if (i === 2) await render(data, env('medium')).presentMedium();
    else if (i === 3) await render(data, env('small')).presentSmall();
    else return;
  }
}

const s0 = settings();
if (config.runsInWidget || config.runsInAccessoryWidget) {
  let widget;
  try {
    widget = render(await load(), { fam: config.widgetFamily || 'large', param: args.widgetParameter || '', link: makeLink(s0), life: s0.open === 'webapp' });
  } catch (e) {
    widget = errorWidget(e);
  }
  Script.setWidget(widget);
} else {
  let data = null;
  try {
    data = await load();
  } catch (e) {
    await ask('Puls', 'Keine Daten: ' + ((e && e.message) || ''), ['OK'], null);
  }
  if (data) await inApp(data, s0);
}
Script.complete();
`;
}
