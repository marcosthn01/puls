// Strenge Nachbildung der Scriptable-API für Tests: Jede Methode oder Eigenschaft, die es in
// Scriptable nicht gibt, wirft einen Fehler. So fällt ein Tippfehler im Widget-Code hier auf und
// nicht erst auf dem iPhone. (Quelle der Namen: docs.scriptable.app)

const strict = (name, obj, props, methods) =>
  new Proxy(obj, {
    get(t, k) {
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON' || k === 'constructor') return t[k];
      if (methods.includes(k)) return t[k] || (() => undefined);
      if (props.includes(k)) return t[k];
      throw new Error(`${name}.${String(k)} gibt es in Scriptable nicht`);
    },
    set(t, k, v) {
      if (!props.includes(k)) throw new Error(`${name}.${String(k)} (setzen) gibt es in Scriptable nicht`);
      t[k] = v;
      return true;
    },
  });

const STACK_P = ['backgroundColor', 'backgroundImage', 'backgroundGradient', 'spacing', 'size', 'cornerRadius', 'borderWidth', 'borderColor', 'url'];
const STACK_M = ['addText', 'addDate', 'addImage', 'addSpacer', 'addStack', 'setPadding', 'useDefaultPadding', 'topAlignContent', 'centerAlignContent', 'bottomAlignContent', 'layoutHorizontally', 'layoutVertically'];
const FONTS = [
  'largeTitle', 'title1', 'title2', 'title3', 'headline', 'subheadline', 'body', 'callout', 'footnote', 'caption1', 'caption2',
  'systemFont', 'ultraLightSystemFont', 'thinSystemFont', 'lightSystemFont', 'regularSystemFont', 'mediumSystemFont', 'semiboldSystemFont', 'boldSystemFont', 'heavySystemFont', 'blackSystemFont', 'italicSystemFont',
  'ultraLightMonospacedSystemFont', 'thinMonospacedSystemFont', 'lightMonospacedSystemFont', 'regularMonospacedSystemFont', 'mediumMonospacedSystemFont', 'semiboldMonospacedSystemFont', 'boldMonospacedSystemFont', 'heavyMonospacedSystemFont', 'blackMonospacedSystemFont',
  'ultraLightRoundedSystemFont', 'thinRoundedSystemFont', 'lightRoundedSystemFont', 'regularRoundedSystemFont', 'mediumRoundedSystemFont', 'semiboldRoundedSystemFont', 'boldRoundedSystemFont', 'heavyRoundedSystemFont', 'blackRoundedSystemFont',
];

/**
 * Installiert die Nachbildung in globalThis. `log` sammelt Texte/Bilder/Links, `alerts` steuert die
 * Antworten auf Alert-Dialoge (Index der gewählten Aktion, der Reihe nach).
 */
