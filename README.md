# Puls – dein Recovery-Coach für die Garmin Venu 4S

Eine private iPhone-App (Web-App für den Home-Bildschirm), die deine Garmin-Daten automatisch abholt
und so auswertet wie Whoop:

- **Recovery, Strain, Schlaf** als leuchtende Ringe, mit Tagesziel und Schlafplaner.
- **Dein Tagesbericht – wie beim Arzt:** Jeden Morgen schaut sich der KI-Coach alle deine Werte an
  (Nacht, Trends der letzten Wochen, Morgen-Check, deine Angaben zu Ziel, Essen und Gesundheit) und
  schreibt eine persönliche Einschätzung mit Plan für Training, Ernährung und Schlaf – plus klare
  Hinweise, wann etwas ärztlich abgeklärt werden sollte.
- **Ernährung heute:** Kalorien, Eiweiß, Kohlenhydrate, Fett und Wasser aus deinem echten
  Garmin-Verbrauch, angepasst an die Belastung des Tages und dein Ziel (abnehmen, Muskeln, Ausdauer …).
- **Training heute:** Puls lernt aus deinen Garmin-Aktivitäten, was du trainierst (z. B. Gym im Push/Pull-Wechsel
  und Rad), und sagt dir jeden Tag konkret, was dran ist: „Rad · 75 Min., Puls um 138“ oder „Gym · Pull,
  −20 % Volumen, 2–3 Wdh. in Reserve“ – passend zu Recovery, HRV-Trend, Schlaf, Last und Infekt-Zeichen.
  Keine Zone-4-Intervalle, wenn du so etwas nie trainierst.
- **Lifestyle-Log wie ein Tagebuch:** Symbol-Knöpfe auf „Heute“ (Kaffee, Alkohol, spätes Essen, Handy im Bett,
  Stress, Sauna, Meditation, Kälte …) – antippen, wenn es passiert, Puls merkt sich die Uhrzeit. Danach zeigt
  Puls, wie jedes Verhalten deine Nacht verändert (Recovery, HRV, Ruhepuls, Tiefschlaf), deine persönliche
  Koffein-Grenze und Alkohol nach Menge – und sagt beim Loggen direkt, was das für heute Nacht bedeutet.
- **iPhone-Widgets** (Home- und Sperrbildschirm) über die kostenlose App Scriptable: Schlaf, Recovery, Strain
  und dein Training heute. Die Widget-Datei ist verschlüsselt (Schlüssel aus deinem Daten-Passwort);
  Code zum Kopieren unter Einstellungen → iPhone-Widgets.
- **Trainingswoche & Kalender:** Auf „Heute“ siehst du Mo–So, an welchen Tagen du was trainiert hast
  (Push, Pull, Rad …) und wie viele Trainings es diese Woche sind; der Monatskalender unter Trends
  zeigt Recovery und Training zusammen.
- **Trainingskalender für Google/Apple:** Jedes Training landet automatisch als ganztägiges Ereignis
  („Push“, „Pull“, „Cardio · Rad“) in einem abonnierbaren Kalender (geheimer Link unter Einstellungen →
  Trainingskalender, ohne Gesundheitswerte). Push/Pull: einmal in der App antippen, Puls ergänzt den Rest
  im Wechsel.
- **Infekt-Frühwarnung:** Ruhepuls, HRV, Atmung und Hauttemperatur gegen deine eigene Basis, über mehrere
  Nächte. Bei Frühzeichen zeigt Puls nie „voll erholt“, rät zu Pause oder lockerer Bewegung und schickt
  morgens eine Warnung. Mit „Ich fühle mich angeschlagen“ plant Puls sofort Ruhe ein.
- **Gesundheits-Check:** deine letzten 7 Tage gegen deine eigenen 2 Monate davor (Ruhepuls, HRV,
  Atmung, Schlaf, Rhythmus, Blutsauerstoff, Bewegung, VO₂max) – wie ein Arzt auf Trends schaut.
- **KI-Coach im Chat** (Claude): „Wie bin ich heute drauf?“, „Mach mir einen Trainingsplan“ – er kennt
  deine Daten, schlägt einzelne Tage nach und kann Morgen-Check und Einstellungen für dich eintragen.
