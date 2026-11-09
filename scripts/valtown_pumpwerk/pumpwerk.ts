// Pumpwerk-Ereignisse (Val Town, Val "GrosjeansHomeDashboard", Datei pumpwerk.ts, Trigger: HTTP).
//
// Der Pumpwerk-Logger (Arduino, Biral HPE Combo) misst jede Pause zwischen zwei Einschaltungen auf die
// Millisekunde und meldet jedes Ein-/Ausschalten per MQTT an den HausBroker (Raspberry Pi). Die Bridge auf dem Pi
// schickt diese Ereignisse gebuendelt hierher (POST). Hier landet jedes Ereignis als eine Zeile in SQLite, das
// Dashboard liest sie (GET). ThingSpeak laeuft unveraendert weiter; das hier ist eine Ergaenzung, kein Ersatz.
//
// Einrichtung: Umgebungsvariable PUMPWERK_TOKEN im Val setzen (ein langes Zufallspasswort, z. B. `openssl rand -hex 24`);
// dasselbe Passwort kommt als PUMPWERK_TOKEN in /etc/hausbroker/bridge.env auf dem Pi. Siehe HausBroker-README.
//
// Speicher: SQLite-Tabelle "pumpwerk_ereignis" (val-eigene Datenbank), eine Zeile je Ereignis:
//   t = UTC-Epoche in Sekunden, typ = "start" | "stopp",
//   dauer_ms = bei "start" die Pause davor, bei "stopp" die Laufzeit des Laufs (-1 = unbekannt: der Logger hat die
//              Gegenflanke seit seinem Start nicht gesehen), t_geschaetzt = 1, wenn der Logger keine Uhrzeit hatte und
//              die Bridge den Empfangszeitpunkt eingesetzt hat.
//   UNIQUE (typ, t, dauer_ms): dasselbe Ereignis wird nur einmal gespeichert (Wiederholung nach einem Fehler ist sicher).
//
// POST  mit Header X-Pumpwerk-Token (= PUMPWERK_TOKEN)
//       { "ereignisse": [ { "typ": "start", "t": 1731000000, "dauer_s": 123.456, "t_geschaetzt": false }, ... ] }
//       -> { neu, doppelt, ungueltig }   (hoechstens 200 je Aufruf)
// GET   ?seit=<epoche s>&bis=<epoche s>&limit=<n>   (oeffentlich, nur lesen; Standard: letzte 24 h, hoechstens 5000)
//       -> { ereignisse: [ { t, typ, dauer_s, t_geschaetzt } ], zusammenfassung: { starts, pause_min_s, pause_min_t, letzte_t } }

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

const MAX_PRO_POST = 200;
const MAX_GET = 5000;
const AUFBEWAHREN_TAGE = 400;          // aeltere Ereignisse werden beim Speichern geloescht (Speicher begrenzen)
const MAX_DAUER_MS = 30 * 86_400_000;  // laengere Pausen/Laeufe gelten als unbekannt
const MIN_EPOCHE = 1_700_000_000;      // Zeitstempel davor sind Unsinn (Logger ohne NTP schickt gar keinen)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Pumpwerk-Token",
};

let schemaBereit: Promise<unknown> | null = null;
function schema() {
  schemaBereit ??= sqlite.batch([
    `CREATE TABLE IF NOT EXISTS pumpwerk_ereignis (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       t INTEGER NOT NULL,
       typ TEXT NOT NULL CHECK (typ IN ('start', 'stopp')),
       dauer_ms INTEGER NOT NULL DEFAULT -1,
       t_geschaetzt INTEGER NOT NULL DEFAULT 0,
       empfangen INTEGER NOT NULL,
       UNIQUE (typ, t, dauer_ms)
     )`,
    `CREATE INDEX IF NOT EXISTS pumpwerk_ereignis_t ON pumpwerk_ereignis (t)`,
  ]);
  return schemaBereit;
}

type Ereignis = { typ: "start" | "stopp"; t: number; dauer_ms: number; t_geschaetzt: number };

