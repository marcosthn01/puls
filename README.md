# Puls – dein Recovery-Coach für die Garmin Venu 4S

Eine private iPhone-App (Web-App für den Home-Bildschirm), die deine Garmin-Daten jeden Tag
automatisch abholt und so auswertet wie ein Whoop:

- **Recovery 0–100 %** (grün/gelb/rot) aus HRV, Ruhepuls, Schlaf und Atemfrequenz, verglichen
  mit *deinen* letzten 30 Tagen.
- **Strain 0–21** aus deinem Tagespuls, dazu ein **Zielbereich für heute** mit konkretem Training
  („noch 45 Min. in Zone 2, 131–145 bpm“).
- **Schlafbedarf und Schlafenszeit** für heute Nacht (Optimal / Gut / Minimum), mit Schlafschuld,
  Effizienz, Konstanz und Schlafphasen.
- **Warnsignale**, z. B. wenn Ruhepuls, HRV und Atemfrequenz gleichzeitig auffällig sind
  (typisch 1–2 Tage vor einer Erkältung).
- **Morgen-Check** (wie das Whoop-Journal): Alkohol, spätes Essen, Koffein, Stress, Sauna …
  - Puls rechnet aus, was das deine Recovery kostet oder bringt.
  - Beispiel: „Alkohol: −14 Prozentpunkte (52 % statt 66 %)“.
- **Körper-Check**: HRV, Ruhepuls, Atemfrequenz, SpO₂ (und Hauttemperatur, falls die Uhr sie
  liefert), jeweils im Vergleich zu deinem Normalbereich.
- **Trends**:
  - Wochenbericht mit Urteil (Optimal / Überlastet / Erholung nötig …)
  - Kalender mit Recovery-Farben, HRV-Normalbereich, Trainingslast (7 zu 28 Tage)
  - Aussagen wie „Wenn du vor 23:10 einschläfst, liegt deine Recovery im Schnitt bei 71 % statt 58 %“.

Bedienung wie bei Whoop:

- Oben die Wochenleiste mit farbigen Recovery-Punkten. Antippen oder links/rechts wischen wechselt
  den Tag.
- Die drei Ringe antippen öffnet die Details.
- Oben nach unten ziehen holt neue Daten.

Die Berechnungen stehen in der App unter **Mehr → So rechnet Puls** und im Code in
[`app/engine.js`](app/engine.js).

## So funktioniert's

```
Venu 4S ──► Garmin-Connect-App ──► Garmin-Cloud
                                       │  GitHub Actions holt die Daten
                                       │  (morgens alle 20 Min., tagsüber stündlich)
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

### 6. Optional: „Jetzt synchronisieren“-Knopf in der App

Damit holst du neue Daten sofort und kannst einen Garmin-Code direkt in der App eingeben.

1. Auf <https://github.com/settings/personal-access-tokens/new> einen Token anlegen:
   - Token name `Puls Sync`, Expiration z. B. 1 Jahr.
   - **Repository access → Only select repositories → `puls`**.
   - **Permissions → Repository permissions → Actions: Read and write**. Sonst nichts.
2. „Generate token“ tippen und den Token kopieren.
3. In Puls: **Mehr → Sync-Knopf einrichten** → Token einfügen → Speichern.

Der Token darf nur den Sync in diesem einen Repo starten.

## Gut zu wissen

- **Daten kommen über die Garmin-Connect-App in die Cloud.**
  - Die Uhr synchronisiert im Hintergrund.
  - Morgens hilft es, Garmin Connect kurz zu öffnen.
  - Danach die Puls-App öffnen: Sie lädt beim Öffnen automatisch neu.
- **GitHub startet geplante Läufe oft 5–30 Minuten später.** Mit dem Knopf (Schritt 6) geht es
  sofort.
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
  engine.js   Auswertung: Recovery, Strain, Schlafbedarf, Coach, Erkenntnisse
  app.js      Oberfläche
  charts.js   Diagramme (SVG)
  crypto.js   Entschlüsselung (WebCrypto)
  demo.js     Beispieldaten
  sw.js       Offline-Fähigkeit
sync/         Garmin-Abruf (Python 3.12+)
  puls_sync.py    Ablauf: laden, abrufen, verdichten, verschlüsseln
  garmin_auth.py  Login inkl. Bestätigungscode und Token-Erneuerung
  garmin_data.py  Garmin-Antworten → kompaktes Tagesformat
  crypto_box.py   AES-256-GCM + PBKDF2
tests/        pytest (Sync) und node --test (Auswertung, Verschlüsselung)
.github/workflows/sync.yml   Zeitplan, Sync, Veröffentlichung
```

Lokal ausprobieren:

```bash
cd app && python3 -m http.server 8000   # http://localhost:8000 → „Demo-Daten ansehen“
pip install -r sync/requirements.txt pytest && python -m pytest tests
node --test tests/*.test.mjs
```
