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

export { sha256, hmacSha256, b64decode, hexBytes, utf8, openWidgetBox };

/** Darstellung im Widget (läuft in Scriptable). */
function render(d) {
  const C = { green: '#16EC06', yellow: '#FFDE00', red: '#FF0026', sleep: '#7BA1BB', strain: '#0093E7', muted: '#8A9099' };
  const zone = (z) => C[z] || C.muted;
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.url = APP;
  w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);
  const de = (v, n = 0) => (v == null ? '–' : (Math.round(v * 10 ** n) / 10 ** n).toFixed(n).replace('.', ','));

  function ring(size, frac, color, text, sub) {
    const c = new DrawContext();
    c.size = new Size(size, size);
    c.opaque = false;
    c.respectScreenScale = true;
    const lw = Math.max(3, size * 0.095);
    const r = (size - lw) / 2;
    const cx = size / 2;
    const arc = (f0, f1) => {
      const p = new Path();
      const n = Math.max(2, Math.ceil(72 * (f1 - f0)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + 2 * Math.PI * (f0 + ((f1 - f0) * i) / n);
        pts.push(new Point(cx + r * Math.cos(a), cx + r * Math.sin(a)));
      }
      p.addLines(pts);
      return p;
    };
    c.setLineWidth(lw);
    c.setStrokeColor(new Color('#FFFFFF', 0.1));
    c.addPath(arc(0, 1));
    c.strokePath();
    const f = Math.max(0, Math.min(1, frac || 0));
    if (f > 0.005) {
      c.setStrokeColor(new Color(color));
      c.addPath(arc(0, f));
      c.strokePath();
      c.setFillColor(new Color(color));
      for (const t of [0, f]) {
        const a = -Math.PI / 2 + 2 * Math.PI * t;
        c.fillEllipse(new Rect(cx + r * Math.cos(a) - lw / 2, cx + r * Math.sin(a) - lw / 2, lw, lw));
      }
    }
    c.setTextAlignedCenter();
    c.setTextColor(Color.white());
    c.setFont(Font.boldRoundedSystemFont(size * (sub ? 0.24 : 0.28)));
    c.drawTextInRect(text, new Rect(0, cx - size * (sub ? 0.2 : 0.17), size, size * 0.34));
    if (sub) {
      c.setTextColor(new Color(C.muted));
      c.setFont(Font.semiboldSystemFont(size * 0.095));
      c.drawTextInRect(sub, new Rect(0, cx + size * 0.08, size, size * 0.14));
    }
    return c.getImage();
  }
  const label = (stack, text, size, color, font) => {
    const t = stack.addText(text);
    t.font = font || Font.boldSystemFont(size);
    t.textColor = new Color(color || '#FFFFFF');
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.7;
    return t;
  };
  const rec = d.recovery;
  const recText = rec == null ? '–' : `${rec}%`;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const stale = d.date !== today && now.getHours() >= 10;

  if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack();
    s.addSpacer();
    s.addImage(ring(64, rec == null ? 0 : rec / 100, '#FFFFFF', rec == null ? '–' : String(rec), 'REC'));
    s.addSpacer();
    return w;
  }
  if (fam === 'accessoryInline') {
    label(w, `Recovery ${recText}${d.plan ? ` · ${d.plan.short}` : ''}`, 12);
    return w;
  }
  if (fam === 'accessoryRectangular') {
    label(w, `${recText} RECOVERY`, 15, '#FFFFFF', Font.heavySystemFont(15));
    if (d.plan) label(w, d.plan.title, 12);
    label(w, `Schlaf ${d.sleep == null ? '–' : `${d.sleep}%`} · Strain ${de(d.strain, 1)}`, 11, '#FFFFFF', Font.mediumSystemFont(11));
    return w;
  }

  const g = new LinearGradient();
  g.colors = [new Color('#1B1F24'), new Color('#050607')];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(12, 12, 12, 12);

  if (fam === 'small') {
    label(w, 'RECOVERY', 11, C.muted, Font.heavySystemFont(11));
    w.addSpacer(4);
    const s = w.addStack();
    s.addSpacer();
    s.addImage(ring(96, rec == null ? 0 : rec / 100, zone(d.zone), recText));
    s.addSpacer();
    w.addSpacer(6);
    label(w, `Schlaf ${d.sleep == null ? '–' : `${d.sleep}%`} · Strain ${de(d.strain, 1)}`, 11, '#FFFFFF', Font.semiboldSystemFont(11));
    if (d.plan) label(w, d.plan.short, 11, C.muted, Font.mediumSystemFont(11));
    return w;
  }

  const row = w.addStack();
  row.centerAlignContent();
  const dial = (frac, color, text, name) => {
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    const img = col.addImage(ring(fam === 'large' ? 92 : 76, frac, color, text));
    img.centerAlignImage();
    col.addSpacer(4);
    const t = label(col, name, 10, C.muted, Font.heavySystemFont(10));
    t.centerAlignText();
  };
  row.addSpacer();
  dial(d.sleep == null ? 0 : d.sleep / 100, C.sleep, d.sleep == null ? '–' : `${d.sleep}%`, 'SCHLAF');
  row.addSpacer();
  dial(rec == null ? 0 : rec / 100, zone(d.zone), recText, 'RECOVERY');
  row.addSpacer();
  dial(d.strain == null ? 0 : d.strain / 21, C.strain, de(d.strain, 1), 'STRAIN');
  row.addSpacer();
  w.addSpacer(8);
  if (d.ill && d.ill.level >= 2) label(w, `⚠︎ Infekt-Frühwarnung: ${d.ill.label}`, 12, C.red, Font.semiboldSystemFont(12));
  if (d.plan) {
    label(w, d.plan.title, 14, '#FFFFFF', Font.boldSystemFont(14));
    if (d.plan.sub) label(w, d.plan.sub, 11, C.muted, Font.mediumSystemFont(11));
  }
  if (fam === 'large') {
    w.addSpacer(6);
    if (d.bed) label(w, `Ins Bett um ${d.bed}`, 12, '#FFFFFF', Font.semiboldSystemFont(12));
    if (d.week) label(w, `Diese Woche: ${d.week}`, 12, C.muted, Font.mediumSystemFont(12));
  }
  if (stale) label(w, 'Noch keine Daten von heute', 10, C.yellow, Font.mediumSystemFont(10));
  return w;
}

