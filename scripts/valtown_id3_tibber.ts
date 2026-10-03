// VW ID.3 Ladezustand via Tibber Data API -> ThingSpeak-Kanal 3514838 (E-Auto).
//
// Val-Town-Cron, alle 15 min. Ersetzt den GitHub-Actions-Poller (id3-tibber.yml), den
// GitHub nur ca. alle 5 h ausgefuehrt hat. Einrichtung: README, Abschnitt
// "ID.3-Poller auf Val Town". Dieser Code wird 1:1 in den Val kopiert.
//
// Tibber-Refresh-Tokens sind EINMAL-Tokens: jeder Refresh liefert einen neuen, der alte
// stirbt. Der jeweils aktuelle Token liegt deshalb im val-eigenen Blob-Speicher (privat).
// Die Umgebungsvariable TIBBER_REFRESH_TOKEN dient nur dem Start bzw. Neustart: schlaegt
// der gespeicherte Token fehl, wird sie versucht. Fuer einen Neustart also einfach einen
// frischen Token (scripts/tibber_token_neu.ps1) dort eintragen - kein Blob-Loeschen noetig.
//
// Umgebungsvariablen (Val Town, links in der Val-Seitenleiste):
//   TIBBER_CLIENT_ID, TIBBER_CLIENT_SECRET, TIBBER_REFRESH_TOKEN, TS_WRITE_KEY
// ThingSpeak: field1 SoC %, field2 Reichweite km, field4 Ziel-SoC %,
//             field5 Ladestatus (1 = laedt), field6 Stecker (1 = verbunden)

import { blob } from "https://esm.town/v/std/blob/main.ts";

const TOKEN_URL = "https://thewall.tibber.com/connect/token";
const BASE = "https://data-api.tibber.com/v1";
const RT_KEY = "tibber_refresh_token";

function env(k: string): string {
  const v = (Deno.env.get(k) || "").trim();
  if (!v) throw new Error(`Umgebungsvariable ${k} fehlt`);
  return v;
}

async function refresh(rt: string): Promise<{ access_token: string; refresh_token?: string }> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: rt,
      client_id: env("TIBBER_CLIENT_ID"), client_secret: env("TIBBER_CLIENT_SECRET"),
    }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Token-Refresh HTTP ${r.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

// Neuen Refresh-Token sichern - mit Wiederholung, denn geht er verloren, reisst die Kette.
async function saveRefreshToken(token: string) {
  for (let i = 1; i <= 3; i++) {
    try { await blob.setJSON(RT_KEY, { token, saved: new Date().toISOString() }); return; }
    catch (e) { console.warn(`Blob-Speichern Versuch ${i} fehlgeschlagen: ${e}`); }
  }
  throw new Error("Neuer Refresh-Token konnte nicht gespeichert werden - naechster Lauf wird scheitern");
}

// Access-Token holen: zuerst den gespeicherten Refresh-Token, sonst den aus der Umgebung.
async function getAccessToken(): Promise<string> {
  const stored = (await blob.getJSON(RT_KEY).catch(() => undefined)) as { token?: string } | undefined;
  const fromEnv = (Deno.env.get("TIBBER_REFRESH_TOKEN") || "").trim();
  const candidates = [stored?.token, fromEnv].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
  if (!candidates.length) throw new Error("Kein Refresh-Token - TIBBER_REFRESH_TOKEN eintragen");
  let lastErr: unknown;
  for (const rt of candidates) {
    try {
      const tok = await refresh(rt);
      if (tok.refresh_token && tok.refresh_token !== rt) await saveRefreshToken(tok.refresh_token);
      else if (!tok.refresh_token) console.warn("WARN: Tibber hat keinen neuen Refresh-Token geliefert");
      return tok.access_token;
    } catch (e) { lastErr = e; console.warn(String(e)); }
  }
  throw new Error("Kein gueltiger Refresh-Token mehr. Neuen erzeugen (scripts/tibber_token_neu.ps1) " +
    "und als TIBBER_REFRESH_TOKEN eintragen. Letzter Fehler: " + String(lastErr));
}

async function call(access: string, path: string): Promise<any> {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Tibber ${path}: HTTP ${r.status}`);
  return r.json();
}
const list = (x: any, key: string): any[] => (Array.isArray(x) ? x : x?.[key]) ?? [];

// Fahrzeug = das Geraet mit Ladezustand (storage.stateOfCharge)
async function findVehicle(access: string): Promise<Record<string, any> | null> {
  for (const h of list(await call(access, "/homes"), "homes")) {
    for (const d of list(await call(access, `/homes/${h.id}/devices`), "devices")) {
      const det = await call(access, `/homes/${h.id}/devices/${d.id}`);
      const caps: Record<string, any> = {};
      for (const c of det.capabilities ?? []) caps[c.id] = c.value;
      if ("storage.stateOfCharge" in caps) return caps;
    }
  }
  return null;
}

async function run(_interval?: unknown) {
  const access = await getAccessToken();
  const v = await findVehicle(access);
  if (!v) throw new Error("Kein Fahrzeug mit Ladezustand gefunden (ID.3 in der Tibber-App verbunden?)");

  const soc = v["storage.stateOfCharge"];
  const rangeM = v["range.remaining"];
  const fields: Record<string, number | null | undefined> = {
    field1: soc,
    field2: typeof rangeM === "number" ? Math.round(rangeM / 1000) : null,
    field4: v["storage.targetStateOfCharge"],
    field5: v["charging.status"] === "charging" ? 1 : 0,
    field6: v["connector.status"] === "connected" ? 1 : 0,
  };
  const params = new URLSearchParams({ api_key: env("TS_WRITE_KEY") });
  for (const [k, val] of Object.entries(fields)) if (val !== null && val !== undefined) params.set(k, String(val));
  const r = await fetch("https://api.thingspeak.com/update?" + params.toString());
  const body = (await r.text()).trim();
  if (!r.ok || body === "0") throw new Error(`ThingSpeak hat den Eintrag abgelehnt (HTTP ${r.status}, Antwort "${body}")`);
  console.log(`SoC=${soc}% Ziel=${fields.field4}% ${fields.field2} km Laden=${v["charging.status"]} ` +
    `Stecker=${v["connector.status"]} -> ThingSpeak-Eintrag ${body}`);
}

// Val Town ruft beim Cron die exportierte Funktion auf (Default-Export; zusaetzlich
// benannt wie im Doku-Beispiel).
export default run;
export const cronValHandler = run;
