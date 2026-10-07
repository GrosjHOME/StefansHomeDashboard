// Zuhause-Waechter: meldet Stoerungen per E-Mail (Val Town, Val "grosjeansHomeDashboard", Datei
// waechter.ts, Trigger: Cron alle 30 min). Einrichtung: README, Abschnitt "Waechter (Val Town)".
//
// Prueft bei jedem Lauf:
//  - liefern alle ThingSpeak-Kanaele noch (letzter Eintrag nicht aelter als maxMin)?
//    Die Heizung nur in der Heizsaison (Okt-Apr), sonst "Sommerpause".
//    ID.3-Kanal veraltet = der Tibber-Poller (main.ts im selben Val) laeuft nicht, z. B. Token-Kette gerissen.
//  - meldet die PV-Steuerung die SD-Karte als OK (Kanal 172430, field7 = 1)?
//  - ist die PV-Morgenprognose von heute um 05:00 entstanden (prognose.ts/morgens.ts im selben Val)?
//
// E-Mail: bei einer neuen Stoerung, wenn alles wieder in Ordnung ist, und taeglich als Erinnerung,
// solange etwas gestoert ist. Eine Stoerung zaehlt erst, wenn sie zwei Laeufe hintereinander
// besteht (kein Alarm wegen eines einzelnen Aussetzers von ThingSpeak). std/email schickt nur an
// die Adresse des Val-Town-Kontos - im Code steht keine Adresse.

import { blob } from "https://esm.town/v/std/blob/main.ts";
import { email } from "https://esm.town/v/std/email/main.ts";

const DASHBOARD = "https://grosjhome.github.io/StefansHomeDashboard/";
const PROGNOSE_URL = "https://steffgrosjean--23dbba40c0d911f1a70c1607ee4eb77e.web.val.run/";
const PV_READ_KEY = "6GIAGINL9VN4CTL8";   // oeffentlicher Lese-Key (steht auch im Dashboard)
const ZONE = "Europe/Zurich";
const STATUS_KEY = "waechter_status";
const ERINNERUNG_MS = 24 * 3600_000;

// Alle Kanaele senden auch nachts (PV ~3 min, Wallbox/Boiler minuetlich, ID.3 alle 15 min)
const KANAELE: { id: string; name: string; kanal: number; key?: string; maxMin: number; saison?: number[] }[] = [
  { id: "pv", name: "PV-Anlage", kanal: 172430, key: PV_READ_KEY, maxMin: 45 },
  { id: "wallbox", name: "Wallbox", kanal: 172228, maxMin: 45 },
  { id: "boiler", name: "Boiler", kanal: 502977, maxMin: 45 },
  { id: "id3", name: "ID.3 (Tibber-Poller main.ts)", kanal: 3514838, maxMin: 90 },
  { id: "heizung", name: "Heizung", kanal: 172428, maxMin: 120, saison: [9, 10, 11, 0, 1, 2, 3] },
];

type Status = { probleme: Record<string, string>; verdacht: string[]; gemeldet: number };

const FMT = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const zeit = (ms: number) => FMT.format(new Date(ms));
const lokal = (ms: number) => {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return { datum: s.slice(0, 10), h: +s.slice(11, 13), monat: +s.slice(5, 7) - 1 };
};

async function feeds(kanal: number, key?: string): Promise<any[]> {
  const r = await fetch(`https://api.thingspeak.com/channels/${kanal}/feeds.json?results=3` + (key ? `&api_key=${key}` : ""));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).feeds ?? [];
}

