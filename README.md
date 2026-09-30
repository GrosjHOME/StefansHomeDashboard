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

Der Workflow `.github/workflows/id3-tibber.yml` ruft `scripts/id3_tibber_cloud.py`
auf: Ladezustand, Reichweite, Ziel-SoC, Stecker und Ladestatus des VW ID.3 über
die Tibber Data API lesen und in Kanal 3514838 schreiben. Die Zugangsdaten
liegen als GitHub Secrets; der rotierende Tibber-Refresh-Token wird nach jedem
Lauf verschlüsselt zurückgeschrieben. Das Dashboard zeigt in der Wallbox-Ansicht
„⚠ veraltet", wenn seit 60 min kein neuer Wert kam.

### Zuverlässig auslösen (ThingSpeak TimeControl)

Der `schedule` im Workflow (alle 15 min) wird von GitHub nur „best effort"
ausgeführt: am 29./30.09.2026 liefen von ~50 geplanten Läufen nur 3. Manuell
bzw. per API ausgelöste Läufe (`workflow_dispatch`) startet GitHub dagegen
sofort. Deshalb gibt eine ThingSpeak-TimeControl den Takt vor; der `schedule`
bleibt als Reserve. Beides ist kostenlos (öffentliches Repo; ThingSpeak-Gratis-
Lizenz, das Auslösen verbraucht keine Nachrichten).

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