- **Immer aktuell:** Beim Öffnen zeigt Puls sofort den letzten Stand und holt im Hintergrund frische
  Daten von Garmin (ca. 1 Minute, mit sichtbarem Fortschritt). Fehlt morgens die Nacht noch, wartet
  die Morgenwache darauf und holt sie, sobald sie bei Garmin ist – auch bei geschlossener App.
- **Benachrichtigungen** (jede einzeln abschaltbar, je höchstens einmal am Tag):
  - morgens: Recovery, Ziel-Strain und Schlaf
  - mittags: „Erst 2.100 Schritte“ oder „Stress seit einer Stunde hoch“ – nur wenn es zutrifft
  - nachmittags: wie viele Minuten bis zum Trainingsziel fehlen, oder „Ziel erreicht“
  - früher Abend: „Noch 2.600 Schritte bis zu deinem Ziel“ oder „Schrittziel geschafft“
  - abends: Erinnerung zum Schlafengehen
  - freitags: fehlende Intensitätsminuten der Woche · sonntags: Wochenbericht
  - nach dem Walking-Pad: kurze Bestätigung mit deinen Schritten heute
- **Morgen-Check** (wie das Whoop-Journal) mit gemessenem Effekt, z. B. „Alkohol: −14 % Recovery“.
- **Körper-Check** (HRV, Ruhepuls, Atmung, SpO₂), **Stress & Body Battery** im Tagesverlauf,
  **Puls-Alter** (wie Whoops Healthspan), **Trainingslast**, **Wochenbericht** und **Kalender**.
- Einfache Bedienung: kurze Einführung beim ersten Start, (i)-Knöpfe erklären jeden Wert.

Die Berechnungen stehen in der App unter **Einstellungen → So rechnet Puls** und im Code in
[`app/engine.js`](app/engine.js).

## So funktioniert's

```
Venu 4S ──► Garmin-Connect-App ──► Garmin-Cloud
                                       │  GitHub Actions holt die Daten:
                                       │  beim Öffnen der App + morgens bis die Nacht da ist
                                       ▼
                        data.enc.json (AES-256 verschlüsselt) auf GitHub Pages
                                       │
                                       ▼
                     Puls auf dem iPhone: entschlüsselt und rechnet auf dem Gerät
```

- Kein Server und keine Kosten: alles läuft kostenlos über GitHub.
- Deine Gesundheitsdaten liegen nur **verschlüsselt** im Netz. Entschlüsselt werden sie nur auf
  deinem iPhone, mit deinem Daten-Passwort.
- Garmin-Login und Daten-Passwort liegen als GitHub-Secrets im Repo. Im Log stehen nur Anzahlen.

## Einrichtung (ca. 15 Minuten, geht komplett am iPhone)

### 1. Eigenes Repo `puls` anlegen

1. Auf <https://github.com/new>:
   - Name `puls` eintragen,
   - **Public** wählen,
   - nichts weiter ankreuzen,
   - „Create repository“ tippen.
2. Claude Bescheid geben, dann kommt der Code dort hinein.

Warum öffentlich? GitHub Pages ist nur für öffentliche Repos kostenlos.

- Öffentlich sind nur der App-Code und die verschlüsselte Datendatei.
- Ohne dein Passwort ist die Datei nur Datensalat.

### 2. Drei Secrets anlegen

Im Repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Inhalt |
|---|---|
| `GARMIN_EMAIL` | deine Garmin-Connect-E-Mail |
| `GARMIN_PASSWORD` | dein Garmin-Connect-Passwort |
| `DATA_PASSPHRASE` | ein **neues** Passwort nur für Puls (mind. 10 Zeichen, z. B. vier zufällige Wörter) |

Merk dir `DATA_PASSPHRASE`, du gibst es einmal in der App ein.

### 3. GitHub Pages einschalten

**Settings → Pages → Build and deployment → Source: „GitHub Actions“**.

### 4. Ersten Sync starten

**Actions → „Puls Sync“ → Run workflow → Run workflow**.

- Beim ersten Mal holt er die letzten 90 Tage. Das dauert ca. 3–6 Minuten.
- Dadurch sind die Auswertungen von Anfang an persönlich.

Falls Garmin einen **Bestätigungscode** schickt (E-Mail):

1. Den Lauf noch einmal starten.
2. Den Code ins Feld „Garmin-Bestätigungscode“ eintragen.
3. Das muss innerhalb von 30 Minuten passieren.

Danach merkt sich der Sync die Anmeldung.

### 5. App auf den Home-Bildschirm

