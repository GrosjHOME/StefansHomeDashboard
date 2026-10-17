// Asche-Leerungen der Holzschnitzelheizung (Val Town, Val "GrosjeansHomeDashboard", Datei asche.ts,
// Trigger: HTTP). Einrichtung: README, Abschnitt "Asche-Prognose (Val Town)".
//
// Das Dashboard schaetzt aus der Brennzeit, wann die Aschebox voll ist. Dazu muss es wissen, wann sie
// zuletzt geleert wurde und wie voll sie dabei war (man leert nicht immer bei 100 %) - das traegt man
// mit dem Knopf "Asche geleert" ein, hier wird es gespeichert.
//
// Speicher: Blob "asche_leerungen" = { leerungen: ["2026-10-17T10:00:00.000Z", ...],   (UTC, aufsteigend)
//                                       anteile:   { "2026-10-17T10:00:00.000Z": 90 } }   (Fuellstand beim Leeren in %)
// GET                           -> { leerungen: [...], anteile: {...} }   (oeffentlich, nur Lesen)
// POST   { zeit?: ISO, pct?: n } -> Leerung eintragen (Standard: jetzt, 100 %); pct 10-100        } Header X-Asche-Token
// DELETE { zeit: ISO }          -> diese Leerung entfernen (Rueckgaengig)                          } = Umgebungsvariable ASCHE_TOKEN
// Fehlt ein Anteil (alte Eintraege), gilt 100 %.

import { blob } from "https://esm.town/v/std/blob/main.ts";

const KEY = "asche_leerungen";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Asche-Token",
};

type Daten = { leerungen: string[]; anteile: Record<string, number> };

async function lesen(): Promise<Daten> {
  const d = (await blob.getJSON(KEY).catch(() => null)) as Partial<Daten> | null;
  return {
    leerungen: Array.isArray(d?.leerungen) ? (d!.leerungen as string[]) : [],
    anteile: d?.anteile && typeof d.anteile === "object" ? (d.anteile as Record<string, number>) : {},
  };
}

export default async function (req: Request): Promise<Response> {
  const antwort = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method === "GET") return antwort(200, await lesen());
    if (req.method !== "POST" && req.method !== "DELETE") return antwort(405, { fehler: "Methode nicht erlaubt" });
    const token = Deno.env.get("ASCHE_TOKEN");
    if (!token) return antwort(500, { fehler: "Umgebungsvariable ASCHE_TOKEN fehlt im Val" });
    if (req.headers.get("X-Asche-Token") !== token) return antwort(401, { fehler: "Token falsch" });
    const body = (await req.json().catch(() => ({}))) as { zeit?: unknown; pct?: unknown };
    const ms = typeof body.zeit === "string" ? Date.parse(body.zeit) : Date.now();
    if (isNaN(ms) || ms > Date.now() + 60_000) return antwort(400, { fehler: "zeit ungültig (ISO-Zeit, nicht in der Zukunft)" });
    const zeit = new Date(ms).toISOString();
    const d = await lesen();
    if (req.method === "POST") {
      const pct = body.pct === undefined ? 100 : Number(body.pct);
      if (!isFinite(pct) || pct < 10 || pct > 100) return antwort(400, { fehler: "pct ungültig (10 bis 100)" });
      if (!d.leerungen.includes(zeit)) d.leerungen.push(zeit);
      d.anteile[zeit] = Math.round(pct);
    } else {
      d.leerungen = d.leerungen.filter((z) => z !== zeit);
      delete d.anteile[zeit];
    }
    d.leerungen.sort();
    await blob.setJSON(KEY, d);
    console.log(`${req.method} ${zeit}${req.method === "POST" ? " " + d.anteile[zeit] + " %" : ""} -> ${d.leerungen.length} Leerungen`);
    return antwort(200, d);
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
