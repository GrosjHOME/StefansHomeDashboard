#!/usr/bin/env python3
"""VW ID.3 Ladezustand via Tibber Data API -> ThingSpeak-Kanal 3514838 (E-Auto).

Cloud-Variante fuer GitHub Actions: zustandslos, nur Python-Standardbibliothek.
Zugangsdaten ausschliesslich aus Umgebungsvariablen (GitHub Secrets):
  TIBBER_CLIENT_ID, TIBBER_CLIENT_SECRET, TIBBER_REFRESH_TOKEN, TS_WRITE_KEY

Der Refresh-Token ist bei Tibber wiederverwendbar (kein Einmalgebrauch), daher
muss nichts zurueckgespeichert werden. Laeuft der Refresh mal auf 400/invalid_grant
(Token nach ~30 Tagen abgelaufen), einmalig lokal neu einloggen und das Secret
TIBBER_REFRESH_TOKEN aktualisieren.

ThingSpeak: field1=SoC%, field2=Reichweite km, field4=Ziel-SoC%,
field5=Ladestatus(0/1), field6=Stecker(0/1).
"""
import os
import sys
import json
import urllib.parse
import urllib.request
import urllib.error

TOKEN_URL = "https://thewall.tibber.com/connect/token"
BASE = "https://data-api.tibber.com/v1"


def env(k):
    return (os.environ.get(k) or "").strip()


CID = env("TIBBER_CLIENT_ID")
CSEC = env("TIBBER_CLIENT_SECRET")
RT = env("TIBBER_REFRESH_TOKEN")
TS_KEY = env("TS_WRITE_KEY")
missing = [k for k, v in [("TIBBER_CLIENT_ID", CID), ("TIBBER_CLIENT_SECRET", CSEC),
                          ("TIBBER_REFRESH_TOKEN", RT), ("TS_WRITE_KEY", TS_KEY)] if not v]
if missing:
    print("FEHLER: Secrets fehlen:", ", ".join(missing))
    sys.exit(1)

# Access-Token per Refresh holen
data = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": RT,
                               "client_id": CID, "client_secret": CSEC}).encode()
req = urllib.request.Request(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        access = json.loads(r.read().decode())["access_token"]
except urllib.error.HTTPError as e:
    print("FEHLER Token-Refresh:", e.code, e.read().decode()[:200])
    sys.exit(1)


def call(path):
    rq = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + access, "Accept": "application/json"})
    with urllib.request.urlopen(rq, timeout=30) as r:
        return json.loads(r.read().decode())


vehicle = None
homes = call("/homes")
for h in (homes.get("homes") if isinstance(homes, dict) else homes) or []:
    devs = call(f"/homes/{h['id']}/devices")
    for d in (devs.get("devices") if isinstance(devs, dict) else devs) or []:
        det = call(f"/homes/{h['id']}/devices/{d['id']}")
        caps = {c["id"]: c.get("value") for c in det.get("capabilities", [])}
        if "storage.stateOfCharge" in caps:
            vehicle = caps
            break
    if vehicle:
        break

if not vehicle:
    print("FEHLER: kein Fahrzeug mit SoC gefunden (ID.3 in Tibber verbunden?)")
    sys.exit(1)

soc = vehicle.get("storage.stateOfCharge")
target = vehicle.get("storage.targetStateOfCharge")
rng_m = vehicle.get("range.remaining")
rng_km = round(rng_m / 1000) if isinstance(rng_m, (int, float)) else None
charging = 1 if vehicle.get("charging.status") == "charging" else 0
connected = 1 if vehicle.get("connector.status") == "connected" else 0
print(f"SoC={soc}% Ziel={target}% {rng_km}km Laden={vehicle.get('charging.status')} Stecker={vehicle.get('connector.status')}")

fields = {"field1": soc, "field2": rng_km, "field4": target, "field5": charging, "field6": connected}
params = {"api_key": TS_KEY}
for k, v in fields.items():
    if v is not None:
        params[k] = v
with urllib.request.urlopen("https://api.thingspeak.com/update?" + urllib.parse.urlencode(params), timeout=30) as r:
    body = r.read().decode().strip()
print("ThingSpeak entry-id:", body)
sys.exit(0 if body != "0" else 1)
