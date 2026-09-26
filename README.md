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

## Nutzung

Einfach die Live-URL öffnen. Die Seite aktualisiert sich automatisch alle 60 s.
Alternativ statisch selbst hosten (der Datenabruf läuft über die öffentliche
ThingSpeak-API). Ein direktes Öffnen als lokale Datei (`file://`) funktioniert
auf Android-Browsern nicht mehr – dafür ist das Pages-Hosting da.

## Herkunft

Ausgegliedert aus dem Firmware-Repo `GrosjHOME/PV-Anlage` (das Haus-Dashboard
gehörte thematisch nicht ins PV-Firmware-Repo). Die Git-Historie des `HP/`-
Ordners wurde per `git subtree split` übernommen.