/** Fertiger Code für Scriptable, mit Adresse und Schlüssel (aus deinem Passwort abgeleitet). */
export function widgetScript({ url, keyHex, app }) {
  const fns = [sha256, hmacSha256, b64decode, hexBytes, utf8, openWidgetBox, render].map((f) => f.toString()).join('\n\n');
  return `// Puls-Widget für Scriptable – Recovery, Schlaf, Strain und dein Training heute.
// Einrichten: Scriptable öffnen → + → diesen Code einfügen → Namen „Puls“ geben.
// Dann auf dem Homebildschirm ein Scriptable-Widget hinzufügen und „Puls“ als Script wählen.
// variant: dark  icon-color: green  icon-glyph: heartbeat
const URL_ = ${JSON.stringify(url)};
const KEY = ${JSON.stringify(keyHex)};
const APP = ${JSON.stringify(app)};

${fns}

async function load() {
  const fm = FileManager.local();
  const file = fm.joinPath(fm.documentsDirectory(), 'puls-widget.json');
  try {
    const req = new Request(URL_ + '?t=' + Date.now());
    req.timeoutInterval = 12;
    const data = openWidgetBox(await req.loadJSON(), KEY);
    fm.writeString(file, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(file)) return JSON.parse(fm.readString(file));
    throw e;
  }
}

let widget;
try {
  widget = render(await load());
} catch (e) {
  widget = new ListWidget();
  widget.backgroundColor = new Color('#000000');
  const t = widget.addText('Puls: ' + (e.message || 'keine Daten'));
  t.textColor = Color.white();
  t.font = Font.mediumSystemFont(12);
}
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
`;
}
