# Stefans Home Dashboard

Web-Dashboard für das Smart Home (rein clientseitig, kein Build). Zeigt die
Live-Daten aus den ThingSpeak-Kanälen für PV-Anlage, Wallbox, Holzschnitzel-
heizung und Boiler.

## Struktur

    dashboard/              -> Neues Dashboard: Single-Page-App mit Tab-Navigation
      index.html               (PV / Wallbox / Heizung / Boiler), Dark-Mode-
                               Umschalter, Charts direkt aus der ThingSpeak-API
                               (kein iframe), Auto-Refresh alle 60 s.
    thingspeak-dashboard/   -> Bisheriges Dashboard mit ThingSpeak-iframes
      index.html               (klassisches Frameset + Navigation, frame_*.html).
    index.html              -> Weiterleitung auf dashboard/index.html.

## ThingSpeak-Kanäle

    172430  PV-Anlage                (privat, Read-Key im Code)
    172228  Wallbox / HSH-Auslastung
    172428  Holzschnitzel-Heizung
    502977  Boiler

## Nutzung

`index.html` lokal im Browser öffnen (oder statisch hosten). Aktualisiert sich
automatisch alle 60 s. Der ThingSpeak-Read-Key liegt clientseitig im Code —
bei einer Veröffentlichung des Repos den Read-Key rotieren.

## Herkunft

Ausgegliedert aus dem Firmware-Repo `GrosjHOME/PV-Anlage` (das Haus-Dashboard
gehörte thematisch nicht ins PV-Firmware-Repo). Die Git-Historie des `HP/`-
Ordners wurde per `git subtree split` übernommen.