1. In **Safari** <https://marcosthn01.github.io/puls/> öffnen.
2. Teilen-Symbol → **„Zum Home-Bildschirm“**.
3. Puls vom Home-Bildschirm starten und `DATA_PASSPHRASE` eingeben.

Das Passwort bleibt nur auf diesem iPhone gespeichert. Mit „Demo-Daten ansehen“ kannst du die App
schon vor dem ersten Sync ausprobieren.

### 6. In der App: „Puls fertig einrichten“

Auf der Startseite steht eine Karte mit drei Punkten. Jeder Punkt führt dich Schritt für Schritt durch:

1. **Automatisch aktualisieren** (2 Min., wichtig): Ein vorausgefüllter GitHub-Link erstellt einen
   Schlüssel, der nur den Abruf starten darf. Bei „Repository access“ → „Only select repositories“ →
   `puls`. Ohne diesen Schlüssel kann Puls keine neuen Daten holen.
2. **KI-Coach** (3 Min.): Schlüssel in der [Claude-Konsole](https://console.anthropic.com/settings/keys)
   erstellen, etwas Guthaben aufladen (eine Frage kostet ca. 2–4 Cent), in Puls einfügen.
   Der Coach nutzt standardmäßig Claude Opus 5.5; in den Einstellungen kannst du ein günstigeres
   Modell wählen.
3. **Benachrichtigungen**: „Erlauben“ tippen. Klappt nur, wenn Puls vom Home-Bildschirm geöffnet ist.
   Welche du bekommst, wählst du danach unter Einstellungen → Benachrichtigungen.

Beide Schlüssel bleiben nur auf deinem iPhone gespeichert.

## Walking-Pad (PitPat) – optional

Am Schreibtisch zählt die Uhr kaum Schritte, weil der Arm still bleibt. Puls übernimmt die Schritte
vom Walking-Pad automatisch: **PitPat → Apple Health → iPhone-Kurzbefehl → Puls**. Die genaue
Anleitung mit Kopier-Knöpfen steht in der App unter Einstellungen → **Walking-Pad (PitPat)**.

- Doppelt zählt nichts: Puls zieht ab, was die Uhr in derselben Zeit schon gezählt hat
  (aus Garmins 15-Minuten-Schritten), und addiert nur den Rest.
- Die Schritte erscheinen unter Heute → Dein Tag, zählen für Schrittziel, Benachrichtigungen,
  Statistiken und den Coach. Nach dem Laufen kommt auf Wunsch eine kurze Bestätigung.
- **Auf der Uhr selbst** und in Garmin Connect erscheinen sie nicht: Garmin übernimmt keine
  Schritte von anderen Apps in die Tagessumme.

## Gut zu wissen

- **Daten kommen über die Garmin-Connect-App in die Cloud.**
  - Die Uhr synchronisiert im Hintergrund.
  - Morgens hilft es, Garmin Connect kurz zu öffnen.
  - Danach die Puls-App öffnen: Sie lädt beim Öffnen automatisch neu.
- **Wann abgerufen wird:** beim Öffnen der App; mit Benachrichtigungen zusätzlich mittags,
  nachmittags, am frühen Abend und zur Schlafenszeit. Geplante Läufe ohne Anlass enden nach
  Sekunden, ohne Garmin zu fragen. GitHub startet geplante Läufe oft später oder lässt sie ganz aus.
- **Morgenwache** ([`wache.yml`](.github/workflows/wache.yml)): Findet ein Abruf zwischen 4 und 12:30 Uhr
  die Nacht noch nicht, prüft die Wache alle 3 Minuten bei Garmin (eine kleine Anfrage, nur mit
  gespeicherten Tokens). Sobald die Nacht da ist, startet sie den Abruf – dann kommt die
  Morgen-Benachrichtigung. Gestartet wird sie vom ersten Abruf am Morgen: von der App beim Öffnen oder
  von einem geplanten Lauf.
- **Schneller Start:** Die App-Dateien kommen aus dem Speicher des iPhones; die Daten wartet Puls
  höchstens 2,5 Sekunden aus dem Netz ab, sonst zeigt es erst den letzten Stand und lädt gleich nach.
- **Inoffizielle Schnittstelle:**
  - Garmin bietet Privatleuten keine offizielle API an.
  - Puls nutzt die Bibliothek [`garminconnect`](https://github.com/cyberjunky/python-garminconnect).
  - Ändert Garmin den Login, kann der Sync ein paar Tage ausfallen.
  - Neue Versionen der Bibliothek werden automatisch genutzt (`sync/requirements.txt`).
- **Fehlschläge:**
  - GitHub schickt dir eine E-Mail, wenn ein Sync fehlschlägt.
  - Die App zeigt dann oben einen Hinweis und weiter den letzten Stand.
- **Kein Medizinprodukt.** Bei Beschwerden zum Arzt.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| App zeigt „Noch keine Daten“ | Ist der erste Sync durchgelaufen (Actions-Tab, grüner Haken)? Ist Pages auf „GitHub Actions“ gestellt? |
| Sync rot: „DATA_PASSPHRASE fehlt“ | Secret anlegen (Schritt 2), mind. 10 Zeichen. |
| Sync rot: „Garmin-Login fehlgeschlagen“ | E-Mail und Passwort in den Secrets prüfen. Bei „zu viele Versuche“ 30 Min. warten. |
| Sync rot: „Bestätigungscode“ | Run workflow mit dem Code aus der Garmin-E-Mail (oder in der App unter Mehr). |
| App fragt plötzlich wieder nach dem Passwort | `DATA_PASSPHRASE` wurde geändert – neues Passwort eingeben. |
| Werte wirken falsch | Unter **Mehr** Max-Puls, Schlafbedarf und Weckzeit prüfen bzw. selbst setzen. |
| Alles neu laden | Run workflow mit Haken bei „Alle Tage neu von Garmin laden“. |

## Aufbau

```
app/          Web-App (ohne Build-Schritt, ohne externe Bibliotheken)
  engine.js   Auswertung: Recovery, Strain, Schlafbedarf, Puls-Alter, Coach-Kontext
  app.js      Oberfläche
  coach.js    KI-Coach (Claude, Werkzeuge, Chat-Verlauf)
  vendor/     Anthropic-SDK als Browser-Datei
  charts.js   Diagramme (SVG)
  crypto.js   Entschlüsselung (WebCrypto)
  demo.js     Beispieldaten
  sw.js       Offline-Fähigkeit
sync/         Garmin-Abruf (Python 3.12+)
  puls_sync.py    Ablauf: laden, abrufen, verdichten, verschlüsseln
  garmin_auth.py  Login inkl. Bestätigungscode und Token-Erneuerung
  garmin_data.py  Garmin-Antworten → kompaktes Tagesformat
  crypto_box.py   AES-256-GCM + PBKDF2
  notify.mjs      Benachrichtigungen (Web Push)
  walkpad.py      Walking-Pad-Schritte vom iPhone-Kurzbefehl (ohne Doppelzählung)
tests/        pytest (Sync), node --test (Auswertung, Coach, Benachrichtigungen), live_check.mjs
.github/workflows/sync.yml   Zeitplan, Sync, Benachrichtigungen, Veröffentlichung
.github/workflows/check.yml  Selbsttest der echten App
```

Lokal ausprobieren:

```bash
cd app && python3 -m http.server 8000   # http://localhost:8000 → „Demo-Daten ansehen“
pip install -r sync/requirements.txt pytest && python -m pytest tests
node --test tests/*.test.mjs
```

## Design

Zwei Darstellungen, umschaltbar unter **Einstellungen → Darstellung**:

- **Premium** (Standard): ruhiges, tiefschwarzes Design im Stil von Whoop und Apple. Flache Karten,
  drei Ringe, viel Schwarz. Bewegung gibt es nur in den Emblemen: Die Kugeln in den Ringen und beim
  Puls-Alter haben ein feines, sich drehendes Drahtgitter mit einer langsamen Lichtlinie, und um
  die Ringe dreht sich eine hauchdünne Skala wie eine Uhren-Lünette.
- **Sci-Fi**: volles HUD mit Systemstart, Partikel-Hintergrund, Hologramm-Rahmen, Messwerten neben
  den großen Ringen, EKG-Linie und Lichteffekten.

Alles pausiert im Hintergrund und außerhalb des Bildschirms. Bei „Bewegung reduzieren“ bleibt es still.

Schrift für Zahlen und Überschriften: Barlow Condensed (SIL Open Font License, siehe
[`app/fonts/OFL-Barlow.txt`](app/fonts/OFL-Barlow.txt)). Datenschilder in der Systemschrift
`ui-monospace`. Code der Effekte: [`app/hud.js`](app/hud.js).