export function installScriptable({ fetchJSON, family = 'large', runsInWidget = true, accessory = false, parameter = null, query = {}, alerts = [] }) {
  const g = globalThis;
  const log = { texts: [], images: 0, urls: [], opened: [], files: {}, widget: null, alerts: [], presented: [] };
  const num = (v, what) => {
    if (!Number.isFinite(v)) throw new Error(`${what}: keine Zahl (${v})`);
    return v;
  };
  const container = (name, extraP = [], extraM = []) => {
    const o = {
      addText(s) {
        log.texts.push(String(s));
        return strict('WidgetText', { text: s }, ['text', 'textColor', 'font', 'textOpacity', 'lineLimit', 'minimumScaleFactor', 'shadowColor', 'shadowRadius', 'shadowOffset', 'url'], ['leftAlignText', 'centerAlignText', 'rightAlignText']);
      },
      addImage(img) {
        if (!img) throw new Error('addImage ohne Bild');
        log.images++;
        return strict('WidgetImage', { image: img }, ['image', 'resizable', 'imageSize', 'imageOpacity', 'cornerRadius', 'borderWidth', 'borderColor', 'containerRelativeShape', 'tintColor', 'url'], ['leftAlignImage', 'centerAlignImage', 'rightAlignImage', 'applyFittingContentMode', 'applyFillingContentMode']);
      },
      addSpacer(n) {
        if (n != null) num(n, 'addSpacer');
        return strict('WidgetSpacer', { length: n }, ['length'], []);
      },
      addStack() {
        return container('WidgetStack');
      },
    };
    const p = strict(name, o, [...STACK_P, ...extraP], [...STACK_M, ...extraM]);
    return new Proxy(p, {
      set(t, k, v) {
        if (k === 'url') log.urls.push(v);
        t[k] = v;
        return true;
      },
      get: (t, k) => t[k],
    });
  };
  const present = (fam) => async () => log.presented.push(fam);
  g.ListWidget = function ListWidget() {
    const w = container('ListWidget', ['addAccessoryWidgetBackground', 'refreshAfterDate'], ['presentSmall', 'presentMedium', 'presentLarge', 'presentExtraLarge', 'presentAccessoryCircular', 'presentAccessoryRectangular', 'presentAccessoryInline']);
    return new Proxy(w, {
      get(t, k) {
        if (typeof k === 'string' && k.startsWith('present')) return present(k.slice(7).toLowerCase());
        return t[k];
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
  };
  g.DrawContext = function DrawContext() {
    const o = { getImage: () => ({ img: true }) };
    return strict('DrawContext', o, ['size', 'respectScreenScale', 'opaque'], ['getImage', 'drawImageInRect', 'drawImageAtPoint', 'setFillColor', 'setStrokeColor', 'setLineWidth', 'fillRect', 'fill', 'strokeRect', 'stroke', 'fillEllipse', 'strokeEllipse', 'addPath', 'strokePath', 'fillPath', 'drawText', 'drawTextInRect', 'setFont', 'setTextColor', 'setTextAlignedLeft', 'setTextAlignedCenter', 'setTextAlignedRight']);
  };
  g.Path = function Path() {
    return strict('Path', {}, [], ['move', 'addLine', 'addRect', 'addEllipse', 'addRoundedRect', 'addCurve', 'addQuadCurve', 'addLines', 'addRects', 'closeSubpath']);
  };
  g.Size = function Size(w, h) {
    num(w, 'Size');
    num(h, 'Size');
  };
  g.Point = function Point(x, y) {
    num(x, 'Point');
    num(y, 'Point');
  };
  g.Rect = function Rect(x, y, w, h) {
    [x, y, w, h].forEach((v) => num(v, 'Rect'));
  };
  g.Color = function Color(hex, alpha) {
    if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) throw new Error('Farbe ' + hex);
    if (alpha != null) num(alpha, 'Farbe Alpha');
  };
  g.Color.white = () => new g.Color('#FFFFFF');
  g.Color.black = () => new g.Color('#000000');
  g.Font = function Font(name, size) {
    if (typeof name !== 'string') throw new Error('Font-Name');
    num(size, 'Schriftgröße');
  };
  for (const f of FONTS) g.Font[f] = (n) => (n == null || num(n, 'Schriftgröße'), {});
  g.LinearGradient = function LinearGradient() {
    return strict('LinearGradient', {}, ['colors', 'locations', 'startPoint', 'endPoint'], []);
  };
  g.SFSymbol = {
    named: (n) => {
      if (typeof n !== 'string' || !n) throw new Error('SFSymbol-Name');
      return strict('SFSymbol', { image: { sym: n } }, ['image'], ['applyFont', 'applyUltraLightWeight', 'applyThinWeight', 'applyLightWeight', 'applyRegularWeight', 'applyMediumWeight', 'applySemiboldWeight', 'applyBoldWeight', 'applyHeavyWeight', 'applyBlackWeight']);
    },
  };
  g.Request = function Request(url) {
    return strict('Request', { url, loadJSON: async () => fetchJSON(url) }, ['timeoutInterval', 'url', 'method', 'headers', 'body'], ['loadJSON', 'loadString', 'load', 'loadImage']);
  };
  g.FileManager = {
    local: () =>
      strict(
        'FileManager',
        {
          documentsDirectory: () => '/docs',
          joinPath: (a, b) => `${a}/${b}`,
          writeString: (p, s) => (log.files[p] = s),
          readString: (p) => log.files[p],
          fileExists: (p) => p in log.files,
        },
        [],
        ['documentsDirectory', 'joinPath', 'writeString', 'readString', 'fileExists', 'cacheDirectory', 'temporaryDirectory', 'remove', 'read', 'write'],
      ),
  };
  const answers = [...alerts];
  g.Alert = function Alert() {
    const o = { actions: [] };
    o.addAction = (t) => o.actions.push(t);
    o.addDestructiveAction = (t) => o.actions.push(t);
    o.addCancelAction = (t) => (o.cancel = t);
    o.presentAlert = o.presentSheet = async () => {
      log.alerts.push(o.title);
      return answers.length ? answers.shift() : -1;
    };
    return strict('Alert', o, ['title', 'message', 'actions', 'cancel'], ['addAction', 'addDestructiveAction', 'addCancelAction', 'addTextField', 'addSecureTextField', 'presentAlert', 'presentSheet', 'textFieldValue']);
  };
  g.Timer = { schedule: (ms, rep, fn) => setTimeout(fn, 1) };
  g.Safari = { open: (u) => log.opened.push(u), openInApp: async (u) => log.opened.push(u) };
  g.config = strict('config', { runsInWidget, runsInAccessoryWidget: accessory, runsInApp: !runsInWidget, widgetFamily: runsInWidget ? family : null }, ['runsInWidget', 'runsInAccessoryWidget', 'runsInApp', 'runsInActionExtension', 'runsWithSiri', 'runsFromHomeScreen', 'widgetFamily'], []);
  g.args = strict('args', { widgetParameter: parameter, queryParameters: query }, ['widgetParameter', 'queryParameters', 'plainTexts', 'urls', 'fileURLs', 'images', 'notification', 'shortcutParameter'], []);
  g.Script = strict('Script', { setWidget: (w) => (log.widget = w), complete: () => {}, name: () => 'Puls' }, [], ['setWidget', 'complete', 'name', 'setShortcutOutput']);
  return log;
}
