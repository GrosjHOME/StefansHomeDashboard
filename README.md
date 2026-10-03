# Stefans Home Dashboard

Web-Dashboard für das Smart Home (rein clientseitig, kein Build). Zeigt die
Live-Daten aus den ThingSpeak-Kanälen für PV-Anlage, Wallbox, Holzschnitzel-
heizung und Boiler.

**Live:** https://grosjhome.github.io/StefansHomeDashboard/

## Struktur

    dashboard/              -> Dashboard: Single-Page-App mit Tab-Navigation
      index.html               (PV / Wallbox / Heizung / Boiler), Dark-Mode-
                               Umschalter, Charts direkt aus der ThingSpeak-API
                               (kein iframe), zwei-Achsen-Support, Auto-Refresh
                               alle 60 s.
    thingspeak-dashboard/   -> Bisheriges Dashboard mit ThingSpeak-iframes
      index.html               (klassisches Frameset + Navigation, frame_*.html).
    index.html              -> Weiterleitung auf dashboard/index.html.
    scripts/                -> ID.3-Poller (Tibber -> ThingSpeak), siehe unten:
      valtown_id3_tibber.ts    Poller fuer Val Town (aktiv)
      tibber_token_neu.ps1     frischen Tibber-Refresh-Token erzeugen
      id3_tibber_cloud.py      frueherer GitHub-Actions-Poller (Reserve)
      thingspeak_trigger_id3.m ThingSpeak-TimeControl-Ausloeser (Alternative)
    .github/workflows/
      id3-tibber.yml        -> GitHub-Workflow des frueheren Pollers (deaktiviert)

## ThingSpeak-Kanäle

    172430  PV-Anlage                (Read-Key im Code)
    172228  Wallbox / HSH-Auslastung
    172428  Holzschnitzel-Heizung
    502977  Boiler
    3510388 Tracker-Tagesmittel      (2. Account, Mittags-Mittelwert je MPP-Tracker)
    3514838 ID.3 (E-Auto)            (Ladezustand via Tibber, siehe unten)

## Deployment (GitHub Pages)

Die Seite wird über **GitHub Pages** ausgeliefert – Quelle: Branch `main`,
Ordner `/ (root)`, HTTPS erzwungen.

- Jeder Push nach `main` löst automatisch den eingebauten Pages-Build aus
  (`pages build and deployment`, sichtbar im Actions-Tab). Nach 1–2 Minuten ist
  die neue Version live. **Keine eigene Workflow-Datei** im Repo – der einfache
  Branch-Deploy genügt für die statische Seite.
- Live-URL: https://grosjhome.github.io/StefansHomeDashboard/
  (die Root-`index.html` leitet auf `dashboard/` weiter).
- Am Handy: URL in Chrome öffnen → „Zum Startbildschirm hinzufügen", dann
  verhält sich das Dashboard wie eine App-Kachel.

> Hinweis: Pages benötigt bei diesem Konto ein **öffentliches** Repo. Das Repo
> ist daher öffentlich; im Code liegen nur ThingSpeak-**Lese**-Keys (keine
> Schreib-Keys, keine Passwörter).

## ID.3-Ladezustand (Tibber-Poller)

Ein Poller liest Ladezustand, Reichweite, Ziel-SoC, Stecker und Ladestatus des
VW ID.3 über die Tibber Data API und schreibt sie in Kanal 3514838 (field1 SoC %,
field2 Reichweite km, field4 Ziel-SoC %, field5 lädt 0/1, field6 Stecker 0/1).
Das Dashboard zeigt in der Wallbox-Ansicht „⚠ veraltet", wenn seit 60 min kein
neuer Wert kam.

Tibber-Refresh-Tokens sind **Einmal-Tokens**: jeder Refresh liefert einen neuen,
der alte stirbt. Der Poller muss den jeweils neuen Token also selbst sichern.

### Auf Val Town (aktiv seit 03.10.2026)

