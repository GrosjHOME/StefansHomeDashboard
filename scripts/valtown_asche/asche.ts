// Asche-Leerungen der Holzschnitzelheizung (Val Town, Val "GrosjeansHomeDashboard", Datei asche.ts,
// Trigger: HTTP). Einrichtung: README, Abschnitt "Asche-Prognose (Val Town)".
//
// Das Dashboard schaetzt aus der Brennzeit, wann die Aschebox voll ist. Dazu muss es wissen, wann sie
// zuletzt geleert wurde - das traegt man mit dem Knopf "Asche geleert" ein, hier wird es gespeichert.
//
// Speicher: Blob "asche_leerungen" = { leerungen: ["2026-10-17T10:00:00.000Z", ...] } (UTC, aufsteigend)
// GET                    -> { leerungen: [...] }   (oeffentlich, nur Lesen)
// POST   { zeit?: ISO }  -> Leerung eintragen (Standard: jetzt)        } Header X-Asche-Token muss der
// DELETE { zeit: ISO }   -> diese Leerung entfernen (Rueckgaengig)     } Umgebungsvariable ASCHE_TOKEN gleichen

import { blob } from "https://esm.town/v/std/blob/main.ts";

const KEY = "asche_leerungen";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Asche-Token",
};

async function lesen(): Promise<string[]> {
  const d = (await blob.getJSON(KEY).catch(() => null)) as { leerungen?: unknown } | null;
  return Array.isArray(d?.leerungen) ? (d!.leerungen as string[]) : [];
}

export default async function (req: Request): Promise<Response> {
  const antwort = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method === "GET") return antwort(200, { leerungen: await lesen() });
    if (req.method !== "POST" && req.method !== "DELETE") return antwort(405, { fehler: "Methode nicht erlaubt" });
    const token = Deno.env.get("ASCHE_TOKEN");
    if (!token) return antwort(500, { fehler: "Umgebungsvariable ASCHE_TOKEN fehlt im Val" });
    if (req.headers.get("X-Asche-Token") !== token) return antwort(401, { fehler: "Token falsch" });
    const body = (await req.json().catch(() => ({}))) as { zeit?: unknown };
    const ms = typeof body.zeit === "string" ? Date.parse(body.zeit) : Date.now();
    if (isNaN(ms) || ms > Date.now() + 60_000) return antwort(400, { fehler: "zeit ungültig (ISO-Zeit, nicht in der Zukunft)" });
    const zeit = new Date(ms).toISOString();
    let l = await lesen();
    if (req.method === "POST") { if (!l.includes(zeit)) l.push(zeit); }
    else l = l.filter((z) => z !== zeit);
    l.sort();
    await blob.setJSON(KEY, { leerungen: l });
    console.log(`${req.method} ${zeit} -> ${l.length} Leerungen`);
    return antwort(200, { leerungen: l });
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
