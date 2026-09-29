#!/usr/bin/env python3
"""Liest den Ladezustand (SoC) des VW ID.3 ueber die inoffizielle We-Connect-ID-API
(WeConnect-python) und schreibt ihn in den ThingSpeak-Kanal 'E-Auto' (3514838).

Laeuft in GitHub Actions. Zugangsdaten kommen aus Secrets (Umgebungsvariablen),
niemals aus dem Code:
  VW_USER, VW_PASSWORD  -> We Connect ID Login (myVolkswagen-App)
  VW_VIN                -> FIN/VIN des Fahrzeugs
  TS_WRITE_KEY          -> ThingSpeak Write-API-Key des Kanals 3514838
"""
import os
import sys
import urllib.parse
import urllib.request


def env(key):
    return (os.environ.get(key) or "").strip()


USER = env("VW_USER")
PW = env("VW_PASSWORD")
VIN = env("VW_VIN").upper()
TS_KEY = env("TS_WRITE_KEY")

missing = [k for k, v in [("VW_USER", USER), ("VW_PASSWORD", PW), ("VW_VIN", VIN), ("TS_WRITE_KEY", TS_KEY)] if not v]
if missing:
    print("FEHLER: Secrets fehlen: " + ", ".join(missing))
    sys.exit(1)

from weconnect import weconnect  # noqa: E402


def val(obj, *path):
    """Navigiert defensiv durch dict/Attribute und gibt .value zurueck (oder None)."""
    cur = obj
    try:
        for p in path:
            if cur is None:
                return None
            cur = cur.get(p) if isinstance(cur, dict) else getattr(cur, p, None)
        if cur is None:
            return None
        return getattr(cur, "value", cur)
    except Exception:
        return None


def as_str(x):
    if x is None:
        return None
    return str(getattr(x, "value", x))


con = weconnect.WeConnect(username=USER, password=PW, updateAfterLogin=False, loginOnInit=False)
con.login()
con.update()

vehicle = con.vehicles.get(VIN)
if vehicle is None:
    if con.vehicles:
        vin0 = next(iter(con.vehicles))
        print(f"Hinweis: VIN {VIN} nicht gefunden, nutze {vin0}")
        vehicle = con.vehicles[vin0]
    else:
        print("FEHLER: keine Fahrzeuge im Konto")
        sys.exit(1)

d = vehicle.domains
# Debug: Struktur ausgeben, falls Attributpfade abweichen (nur Log, keine Geheimnisse)
try:
    print("Domains:", list(d.keys()))
    if "charging" in d:
        print("charging:", list(d["charging"].keys()))
except Exception:
    pass

soc = val(d, "charging", "batteryStatus", "currentSOC_pct")
rng = val(d, "charging", "batteryStatus", "cruisingRangeElectric_km")
power = val(d, "charging", "chargingStatus", "chargePower_kW")
state = as_str(val(d, "charging", "chargingStatus", "chargingState"))
remain = val(d, "charging", "chargingStatus", "remainingChargingTimeToComplete_min")
target = val(d, "charging", "chargingSettings", "targetSOC_pct")
plug = as_str(val(d, "charging", "plugStatus", "plugConnectionState"))

charging = 1 if (state and "charg" in state.lower()) else 0
connected = 1 if (plug and "disconnect" not in plug.lower() and "connect" in plug.lower()) else 0

print(f"SoC={soc}% range={rng}km power={power}kW target={target}% state={state} plug={plug}")

fields = {"field1": soc, "field2": rng, "field3": power,
          "field4": target, "field5": charging, "field6": connected, "field7": remain}
params = {"api_key": TS_KEY}
for k, v in fields.items():
    if v is not None:
        params[k] = v

if len(params) <= 1:
    print("FEHLER: keine Messwerte gelesen - Attributpfade pruefen (siehe Domains-Log oben)")
    sys.exit(1)

url = "https://api.thingspeak.com/update?" + urllib.parse.urlencode(params)
with urllib.request.urlopen(url, timeout=30) as r:
    body = r.read().decode().strip()
print("ThingSpeak Antwort (entry-id):", body)
if body == "0":
    print("WARN: ThingSpeak hat 0 zurueckgegeben (Rate-Limit <15s oder falscher Write-Key)")
    sys.exit(1)