GitHub Actions führt Zeitpläne nur „best effort" aus – gemessen Okt. 2026: statt
alle 15 min nur etwa **alle 5 h**, egal zu welchen Minuten. Deshalb läuft der
Poller auf [Val Town](https://www.val.town) (Gratis-Plan: Cron ab 15 min).

| | |
|---|---|
| Ort | val.town, Konto `steffgrosjean`, Val **VW**, Datei `main.ts` |
| Takt | Cron-Trigger alle 15 Minuten |
| Quelltext | `scripts/valtown_id3_tibber.ts` – das Repo ist die Vorlage: Änderungen hier machen und dann in den Val kopieren |
| Token-Speicher | val-eigener Blob-Speicher, Schlüssel `tibber_refresh_token` |
| Neuer Token | `scripts/tibber_token_neu.ps1` |

#### Was ein Lauf macht

1. **Refresh-Token wählen:** zuerst den im Blob gespeicherten; wird der abgelehnt,
   den aus der Umgebungsvariable `TIBBER_REFRESH_TOKEN`.
2. **Bei Tibber tauschen** (`thewall.tibber.com/connect/token`) gegen einen
   Access-Token. Dabei liefert Tibber einen **neuen** Refresh-Token – der wird
   **sofort** im Blob gesichert (3 Versuche), bevor irgendetwas anderes passiert.
3. **Fahrzeug suchen:** `/homes` → `/devices` → das Gerät mit
   `storage.stateOfCharge`.
4. **Nach ThingSpeak schreiben** (Kanal 3514838, Felder siehe oben).
5. **Log:** „Versuche … Token, Länge N Zeichen" → „OK mit …" →
   „SoC=…% Ziel=…% … km … → ThingSpeak-Eintrag N". Der Token selbst wird nie
   ausgegeben, nur seine Herkunft und Länge.

`TIBBER_REFRESH_TOKEN` dient damit nur dem **Start bzw. Neustart**: Im Betrieb
lebt die Token-Kette im Blob, die Umgebungsvariable wird nicht mehr gebraucht
(Val Town kann Umgebungsvariablen vom Code aus nicht ändern).

#### Öffentlich oder privat?

Im Gratis-Plan kann ein Val nur **Public** sein. Sichtbar ist damit nur der
**Code** – der steht ohnehin öffentlich auf GitHub. **Privat bleiben** die
Umgebungsvariablen (andere sehen nur ihre Namen, nicht die Werte), der
Blob-Speicher (gehört zu diesem Val/Konto; wer den Code kopiert, hat einen
eigenen, leeren Speicher), und auslösen kann den Val von aussen niemand – ein
Cron-Val hat keine Web-Adresse.

#### Einrichtung Schritt für Schritt

1. **Konto** auf val.town anlegen (gratis).
2. **New val** → Name z. B. `VW` → Sichtbarkeit **Public** (*Private*/*Unlisted*
   gibt es im Gratis-Plan nicht) → *Create val*.
3. **Code:** `main.ts` öffnen und den **gesamten Inhalt ersetzen** durch
   `scripts/valtown_id3_tibber.ts`. Den Vorlagen-Code nicht stehen lassen – sonst
   gibt es zwei `export default` und der Val startet nicht. → *Save*.
4. **Trigger:** oben rechts *+ Add trigger* → **Cron**. „Cron" ist in der neuen
   Oberfläche ein Trigger, kein Dateityp. Er steht danach auf **Paused** – erst
   nach dem Test aktivieren (Schritt 8).
5. **Umgebungsvariablen** (Seitenleiste → *Environment variables*), Namen exakt so:

   | Name | Wert / Herkunft |
   |---|---|
   | `TIBBER_CLIENT_ID` | Client-ID der Tibber-App (Tibber-Developer-Zugang) |
   | `TIBBER_CLIENT_SECRET` | Client-Secret der Tibber-App |
   | `TS_WRITE_KEY` | ThingSpeak → Kanal 3514838 → *API Keys* → *Write API Key* |
   | `TIBBER_REFRESH_TOKEN` | frisch mit dem Skript erzeugt (Schritt 6) |

6. **Refresh-Token erzeugen** – in einem eigenen Terminalfenster, da das Skript
   Eingaben verlangt:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\tibber_token_neu.ps1
   ```
   - Client-ID und Client-Secret eingeben → der Browser öffnet die
     Tibber-Anmeldung → anmelden und zustimmen.
   - Der Browser landet auf „localhost – Seite nicht erreichbar". **Das ist
     richtig.** Die **komplette Adresse** aus der Adresszeile kopieren
     (`http://localhost:8123/callback?code=…&state=…`) und **im Skript**
     einfügen – nicht in Val Town.
   - **Achtung:** Der Wert hinter `code=` ist **nicht** der Refresh-Token, nur
     ein Einmal-Code (wenige Minuten gültig). Ihn direkt in Val Town einzutragen
     führt zu `invalid_grant`. Erst das Skript tauscht ihn bei Tibber gegen den
     Refresh-Token.
   - Meldung „OK: neuer Refresh-Token ist in der Zwischenablage" → den Inhalt der
     Zwischenablage als `TIBBER_REFRESH_TOKEN` einfügen (nur einfügen, nichts
     davor oder danach). Der Token erscheint nie auf dem Bildschirm und wird
     nirgends gespeichert.
   - GitHub-Secrets lassen sich nicht auslesen – deshalb ein neuer Token statt
     des bisherigen.
7. **Test:** *Run* → im Log muss „SoC=…% … → ThingSpeak-Eintrag …" stehen, und in
   ThingSpeak Kanal 3514838 erscheint ein neuer Eintrag.
8. **Cron aktivieren:** in der CRON-Zeile das Regler-Symbol → **15 Minuten**
   (`*/15 * * * *`; Val-Town-Crons rechnen in UTC, für einen 15-min-Takt egal) →
   *Paused* aufheben.
9. **GitHub-Workflow deaktivieren** (Actions → *ID.3 SoC (Tibber) → ThingSpeak* →
   *Disable workflow*), damit nur ein Poller läuft. *Erledigt am 03.10.2026.*

#### Kontrolle im Betrieb

- **Dashboard** → Wallbox → Gruppe „🚗 Auto (ID.3, via Tibber)": „Stand vor …"
  unter 15 min. Nach 60 min ohne neuen Wert rot „⚠ veraltet".
- **Val Town:** jeder Lauf mit Log in der Run-Historie des Vals.
- **ThingSpeak** Kanal 3514838: ein Eintrag alle 15 min.

#### Fehlerbilder

| Im Log | Ursache | Abhilfe |
|---|---|---|
| `Token-Refresh HTTP 400 … invalid_grant`, danach „Kein gültiger Refresh-Token mehr" | Token-Kette gerissen (Token verbraucht oder nach längerer Pause abgelaufen) – oder beim Einrichten der `code=`-Wert statt des Tokens eingetragen | Schritt 6 wiederholen, neuen Token als `TIBBER_REFRESH_TOKEN` eintragen, *Run*. Den Blob muss man nicht löschen: der Val fällt automatisch auf die Umgebungsvariable zurück. |
| `invalid_client` | Client-ID oder -Secret falsch | Werte in Schritt 5 prüfen |
| `Umgebungsvariable … fehlt` | Variable fehlt oder ist anders geschrieben | Namen exakt wie in der Tabelle |
| `ThingSpeak hat den Eintrag abgelehnt (… "0")` | Write-Key falsch – oder zwei Läufe innerhalb von 15 s (Gratis-Limit von ThingSpeak, z. B. zweimal kurz nacheinander *Run*) | Key prüfen bzw. kurz warten |
| `Kein Fahrzeug mit Ladezustand gefunden` | ID.3 in der Tibber-App nicht (mehr) verbunden | in der Tibber-App neu verbinden („Volkswagen") |
| „Länge N Zeichen" auffällig kurz | Token beim Kopieren abgeschnitten | neu erzeugen und einfügen |

Jeder Lauf erneuert den Token, solange der Cron läuft, bleibt die Kette also
lebendig. Pausiert der Val länger, kann der letzte Token ablaufen – dann hilft
der Neustart über Schritt 6.

### Alternative: GitHub-Workflow (deaktiviert, Reserve)

Der frühere Weg: Workflow `.github/workflows/id3-tibber.yml` mit
`scripts/id3_tibber_cloud.py`, Token-Rotation über das GitHub-Secret
`TIBBER_REFRESH_TOKEN`. **Seit 03.10.2026 deaktiviert**, weil GitHub den
`schedule` nur etwa alle 5 h ausführt. Nur reaktivieren, wenn Val Town ausfällt:
dann im GitHub-Secret `TIBBER_REFRESH_TOKEN` einen frischen Token eintragen (die
alte Kette ist tot) und den Val-Cron pausieren, damit nicht beide schreiben.

Damit der Workflow dann trotzdem im 15-min-Takt läuft, kann ihn eine
ThingSpeak-TimeControl per `workflow_dispatch` auslösen – solche Läufe startet
GitHub sofort (kostenlos):

1. **Token erstellen:** GitHub → Settings → Developer settings → Personal access
   tokens → *Fine-grained tokens* → *Generate new token*.
   - Repository access: *Only select repositories* → `StefansHomeDashboard`
   - Permissions → Repository → **Actions: Read and write** (sonst nichts)
   - Ablaufdatum wählen und im Kalender notieren (danach neuen Token eintragen).
2. **MATLAB Analysis anlegen:** ThingSpeak → Apps → *MATLAB Analysis* → *New* →
   *Custom (no starter code)*. Name z. B. „ID.3-Poller auslösen". Inhalt von
   `scripts/thingspeak_trigger_id3.m` einfügen und den Platzhalter
   `github_pat_HIER_EINTRAGEN` durch den Token ersetzen. **Den echten Token nie
   ins Repo committen – es ist öffentlich.** *Save and Run* → unten muss
   „ID.3-Workflow ausgelöst" stehen, und im Actions-Tab erscheint ein Lauf mit
   Ereignis *workflow_dispatch*.
3. **TimeControl anlegen:** ThingSpeak → Apps → *TimeControl* → *New
   TimeControl*: Frequency *Recurring*, Recurrence *Minute*, alle **15** Minuten,
   Action *MATLAB Analysis* → die Analyse aus Schritt 2. Fuzzy Time aus.

**Wichtig:** Mit der Gratis-Lizenz deaktiviert ThingSpeak wiederkehrende
TimeControls, wenn man sich 60 Tage nicht eingeloggt hat – spätestens dann
zeigt das Dashboard „⚠ veraltet".

## Nutzung

Einfach die Live-URL öffnen. Die Seite aktualisiert sich automatisch alle 60 s.
Alternativ statisch selbst hosten (der Datenabruf läuft über die öffentliche
ThingSpeak-API). Ein direktes Öffnen als lokale Datei (`file://`) funktioniert
auf Android-Browsern nicht mehr – dafür ist das Pages-Hosting da.

## Herkunft

Ausgegliedert aus dem Firmware-Repo `GrosjHOME/PV-Anlage` (das Haus-Dashboard
gehörte thematisch nicht ins PV-Firmware-Repo). Die Git-Historie des `HP/`-
Ordners wurde per `git subtree split` übernommen.
