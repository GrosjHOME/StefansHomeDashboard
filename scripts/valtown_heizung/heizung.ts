// Von Hand eingetragene Werte der Holzschnitzelheizung (Val Town, Val "GrosjeansHomeDashboard", Datei heizung.ts,
// Trigger: HTTP; frueher asche.ts): Asche-Leerungen sowie Auffuellen des Schnitzel-Bunkers und Lager.
// Einrichtung: README, Abschnitte "Asche-Prognose (Val Town)" und "Schnitzel-Prognose (Val Town)".
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
//
// Schnitzel (gleicher Token, eigener Blob "schnitzel_daten"; die Asche bleibt davon unberuehrt):
//   { auffuellungen: [ISO, ...], rest: { ISO: Rest im 20-m3-Bunker vor dem Auffuellen in %, danach voll },
//     lager: [ISO, ...], bestand: { ISO: Bestand im 80-m3-Lager nach dem Fuellen in m3 } }
// GET liefert sie unter "schnitzel" mit (fehlt das Feld, laeuft noch die alte asche.ts ohne Schnitzel).
// POST   { art: "schnitzel", zeit?: ISO, rest: 0-90 }   -> Auffuellen des Bunkers eintragen
// POST   { art: "lager",     zeit?: ISO, m3: 1-200 }    -> Lager gefuellt (Bestand danach)
// DELETE { art: "schnitzel" | "lager", zeit: ISO }      -> diesen Eintrag entfernen

import { blob } from "https://esm.town/v/std/blob/main.ts";

const KEY = "asche_leerungen";
const KEY_SCHNITZEL = "schnitzel_daten";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Asche-Token",
};

type Daten = { leerungen: string[]; anteile: Record<string, number> };

type Schnitzel = { auffuellungen: string[]; rest: Record<string, number>; lager: string[]; bestand: Record<string, number> };

async function lesenSchnitzel(): Promise<Schnitzel> {
  const d = (await blob.getJSON(KEY_SCHNITZEL).catch(() => null)) as Partial<Schnitzel> | null;
  const liste = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
  const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, number>) : {});
  return { auffuellungen: liste(d?.auffuellungen), rest: obj(d?.rest), lager: liste(d?.lager), bestand: obj(d?.bestand) };
}

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
    if (req.method === "GET") return antwort(200, { ...(await lesen()), schnitzel: await lesenSchnitzel() });
    if (req.method !== "POST" && req.method !== "DELETE") return antwort(405, { fehler: "Methode nicht erlaubt" });
    const token = Deno.env.get("ASCHE_TOKEN");
    if (!token) return antwort(500, { fehler: "Umgebungsvariable ASCHE_TOKEN fehlt im Val" });
    if (req.headers.get("X-Asche-Token") !== token) return antwort(401, { fehler: "Token falsch" });
    const body = (await req.json().catch(() => ({}))) as { art?: unknown; zeit?: unknown; pct?: unknown; rest?: unknown; m3?: unknown };
    const ms = typeof body.zeit === "string" ? Date.parse(body.zeit) : Date.now();
    if (isNaN(ms) || ms > Date.now() + 60_000) return antwort(400, { fehler: "zeit ungültig (ISO-Zeit, nicht in der Zukunft)" });
    const zeit = new Date(ms).toISOString();
    if (body.art === "schnitzel" || body.art === "lager") {
      const s = await lesenSchnitzel(), bunker = body.art === "schnitzel";
      const liste = bunker ? s.auffuellungen : s.lager, werte = bunker ? s.rest : s.bestand;
      if (req.method === "POST") {
        const v = Number(bunker ? body.rest : body.m3);
        if (bunker && (!isFinite(v) || v < 0 || v > 90)) return antwort(400, { fehler: "rest ungültig (0 bis 90 %)" });
        if (!bunker && (!isFinite(v) || v < 1 || v > 200)) return antwort(400, { fehler: "m3 ungültig (1 bis 200)" });
        if (!liste.includes(zeit)) liste.push(zeit);
        werte[zeit] = Math.round(v * 10) / 10;
      } else {
        const i = liste.indexOf(zeit); if (i >= 0) liste.splice(i, 1);
        delete werte[zeit];
      }
      liste.sort();
      await blob.setJSON(KEY_SCHNITZEL, s);
      console.log(`${req.method} ${body.art} ${zeit}${req.method === "POST" ? " " + werte[zeit] + (bunker ? " % Rest" : " m3") : ""}`);
      return antwort(200, { ...(await lesen()), schnitzel: s });
    }
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
    return antwort(200, { ...d, schnitzel: await lesenSchnitzel() });
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
