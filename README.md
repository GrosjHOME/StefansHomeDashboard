# 🏠 Stefans Home Dashboard

Live-Dashboard für die Haustechnik in Wittenbach (Lauperswil BE): PV-Anlage,
Wallbox mit E-Auto, Holzschnitzelheizung und Boiler – dazu eine Solarprognose
mit Geräte-Empfehlungen. Rein clientseitig, ohne Build: eine HTML-Datei, die die
Daten direkt aus ThingSpeak und Open-Meteo lädt.

**➜ [Dashboard öffnen](https://grosjhome.github.io/StefansHomeDashboard/)** ·
aktualisiert sich alle 60 s · als App installierbar (Android, Windows, iOS)

**Inhalt:** [Ansichten](#ansichten) · [Datenfluss](#datenfluss) ·
[Projektstruktur](#projektstruktur) · [ThingSpeak-Kanäle](#thingspeak-kanäle) ·
[Deployment](#deployment) · [Als App installieren](#als-app-installieren-pwa) · [Android-Widget](#android-widget-32) ·
[PV-Morgenprognose](#pv-morgenprognose-val-town) · [ID.3-Ladezustand (Tibber-Poller)](#id3-ladezustand-tibber-poller) ·
[Nutzung](#nutzung) · [Herkunft](#herkunft)

## Ansichten

| Tab | Was man sieht |
|---|---|
| ☀️&nbsp;**PV&#8209;Anlage** | Aktuelle Leistung gegen die Soll-Leistung aus der Prognose (Soll-Strich, Toleranzband ±10 %, Farbverlauf orange → grün) · Energie heute/gestern/Monat/Jahr · Leistungsverlauf (heute mit der Morgenprognose von 05:00, blau gestrichelt) · Energie nach Tagen (mit 3-Tage-Prognose und Min/Max desselben Kalendertags der Vorjahre), Monaten und Jahren (laufende Periode gegen Ø und Min/Max **aller** Jahre ab 2014) · PV-Arbeit je Jahr · Strom und Spannung je MPP-Tracker · Tracker-Strom mittags zur Verlust-Diagnose |
| 🚗&nbsp;**Wallbox** | Zwei Gruppen mit eigener Aktualität: **Wallbox** (Ladeleistung, PV-Ladevorgabe, Ladestrom-Begrenzung, Verbindung, geladene Menge) und **Auto** (VW ID.3 via Tibber: Ladezustand, Ziel, Reichweite, Stecker, Ladestatus) · Verläufe |
| 🔥&nbsp;**Heizung** | **Kessel & Schnitzel** (Kessel oben/mitte, Abgas, Schnitzel-Füllstand, Temperatur vor dem Bunker) mit Veraltet-Warnung nur in der Heizsaison (Okt–Apr, sonst „Sommerpause") · **HSH-Auslastung** · Verläufe |
| 💧&nbsp;**Boiler** | Temperaturen Mitte/Unten mit den Schaltschwellen der Steuerung (Laden ein < 45 °C, aus > 58 bzw. 63 °C) · Ladeleistung gegen Einschaltschwelle und PV · geladene Menge |
| 🗓️&nbsp;**Nutzung** | 7-Tage-Solarprognose (Open-Meteo, stündlich an den letzten 14 Tagen kalibriert, heute mit Nowcast) · Tageskarten mit Empfehlungen für Waschmaschine, Geschirrspüler, Tumbler, Auto und Boiler |

## Datenfluss

```text
Arduino-Steuerungen ──────────────────┐
(PV, Wallbox, Heizung, Boiler)        │
                                      ├──> ThingSpeak ──┐
VW ID.3 ──> Tibber ──> Val Town ──────┘                 │
            (Data API) (alle 15 min)                    ├──> Dashboard (GitHub Pages)
                                                        │
Open-Meteo (Einstrahlung, Wetter) ──────────────────────┘
```

## Projektstruktur

| Pfad | Zweck |
|---|---|
| `dashboard/index.html` | Das Dashboard: Single-Page-App mit Tabs, Dark-Mode, eigene Charts direkt aus der ThingSpeak-API (keine iframes), Auto-Refresh alle 60 s |
| `dashboard/manifest.webmanifest` | PWA-Manifest: App-Name, Icons, Farben, Startadresse |
| `dashboard/sw.js` | Service Worker: macht die Seite installierbar, startet auch ohne Netz |
| `dashboard/icons/` | App-Icons (SVG-Quellen + PNGs 192/512, randlos für Android, Apple-Icon) |
| `android-widget/` | Android-App mit 3×2-Widget (Live-Werte), gebaut von `.github/workflows/android-widget.yml` |
| `index.html` | Weiterleitung auf `dashboard/` |
| `thingspeak-dashboard/` | Früheres Dashboard mit ThingSpeak-iframes (Frameset) |
| `scripts/valtown_id3_tibber.ts` | ID.3-Poller für Val Town – **aktiv** |
| `scripts/valtown_pv_prognose/` | PV-Morgenprognose für Val Town (05:00, 15-min-Raster) |
| `scripts/tibber_token_neu.ps1` | Frischen Tibber-Refresh-Token erzeugen |
| `scripts/id3_tibber_cloud.py` | Früherer GitHub-Actions-Poller (Reserve) |
| `scripts/thingspeak_trigger_id3.m` | ThingSpeak-TimeControl-Auslöser (Alternative) |
| `.github/workflows/id3-tibber.yml` | GitHub-Workflow des früheren Pollers – **deaktiviert** |

## ThingSpeak-Kanäle

| Kanal | Inhalt | Hinweis |
|---|---|---|
| 172430 | PV-Anlage | Read-Key im Code |
| 172228 | Wallbox, HSH-Auslastung | |
| 172428 | Holzschnitzelheizung | sendet nur in der Heizsaison |
| 502977 | Boiler | |
| 3510388 | Tracker-Tagesmittel | 2. Account, Mittags-Mittelwert je MPP-Tracker |
| 3514838 | VW ID.3 (E-Auto) | Ladezustand via Tibber, siehe unten |

## Deployment

Ausgeliefert über **GitHub Pages** – Quelle: Branch `main`, Ordner `/ (root)`,
HTTPS erzwungen.

- Jeder Push nach `main` löst den eingebauten Pages-Build aus (*pages build and
  deployment* im Actions-Tab); nach 1–2 Minuten ist die neue Version live. Eine
  eigene Workflow-Datei braucht es dafür nicht.
- Live-URL: <https://grosjhome.github.io/StefansHomeDashboard/> – die Root-`index.html`
  leitet auf `dashboard/` weiter.

### Als App installieren (PWA)

Das Dashboard ist eine **Progressive Web App**: einmal installiert, öffnet es wie
eine eigene App – mit Icon, eigenem Fenster und ohne Browserleiste. Updates kommen
automatisch mit jedem Push nach `main`, kein Store nötig.

| Gerät | So geht's |
|---|---|
| **Android** | Live-URL in **Chrome** öffnen → Menü ⋮ → **App installieren** (bzw. *Zum Startbildschirm hinzufügen* → *Installieren*). Die App „Zuhause" erscheint in der App-Liste. |
| **Windows** | Live-URL in **Edge** öffnen → Menü … → **Apps** → **Diese Website als App installieren** (in Chrome: Installieren-Symbol in der Adressleiste). Danach im Startmenü und anheftbar an die Taskleiste. |
| **iPhone/iPad** | Live-URL in **Safari** öffnen → Teilen → **Zum Home-Bildschirm**. |

Technik: `manifest.webmanifest` (Name „Grosjeans Zuhause", Kurzname „Zuhause",
Modus *standalone*) und `sw.js`. Der Service Worker lädt immer **zuerst aus dem
Netz** – Änderungen sind also sofort da; der Zwischenspeicher dient nur als
Rückfall ohne Verbindung (die Seite startet dann, die Live-Daten fehlen).
Daten-APIs anderer Server (ThingSpeak, Open-Meteo) fasst er nicht an. Bei
Änderungen an `sw.js` die Cache-Version (`zuhause-v1`) hochzählen.

**Updates kommen von selbst:** Die Live-Daten laufen alle 60 s. Eine neue
Dashboard-Version lädt die App selbst – beim **Zurückwechseln** in die App (nach
mindestens 5 min im Hintergrund) und **alle 6 h**, falls sie dauernd sichtbar offen
ist. Dazu vergleicht sie den Fingerabdruck der Seite (ETag von GitHub Pages) mit
dem beim Laden; nur wenn er sich geändert hat, lädt sie neu (gleicher Tab). Nach
einem Merge dauert es durch Pages-Build und Browser-Cache bis zu ~15 min.
App-Name und Icon aktualisieren Android/Windows selbst (kann bis zu einem Tag
dauern); auf dem iPhone muss die App dafür neu zum Home-Bildschirm hinzugefügt
werden.

> [!NOTE]
> Pages verlangt bei diesem Konto ein **öffentliches** Repo. Im Code liegen nur
> ThingSpeak-**Lese**-Keys – keine Schreib-Keys, keine Passwörter.

## Android-Widget (3×2)

Eine PWA kann unter Android kein Widget mit Live-Daten liefern. Dafür gibt es die
kleine App in `android-widget/`: Sie besteht nur aus einem **3×2-Widget** für den
Startbildschirm und zeigt

| Zeile | Quelle |
|---|---|
| **Geräte jetzt einschalten** (gross, zuoberst): „2 von 3" + freie Leistung | gleiche Rechnung wie „Jetzt: n von 3 gleichzeitig" im Tab Nutzung (Open-Meteo-Prognose, 14-Tage-Kalibrierung, Nowcast, Boiler/Auto mit Vorrang) |
| ☀️ PV-Leistung | Kanal 172430 |
| 💧 Boiler (Ladeleistung, „Wartet auf PV", „Aus") | Kanal 502977 |
| 🚗 Auto / Wallbox (Ladeleistung, „Lädt nicht", „Getrennt") | Kanal 172228 |
| 🔋 ID.3 Ladezustand → Soll-Ladezustand · Reichweite | Kanal 3514838 |

**Aktualisierung:** von selbst alle **15 min** (das kürzeste, was Android im
Hintergrund erlaubt, und nur mit Netz). **Antippen** des Widgets lädt sofort neu.
Rechts oben zeigt es die Uhrzeit des Stands. Das Symbol **↗** öffnet das Dashboard.

**Installation:**

1. Auf dem Handy die APK laden:
   <https://github.com/GrosjHOME/StefansHomeDashboard/releases/download/widget-latest/Zuhause-Widget.apk>
2. Öffnen und Installation erlauben. Android fragt einmalig, ob der Browser
   bzw. Dateimanager *Apps aus unbekannten Quellen* installieren darf.
   Play Protect warnt eventuell vor einer unbekannten App: *Trotzdem installieren*.
3. Die App **„Zuhause Widget"** einmal öffnen. Dabei wird die Hintergrund-Aktualisierung
   eingeplant.
4. Auf dem Startbildschirm lange drücken, dann *Widgets* → **Zuhause Widget** → auf
   3×2 ziehen. Die Grösse lässt sich danach anpassen.
5. Ist der **Datensparmodus** an, sperrt Android der App im Hintergrund das Internet.
   Das Widget zeigt dann „Datensparmodus" statt Werten. Abhilfe: In der App
   *App-Einstellungen öffnen* → *Mobile Daten* → **Uneingeschränkte Datennutzung**
   einschalten.

**Fehlersuche:** In der App zeigt **Jetzt testen**, ob der Abruf grundsätzlich
klappt. Darunter stehen die letzte Hintergrund-Aktualisierung und mögliche
Einschränkungen durch Datensparmodus oder Akku.

**Updates:** Jeder Push mit Änderungen in `android-widget/` baut über den Workflow
`.github/workflows/android-widget.yml` eine neue APK und ersetzt das Release
`widget-latest`. Die neue APK einfach über die alte installieren; das Widget
bleibt dabei erhalten.

Technik: Kotlin, `AppWidgetProvider` + `RemoteViews`, WorkManager für den
15-min-Takt, keine weiteren Bibliotheken. Ab Android 10. Hell/Dunkel folgt dem
System.

> [!NOTE]
> Der **Signatur-Schlüssel** `android-widget/keystore/zuhause-widget.jks` ist
> absichtlich eingecheckt. Das Passwort steht in `app/build.gradle.kts`. So
> entsteht jede APK mit derselben Signatur, und Updates lassen sich über die
> installierte Version installieren. Für eine selbst installierte Hobby-App, die
> nur öffentliche Daten zeigt, ist das in Ordnung. Für den Play Store taugt der
> Schlüssel nicht. Der Workflow erzeugt ihn beim ersten Build selbst, falls er
> fehlt.

## PV-Morgenprognose (Val Town)

Jeden Morgen um **05:00** rechnet ein Val auf Val Town die PV-Leistung für den
ganzen Tag in **15-Minuten-Schritten** und friert sie ein. Das Dashboard zeigt sie
in der Grafik **Leistung** (Ansicht *Heute*) als **blau gestrichelte Linie** und
nimmt sie als **Soll** am Balken *Aktuelle Leistung*. So bleibt den ganzen Tag
sichtbar, was am Morgen erwartet wurde. Die Live-Prognose ändert sich dagegen mit
jedem Wetter-Update. Fehlt die Morgenprognose, rechnet der Balken wie bisher live.

| | |
|---|---|
| **Ort** | val.town, Konto `steffgrosjean`, Val **PV-Prognose** |
| **Dateien** | `prognose.ts` (Trigger **HTTP**: Rechnung + Abruf) und `morgens.ts` (Trigger **Cron** `0 3-7 * * *`) |
| **Quelltext** | `scripts/valtown_pv_prognose/` – hier ändern, dann in den Val kopieren |
| **Speicher** | Blob `pv_prognose_YYYY-MM-DD` je Tag (bleibt erhalten, `?datum=…` liefert ältere Tage) |
| **Web-Adresse** | <https://steffgrosjean--23dbba40c0d911f1a70c1607ee4eb77e.web.val.run/> – im Dashboard `PV.PROGNOSE_URL` |

**Rechnung:**
- **Einstrahlung:** Open-Meteo liefert die Einstrahlung auf die Modulfläche (60°,
  Süd) im 15-min-Raster.
- **Umrechnung in kW:** Je Tagesstunde gilt der Median von *Ist-Leistung ÷
  Einstrahlung* der letzten 15 Tage, zwischen den Stunden linear interpoliert.
  Darin stecken die Verschattung im Tal und die Begrenzung der Wechselrichter.
- **Zeitzuordnung:** Open-Meteo-Strahlung ist das Mittel des *vorangehenden*
  Intervalls (Stempel 13:15 = 13:00–13:15), ThingSpeak-Stundenmittel tragen den
  Stempel des Intervall*beginns*. Die Rechnung ordnet beide passend zu.

**Zeitplan:** Der Cron läuft stündlich von 03 bis 07 Uhr UTC. Er rechnet beim
ersten Lauf ab 05:00 Ortszeit, also im Sommer wie im Winter um 05:00. Die
weiteren Läufe holen die Rechnung nur nach, falls ein Lauf gescheitert ist. Fragt
das Dashboard nach 05:00 und es gibt noch keine Prognose, rechnet `prognose.ts`
sofort. Die Legende zeigt dann die tatsächliche Uhrzeit.

<details>
<summary><b>Einrichtung Schritt für Schritt</b></summary>

1. In Val Town **New Val** anlegen, Name **PV-Prognose**.
2. Datei **`prognose.ts`** anlegen, den Inhalt von
   `scripts/valtown_pv_prognose/prognose.ts` einfügen und als Trigger **HTTP**
   wählen. Den Vorlagen-Code vorher ganz ersetzen.
3. Datei **`morgens.ts`** anlegen, den Inhalt von
   `scripts/valtown_pv_prognose/morgens.ts` einfügen und als Trigger **Cron** mit
   dem Ausdruck `0 3-7 * * *` wählen.
4. Umgebungsvariablen braucht es keine. Der PV-Lese-Key ist derselbe öffentliche
   wie im Dashboard.
5. Test: die Web-Adresse von `prognose.ts` im Browser öffnen. Nach 05:00 kommt
   JSON mit `datum`, `tagesKwh` und 96 `punkte`.
6. Diese Adresse in `dashboard/index.html` bei `PV.PROGNOSE_URL` eintragen.

Der Val ist öffentlich (Gratis-Plan). Die Web-Adresse liefert nur die Prognose,
also öffentliche Daten. Mehr als eine Rechnung pro Tag kann niemand auslösen.

</details>

## ID.3-Ladezustand (Tibber-Poller)

Ein Poller liest die Daten des VW ID.3 über die Tibber Data API und schreibt sie
in Kanal 3514838. Das Dashboard zeigt in der Wallbox-Ansicht „⚠ veraltet", wenn
seit 60 min kein neuer Wert kam.

| Feld | Inhalt |
|---|---|
| field1 | Ladezustand (SoC) in % |
| field2 | Reichweite in km |
| field4 | Ziel-Ladezustand in % |
| field5 | Ladestatus (1 = lädt) |
| field6 | Stecker (1 = verbunden) |

> [!IMPORTANT]
> Tibber-Refresh-Tokens sind **Einmal-Tokens**: jeder Refresh liefert einen neuen,
> der alte stirbt. Der Poller sichert deshalb nach jedem Lauf den neuen Token.

### Auf Val Town (aktiv seit 03.10.2026)

GitHub Actions führt Zeitpläne nur „best effort" aus – gemessen Okt. 2026: statt
alle 15 min nur etwa **alle 5 h**. Deshalb läuft der Poller auf
[Val Town](https://www.val.town) (Gratis-Plan, Cron ab 15 min). Seit der
Umstellung kommt zuverlässig alle 15 min ein Wert (96 statt ~5 pro Tag).

| | |
|---|---|
| **Ort** | val.town, Konto `steffgrosjean`, Val **VW**, Datei `main.ts` |
| **Takt** | Cron-Trigger alle 15 Minuten |
| **Quelltext** | `scripts/valtown_id3_tibber.ts` – das Repo ist die Vorlage: hier ändern, dann in den Val kopieren |
| **Token-Speicher** | val-eigener Blob-Speicher, Schlüssel `tibber_refresh_token` |
| **Neuer Token** | `scripts/tibber_token_neu.ps1` |

**Kontrolle im Betrieb**

- **Dashboard** → Wallbox → Gruppe „🚗 Auto (ID.3, via Tibber)": „Stand vor …"
  unter 15 min; nach 60 min ohne neuen Wert rot „⚠ veraltet".
- **Val Town**: jeder Lauf mit Log in der Run-Historie des Vals.
- **ThingSpeak** Kanal 3514838: ein Eintrag alle 15 min.

<details>
<summary><b>Was ein Lauf macht</b></summary>

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
lebt die Token-Kette im Blob (Val Town kann Umgebungsvariablen vom Code aus nicht
ändern).

</details>

<details>
<summary><b>Öffentlich oder privat?</b></summary>

Im Gratis-Plan kann ein Val nur **Public** sein. Sichtbar ist damit nur der
**Code** – der steht ohnehin öffentlich auf GitHub. **Privat bleiben**:

- die **Umgebungsvariablen** – andere sehen nur ihre Namen, nicht die Werte,
- der **Blob-Speicher** – er gehört zu diesem Val; wer den Code kopiert, hat einen
  eigenen, leeren Speicher,
- die **Auslösung** – ein Cron-Val hat keine Web-Adresse, von aussen kann ihn
  niemand starten.

</details>

<details>
<summary><b>Einrichtung Schritt für Schritt</b></summary>

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

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\tibber_token_neu.ps1
   ```

   - Client-ID und Client-Secret eingeben → der Browser öffnet die
     Tibber-Anmeldung → anmelden und zustimmen.
   - Der Browser landet auf „localhost – Seite nicht erreichbar". **Das ist
     richtig.** Die **komplette Adresse** aus der Adresszeile kopieren
     (`http://localhost:8123/callback?code=…&state=…`) und **im Skript**
     einfügen – nicht in Val Town.
   - ⚠️ **Der Wert hinter `code=` ist nicht der Refresh-Token**, nur ein
     Einmal-Code (wenige Minuten gültig). Ihn direkt in Val Town einzutragen führt
     zu `invalid_grant`. Erst das Skript tauscht ihn bei Tibber gegen den
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
   *Disable workflow*), damit nur ein Poller läuft. ✅ *Erledigt am 03.10.2026.*

</details>

<details>
<summary><b>Fehlerbilder und Neustart</b></summary>

| Im Log | Ursache | Abhilfe |
|---|---|---|
| `Token-Refresh HTTP 400 … invalid_grant`, danach „Kein gültiger Refresh-Token mehr" | Token-Kette gerissen (Token verbraucht oder nach längerer Pause abgelaufen) – oder beim Einrichten der `code=`-Wert statt des Tokens eingetragen | Schritt 6 wiederholen, neuen Token als `TIBBER_REFRESH_TOKEN` eintragen, *Run*. Den Blob muss man nicht löschen: der Val fällt automatisch auf die Umgebungsvariable zurück. |
| `invalid_client` | Client-ID oder -Secret falsch | Werte in Schritt 5 prüfen |
| `Umgebungsvariable … fehlt` | Variable fehlt oder ist anders geschrieben | Namen exakt wie in der Tabelle |
| `ThingSpeak hat den Eintrag abgelehnt (… "0")` | Write-Key falsch – oder zwei Läufe innerhalb von 15 s (Gratis-Limit von ThingSpeak, z. B. zweimal kurz nacheinander *Run*) | Key prüfen bzw. kurz warten |
| `Kein Fahrzeug mit Ladezustand gefunden` | ID.3 in der Tibber-App nicht (mehr) verbunden | in der Tibber-App neu verbinden („Volkswagen") |
| „Länge N Zeichen" auffällig kurz | Token beim Kopieren abgeschnitten | neu erzeugen und einfügen |

Jeder Lauf erneuert den Token – solange der Cron läuft, bleibt die Kette lebendig.
Pausiert der Val länger, kann der letzte Token ablaufen; dann hilft der Neustart
über Schritt 6.

</details>

### Reserve: GitHub-Workflow (deaktiviert)

Der frühere Weg: Workflow `.github/workflows/id3-tibber.yml` mit
`scripts/id3_tibber_cloud.py`, Token-Rotation über das GitHub-Secret
`TIBBER_REFRESH_TOKEN`. **Seit 03.10.2026 deaktiviert**, weil GitHub den
`schedule` nur etwa alle 5 h ausführt.

> [!WARNING]
> Nur reaktivieren, wenn Val Town ausfällt: dann im GitHub-Secret
> `TIBBER_REFRESH_TOKEN` einen frischen Token eintragen (die alte Kette ist tot)
> und den Val-Cron pausieren, damit nicht beide schreiben.

<details>
<summary><b>Reserve im 15-min-Takt: per ThingSpeak TimeControl auslösen</b></summary>

Per API ausgelöste Läufe (`workflow_dispatch`) startet GitHub sofort – eine
ThingSpeak-TimeControl kann so den Takt vorgeben (kostenlos):

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

Mit der Gratis-Lizenz deaktiviert ThingSpeak wiederkehrende TimeControls, wenn
man sich 60 Tage nicht eingeloggt hat – spätestens dann zeigt das Dashboard
„⚠ veraltet".

</details>

## Nutzung

Einfach die [Live-URL](https://grosjhome.github.io/StefansHomeDashboard/) öffnen –
die Seite aktualisiert sich alle 60 s. Alternativ statisch selbst hosten (der
Datenabruf läuft über die öffentliche ThingSpeak-API). Ein direktes Öffnen als
lokale Datei (`file://`) funktioniert auf Android-Browsern nicht mehr – dafür ist
das Pages-Hosting da.

## Herkunft

Ausgegliedert aus dem Firmware-Repo `GrosjHOME/PV-Anlage` (das Haus-Dashboard
gehörte thematisch nicht ins PV-Firmware-Repo). Die Git-Historie des `HP/`-Ordners
wurde per `git subtree split` übernommen.