// Aktuelle Probleme: id -> Beschreibung
async function pruefen(): Promise<Record<string, string>> {
  const p: Record<string, string> = {};
  const jetzt = Date.now(), heute = lokal(jetzt);
  for (const k of KANAELE) {
    if (k.saison && !k.saison.includes(heute.monat)) continue;   // ausserhalb der Saison nicht pruefen
    try {
      const f = await feeds(k.kanal, k.key);
      const t = f.length ? Date.parse(f[f.length - 1].created_at) : NaN;
      const alter = (jetzt - t) / 60000;
      if (!isFinite(t)) p[k.id] = `${k.name}: Kanal ${k.kanal} liefert keine Daten`;
      else if (alter > k.maxMin) p[k.id] = `${k.name}: seit ${zeit(t)} kein neuer Wert (Kanal ${k.kanal})`;
      if (k.id === "pv" && f.length) {
        let sd: number | null = null;
        for (const x of f) { const v = parseFloat(x.field7); if (isFinite(v)) sd = v; }
        if (sd === 0) p.sd = "PV-Anlage: SD-Karte meldet Fehler (Kanal 172430, Feld 7)";
      }
    } catch (e) {
      p[k.id] = `${k.name}: Kanal ${k.kanal} nicht abrufbar (${e})`;
    }
  }
  // Morgenprognose: ab 06:00 muss die von heute da sein und um 05:xx entstanden sein
  if (heute.h >= 6) {
    try {
      const r = await fetch(PROGNOSE_URL);
      const pr = await r.json();
      if (!r.ok || pr.datum !== heute.datum) p.prognose = `PV-Morgenprognose: keine Prognose für heute (${pr.fehler ?? "HTTP " + r.status})`;
      else if (lokal(Date.parse(pr.erstellt)).h !== 5) {
        p.prognose = `PV-Morgenprognose: erst um ${zeit(Date.parse(pr.erstellt))} erstellt statt 05:00 (Cron morgens.ts prüfen)`;
      }
    } catch (e) {
      p.prognose = `PV-Morgenprognose: nicht abrufbar (${e})`;
    }
  }
  return p;
}

export default async function (_interval: unknown) {
  const alt = ((await blob.getJSON(STATUS_KEY).catch(() => undefined)) as Status | undefined) ??
    { probleme: {}, verdacht: [], gemeldet: 0 };
  const aktuell = await pruefen();

  // Bestaetigt = jetzt gestoert UND schon beim letzten Lauf (Verdacht) oder bereits gemeldet
  const bestaetigt: Record<string, string> = {};
  for (const [id, text] of Object.entries(aktuell)) {
    if (alt.verdacht.includes(id) || id in alt.probleme) bestaetigt[id] = text;
  }
  const neu = Object.keys(bestaetigt).filter((id) => !(id in alt.probleme));
  const behoben = Object.keys(alt.probleme).filter((id) => !(id in aktuell));
  const offen = Object.keys(bestaetigt).length > 0;
  const erinnern = offen && Date.now() - alt.gemeldet > ERINNERUNG_MS;

  let gemeldet = alt.gemeldet;
  if (neu.length || behoben.length || erinnern) {
    const z: string[] = [];
    if (offen) {
      z.push("Aktuelle Störungen:", ...Object.entries(bestaetigt).map(([id, t]) => `- ${t}${neu.includes(id) ? "  (neu)" : ""}`), "");
    }
    if (behoben.length) z.push("Wieder in Ordnung:", ...behoben.map((id) => `- ${alt.probleme[id]}`), "");
    z.push(`Dashboard: ${DASHBOARD}`, "", "– Zuhause-Wächter (Val Town)");
    const subject = offen
      ? `⚠ Zuhause: ${Object.keys(bestaetigt).length} Störung${Object.keys(bestaetigt).length > 1 ? "en" : ""}${erinnern && !neu.length ? " (Erinnerung)" : ""}`
      : "✅ Zuhause: wieder alles in Ordnung";
    await email({ subject, text: z.join("\n") });
    gemeldet = Date.now();
    console.log(`E-Mail: ${subject}`);
  }
  console.log(Object.keys(aktuell).length ? `Probleme: ${Object.values(aktuell).join(" | ")}` : "alles in Ordnung");
  await blob.setJSON(STATUS_KEY, { probleme: bestaetigt, verdacht: Object.keys(aktuell), gemeldet } satisfies Status);
}