// Prueft ein Ereignis aus dem POST; null = ungueltig.
function pruefe(roh: unknown, jetztS: number): Ereignis | null {
  if (!roh || typeof roh !== "object") return null;
  const e = roh as Record<string, unknown>;
  if (e.typ !== "start" && e.typ !== "stopp") return null;
  const t = typeof e.t === "number" ? Math.round(e.t) : NaN;
  if (!Number.isFinite(t) || t < MIN_EPOCHE || t > jetztS + 86_400) return null;
  let dauer_ms = -1;
  if (typeof e.dauer_s === "number" && Number.isFinite(e.dauer_s) && e.dauer_s >= 0) {
    const ms = Math.round(e.dauer_s * 1000);
    if (ms <= MAX_DAUER_MS) dauer_ms = ms;
  }
  return { typ: e.typ, t, dauer_ms, t_geschaetzt: e.t_geschaetzt === true ? 1 : 0 };
}

const zahl = (v: string | null, standard: number) => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : standard;
};

export default async function (req: Request): Promise<Response> {
  const antwort = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    await schema();
    const jetztS = Math.floor(Date.now() / 1000);

    if (req.method === "POST") {
      const token = Deno.env.get("PUMPWERK_TOKEN");
      if (!token) return antwort(503, { fehler: "PUMPWERK_TOKEN ist im Val nicht gesetzt" });
      if (req.headers.get("X-Pumpwerk-Token") !== token) return antwort(401, { fehler: "Token falsch" });
      const b = (await req.json().catch(() => null)) as { ereignisse?: unknown } | null;
      if (!b || !Array.isArray(b.ereignisse)) return antwort(400, { fehler: "erwartet { ereignisse: [...] }" });
      if (b.ereignisse.length > MAX_PRO_POST) return antwort(413, { fehler: `hoechstens ${MAX_PRO_POST} Ereignisse je Aufruf` });

      const gueltig = b.ereignisse.map((e) => pruefe(e, jetztS)).filter((e): e is Ereignis => e !== null);
      const ungueltig = b.ereignisse.length - gueltig.length;
      let neu = 0;
      if (gueltig.length > 0) {
        const ergebnisse = await sqlite.batch(gueltig.map((e) => ({
          sql: "INSERT OR IGNORE INTO pumpwerk_ereignis (t, typ, dauer_ms, t_geschaetzt, empfangen) VALUES (?, ?, ?, ?, ?)",
          args: [e.t, e.typ, e.dauer_ms, e.t_geschaetzt, jetztS],
        })));
        neu = ergebnisse.reduce((summe, r) => summe + (r.rowsAffected ?? 0), 0);
      }
      await sqlite.execute({
        sql: "DELETE FROM pumpwerk_ereignis WHERE t < ?",
        args: [jetztS - AUFBEWAHREN_TAGE * 86_400],
      });
      return antwort(200, { neu, doppelt: gueltig.length - neu, ungueltig });
    }

    if (req.method === "GET") {
      const u = new URL(req.url);
      const seit = Math.round(zahl(u.searchParams.get("seit"), jetztS - 86_400));
      const bis = Math.round(zahl(u.searchParams.get("bis"), jetztS + 86_400));
      const limit = Math.max(1, Math.min(MAX_GET, Math.round(zahl(u.searchParams.get("limit"), MAX_GET))));
      const r = await sqlite.execute({
        sql: "SELECT t, typ, dauer_ms, t_geschaetzt FROM pumpwerk_ereignis WHERE t >= ? AND t <= ? ORDER BY t ASC, id ASC LIMIT ?",
        args: [seit, bis, limit],
      });
      let starts = 0, pauseMin: number | null = null, pauseMinT: number | null = null, letzteT: number | null = null;
      const ereignisse = r.rows.map((z) => {
        const t = Number(z.t), dauer = Number(z.dauer_ms);
        letzteT = t;
        if (z.typ === "start") {
          starts++;
          if (dauer >= 0 && (pauseMin === null || dauer < pauseMin)) { pauseMin = dauer; pauseMinT = t; }
        }
        return { t, typ: String(z.typ), dauer_s: dauer >= 0 ? dauer / 1000 : null, t_geschaetzt: Number(z.t_geschaetzt) === 1 };
      });
      return antwort(200, {
        ereignisse,
        zusammenfassung: { starts, pause_min_s: pauseMin === null ? null : pauseMin / 1000, pause_min_t: pauseMinT, letzte_t: letzteT },
      });
    }

    return antwort(405, { fehler: "Methode nicht erlaubt" });
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
