#!/usr/bin/env python3
"""VW ID.3 Ladezustand via Tibber Data API -> ThingSpeak-Kanal 3514838 (E-Auto).

Cloud-Variante fuer GitHub Actions. WICHTIG: Tibber-Refresh-Tokens rotieren
(Einmalgebrauch) - jeder Refresh liefert einen NEUEN Token, der alte stirbt.
Darum speichert dieser Poller den neuen Refresh-Token nach dem Refresh sofort
zurueck ins GitHub-Secret TIBBER_REFRESH_TOKEN (verschluesselt, via GH_PAT).

Umgebungsvariablen (GitHub Secrets):
  TIBBER_CLIENT_ID, TIBBER_CLIENT_SECRET, TIBBER_REFRESH_TOKEN, TS_WRITE_KEY
  GH_PAT  - Fine-grained PAT mit 'Secrets: write' auf dieses Repo
  GH_REPO - "owner/repo" (aus github.repository)

ThingSpeak: field1=SoC%, field2=Reichweite km, field4=Ziel-SoC%,
field5=Ladestatus(0/1), field6=Stecker(0/1).
"""
import os
import sys
import json
import base64
import urllib.parse
import urllib.request
import urllib.error

TOKEN_URL = "https://thewall.tibber.com/connect/token"
BASE = "https://data-api.tibber.com/v1"
GH_API = "https://api.github.com"


def env(k):
    return (os.environ.get(k) or "").strip()


CID = env("TIBBER_CLIENT_ID"); CSEC = env("TIBBER_CLIENT_SECRET")
RT = env("TIBBER_REFRESH_TOKEN"); TS_KEY = env("TS_WRITE_KEY")
GH_PAT = env("GH_PAT"); GH_REPO = env("GH_REPO")
missing = [k for k, v in [("TIBBER_CLIENT_ID", CID), ("TIBBER_CLIENT_SECRET", CSEC),
                          ("TIBBER_REFRESH_TOKEN", RT), ("TS_WRITE_KEY", TS_KEY),
                          ("GH_PAT", GH_PAT), ("GH_REPO", GH_REPO)] if not v]
if missing:
    print("FEHLER: Secrets/Env fehlen:", ", ".join(missing)); sys.exit(1)


def gh_headers():
    return {"Authorization": "Bearer " + GH_PAT, "Accept": "application/vnd.github+json",
            "User-Agent": "id3-poller", "X-GitHub-Api-Version": "2022-11-28"}


def persist_refresh_token(new_rt):
    """Neuen Refresh-Token verschluesselt ins Repo-Secret TIBBER_REFRESH_TOKEN schreiben."""
    from nacl import public, encoding  # PyNaCl
    pk = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{GH_API}/repos/{GH_REPO}/actions/secrets/public-key", headers=gh_headers()), timeout=30).read())
    sealed = public.SealedBox(public.PublicKey(pk["key"].encode(), encoding.Base64Encoder)).encrypt(new_rt.encode())
    body = json.dumps({"encrypted_value": base64.b64encode(sealed).decode(), "key_id": pk["key_id"]}).encode()
    req = urllib.request.Request(f"{GH_API}/repos/{GH_REPO}/actions/secrets/TIBBER_REFRESH_TOKEN",
                                 data=body, method="PUT",
                                 headers={**gh_headers(), "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=30)  # 204 No Content


# 1) Access-Token holen (verbraucht den aktuellen Refresh-Token, liefert neuen)
data = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": RT,
                               "client_id": CID, "client_secret": CSEC}).encode()
try:
    tok = json.loads(urllib.request.urlopen(urllib.request.Request(
        TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=30).read())
except urllib.error.HTTPError as e:
    print("FEHLER Token-Refresh:", e.code, e.read().decode()[:200])
    print("-> TIBBER_REFRESH_TOKEN ist wahrscheinlich abgelaufen/verbraucht. Neu einloggen und Secret setzen.")
    sys.exit(1)
access = tok["access_token"]
new_rt = tok.get("refresh_token")

# 2) Neuen Refresh-Token SOFORT sichern, damit die Kette nie bricht
if new_rt and new_rt != RT:
    try:
        persist_refresh_token(new_rt)
        print("TIBBER_REFRESH_TOKEN-Secret aktualisiert (rotiert).")
    except Exception as e:
        print("WARN: Secret-Update fehlgeschlagen -> naechster Lauf koennte scheitern:", repr(e))
else:
    print("WARN: kein neuer Refresh-Token zurueckgegeben.")


def call(path):
    rq = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + access, "Accept": "application/json"})
    with urllib.request.urlopen(rq, timeout=30) as r:
        return json.loads(r.read().decode())


# 3) Fahrzeug (Device mit SoC) finden
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

# 4) ThingSpeak
fields = {"field1": soc, "field2": rng_km, "field4": target, "field5": charging, "field6": connected}
params = {"api_key": TS_KEY}
for k, v in fields.items():
    if v is not None:
        params[k] = v
with urllib.request.urlopen("https://api.thingspeak.com/update?" + urllib.parse.urlencode(params), timeout=30) as r:
    body = r.read().decode().strip()
print("ThingSpeak entry-id:", body)
sys.exit(0 if body != "0" else 1)
