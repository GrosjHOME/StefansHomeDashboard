// Geraete-Zaehler des Dashboards (Val Town, Val "GrosjeansHomeDashboard", Datei geraete.ts, Trigger: HTTP).
// Einrichtung: README, Abschnitt "Geraete-Zaehler (Val Town)".
//
// Jedes Geraet (Browser) bekommt im Dashboard eine zufaellige Kennung (localStorage) und meldet sich damit beim Oeffnen
// (hoechstens alle 30 min). Hier wird gezaehlt, wie viele verschiedene Geraete das Dashboard benutzen. Gespeichert werden
// nur die Kennung und grobe Angaben (Browser, Betriebssystem, App oder Browser, Bildschirmgroesse, Sprache) - keine IP-Adresse,
// keine Namen. So sieht man auch, ob immer dasselbe Geraet kommt (gleiche Kennung) oder die Kennung wechselt.
//
// Speicher: Blob "geraete" = { devices: { <kennung>: { id, erst, zuletzt, besuche, tage: ["2026-10-18", ...],
//                                                        browser, os, app, schirm, sprache } } }
// GET                       -> { heute, tage7, tage30, gesamt }            (oeffentlich: nur Zahlen)
//   mit Header X-Asche-Token -> zusaetzlich { geraete: [ ... ] }            (Einzelheiten nur mit dem Passwort ASCHE_TOKEN)
// POST   { id, browser, os, app, schirm, sprache } -> Meldung eines Geraets (id = 16-32 Hex-Zeichen)
// DELETE { id }  mit X-Asche-Token                 -> Geraet entfernen

import { blob } from "https://esm.town/v/std/blob/main.ts";

const KEY = "geraete";
const MAX_GERAETE = 100;          // Obergrenze, damit der Speicher nicht beliebig waechst
const NEUER_BESUCH_MS = 30 * 60_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Asche-Token",
};

type Geraet = {
  id: string; erst: string; zuletzt: string; besuche: number; tage: string[];
  browser: string; os: string; app: boolean; schirm: string; sprache: string;
};
type Daten = { devices: Record<string, Geraet> };

const FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" });
const ymd = (ms: number) => FMT.format(new Date(ms));   // "2026-10-18" (Ortszeit)
const sauber = (v: unknown, max = 40) =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f<>"'`&]/g, "").trim().slice(0, max);

async function lesen(): Promise<Daten> {
  const d = (await blob.getJSON(KEY).catch(() => null)) as Partial<Daten> | null;
  return { devices: d?.devices && typeof d.devices === "object" ? d.devices : {} };
}

function zahlen(d: Daten) {
  const jetzt = Date.now(), alle = Object.values(d.devices);
  const seit = (tage: number) => {
    const von = ymd(jetzt - (tage - 1) * 86_400_000);
    return alle.filter((g) => g.tage.some((t) => t >= von)).length;
  };
  return { heute: seit(1), tage7: seit(7), tage30: seit(30), gesamt: alle.length };
}

export default async function (req: Request): Promise<Response> {
  const antwort = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const token = Deno.env.get("ASCHE_TOKEN");
    const berechtigt = !!token && req.headers.get("X-Asche-Token") === token;
    const d = await lesen();

    if (req.method === "GET") {
      const out: Record<string, unknown> = zahlen(d);
      if (berechtigt) out.geraete = Object.values(d.devices).sort((a, b) => b.zuletzt.localeCompare(a.zuletzt));
      return antwort(200, out);
    }

    if (req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const id = typeof b.id === "string" ? b.id.toLowerCase() : "";
      if (!/^[a-f0-9]{16,32}$/.test(id)) return antwort(400, { fehler: "id ungültig (16-32 Hex-Zeichen)" });
      const jetzt = Date.now(), heute = ymd(jetzt);
      let g = d.devices[id];
      if (!g) {
        if (Object.keys(d.devices).length >= MAX_GERAETE) return antwort(409, { fehler: "Geräteliste voll" });
        g = d.devices[id] = { id, erst: new Date(jetzt).toISOString(), zuletzt: "", besuche: 0, tage: [], browser: "", os: "", app: false, schirm: "", sprache: "" };
      }
      if (!g.zuletzt || jetzt - Date.parse(g.zuletzt) > NEUER_BESUCH_MS) g.besuche++;
      g.zuletzt = new Date(jetzt).toISOString();
      if (!g.tage.includes(heute)) g.tage = [...g.tage, heute].slice(-60);
      g.browser = sauber(b.browser); g.os = sauber(b.os); g.app = b.app === true; g.schirm = sauber(b.schirm, 24); g.sprache = sauber(b.sprache, 12);
      await blob.setJSON(KEY, d);
      return antwort(200, zahlen(d));
    }

    if (req.method === "DELETE") {
      if (!berechtigt) return antwort(401, { fehler: "Token falsch" });
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const id = typeof b.id === "string" ? b.id.toLowerCase() : "";
      delete d.devices[id];
      await blob.setJSON(KEY, d);
      return antwort(200, zahlen(d));
    }

    return antwort(405, { fehler: "Methode nicht erlaubt" });
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
