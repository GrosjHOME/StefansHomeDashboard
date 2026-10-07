// PV-Morgenprognose fuer das Dashboard (Val Town, Val "GrosjeansHomeDashboard", Datei prognose.ts,
// Trigger: HTTP). Einrichtung: README, Abschnitt "PV-Morgenprognose (Val Town)".
//
// Jeden Morgen um 05:00 (Datei morgens.ts, Cron) wird die PV-Leistung fuer den ganzen Tag
// in 15-min-Schritten berechnet und eingefroren (Blob "pv_prognose_YYYY-MM-DD"). Das Dashboard
// holt sie hier ab und zeigt sie in der Grafik "Leistung" (blau gestrichelt) und als Soll am
// Balken "Aktuelle Leistung". So sieht man den ganzen Tag, was am Morgen erwartet wurde.
//
// Rechnung (wie im Dashboard, aber mit sauber zugeordneten Zeitintervallen):
//  - Einstrahlung auf die Modulflaeche (60° Neigung, Sued) von Open-Meteo, 15-min-Raster.
//    Open-Meteo-Strahlungswerte sind Mittel des VORANGEHENDEN Intervalls (Stempel 13:15 =
//    13:00-13:15) -> jeder Wert wird der Intervallmitte zugeordnet (13:07:30). forecast_days=2,
//    damit auch das letzte Intervall des Tages (Stempel 00:00 des Folgetags) dabei ist.
//  - Umrechnung in kW mit Faktoren je Tagesstunde: Median(Ist-Leistung / Einstrahlung) der
//    letzten 15 Tage. ThingSpeak-Stundenmittel "13:00" = 13:00-14:00, Open-Meteo "14:00" =
//    13:00-14:00 -> genau diese beiden werden verglichen. Die Faktoren enthalten die
//    Verschattung im Tal und die Begrenzung der Wechselrichter.
//  - Zwischen den Stunden wird der Faktor linear interpoliert (keine Treppen).
//
// Abruf: GET <URL dieser Datei>            -> Prognose von heute (fehlt sie nach 05:00: jetzt rechnen)
//        GET <URL dieser Datei>?datum=2026-10-05 -> gespeicherte Prognose dieses Tages
//        GET <URL dieser Datei>?liste=60         -> { tage: [{datum, kwh, erstellt}] } der letzten 60 Tage
// Antwort: { datum, erstellt, schrittMin, tagesKwh, faktoren[24], punkte: [[ms, kW], ...] }
//          ms = Intervallmitte (Unix-Zeit in Millisekunden)

import { blob } from "https://esm.town/v/std/blob/main.ts";

const LAT = 46.966, LON = 7.742, TILT = 60, AZ = 0;      // Wittenbach bei Lauperswil, 60° Sued
const PV_KANAL = 172430, PV_READ_KEY = "6GIAGINL9VN4CTL8"; // oeffentlicher Lese-Key (steht auch im Dashboard)
const ZONE = "Europe/Zurich";
const AB_STUNDE = 5;                                       // Prognose des Tages ab 05:00 Ortszeit
const KEY = (datum: string) => `pv_prognose_${datum}`;

export type Prognose = {
  datum: string; erstellt: string; schrittMin: number; tagesKwh: number;
  faktoren: number[]; punkte: [number, number][];
};

// Ortszeit eines Zeitpunkts: Datum + Stunde/Minute (Sommer-/Winterzeit automatisch)
const FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function lokal(ms: number) {
  const s = FMT.format(new Date(ms));                      // "2026-10-05 13:07"
  return { datum: s.slice(0, 10), h: +s.slice(11, 13), min: +s.slice(14, 16) };
}

// Abruf mit Wiederholung: Zur vollen Stunde ist Open-Meteo oft kurz ueberlastet (HTTP 503, so am
// 07.10.2026 um 05:00). Bei 429/5xx oder Netzfehler nach 5, 15 und 25 s nochmals versuchen -
// zusammen unter einer Minute (Laufzeitgrenze Gratis-Plan). Klappt es nicht, holt der naechste
// Cron-Lauf (stuendlich bis 09:00) die Prognose nach.
const WARTEN_S = [5, 15, 25];
async function json(url: string): Promise<any> {
  const ziel = url.split("?")[0];
  for (let i = 0; ; i++) {
    let fehler: string;
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      fehler = `HTTP ${r.status}`;
      if (r.status !== 429 && r.status < 500) throw new Error(`${ziel}: ${fehler}`);   // nicht wiederholbar
    } catch (e) {
      if (String(e).includes(ziel)) throw e;                 // eigener Fehler von oben
      fehler = String(e);
    }
    if (i >= WARTEN_S.length) throw new Error(`${ziel}: ${fehler} (nach ${i + 1} Versuchen)`);
    console.warn(`${ziel}: ${fehler} – neuer Versuch in ${WARTEN_S[i]} s`);
    await new Promise((res) => setTimeout(res, WARTEN_S[i] * 1000));
  }
}
const om = (extra: string) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&tilt=${TILT}&azimuth=${AZ}` +
  `&timezone=Europe%2FZurich&timeformat=unixtime&${extra}`;

// Faktor kW / (kW/m²) je Tagesstunde [h, h+1): Median der letzten 15 Tage
async function faktoren(): Promise<number[]> {
  const g = await json(om("hourly=global_tilted_irradiance&past_days=14&forecast_days=0"));
  const ein = new Map<number, number>();                   // Intervall-Start (ms) -> W/m²
  g.hourly.time.forEach((t: number, i: number) => {
    const v = g.hourly.global_tilted_irradiance[i];
    if (v != null) ein.set((t - 3600) * 1000, v);          // Stempel = Intervallende
  });
  // ThingSpeak mittelt hoechstens ~8000 Rohwerte (PV sendet minuetlich -> ~8 Tage) ->
  // 14 Tage in drei 5-Tage-Fenstern holen (start/end in UTC)
  const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", "%20");
  const feeds: any[] = [];
  for (let k = 0; k < 3; k++) {
    const ende = Date.now() - k * 5 * 864e5;
    const ts = await json(`https://api.thingspeak.com/channels/${PV_KANAL}/feeds.json` +
      `?average=60&start=${utc(ende - 5 * 864e5)}&end=${utc(ende)}&api_key=${PV_READ_KEY}`);
    feeds.push(...(ts.feeds ?? []));
  }
  const je: number[][] = Array.from({ length: 24 }, () => []);
  for (const x of feeds) {
    const start = Date.parse(x.created_at);                // Stundenmittel, Stempel = Intervallbeginn
    const e = ein.get(start), a = parseFloat(x.field1);
    if (e == null || e < 40 || !isFinite(a)) continue;     // Daemmerung streut zu stark
    je[lokal(start).h].push(a / e);                        // W / (W/m²) = kW / (kW/m²)
  }
  const F = je.map((a) => { a.sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; });
  if (!F.some((f) => f > 0)) for (let h = 8; h <= 17; h++) F[h] = 25;   // Rueckfall ohne Ist-Daten
  return F;
}

// Faktor zu einer Ortszeit x (Stunden, z. B. 13.125): F[h] gilt fuer die Stundenmitte h:30
function faktorBei(F: number[], x: number): number {
  const p = x - 0.5, h0 = Math.floor(p), w = p - h0;
  const a = F[(h0 + 24) % 24], b = F[(h0 + 1) % 24];
  return a + (b - a) * w;
}

export async function erstellen(): Promise<Prognose> {
  const F = await faktoren();
  const datum = lokal(Date.now()).datum;
  const g = await json(om("minutely_15=global_tilted_irradiance&forecast_days=2"));
  const punkte: [number, number][] = [];
  let kwh = 0;
  g.minutely_15.time.forEach((t: number, i: number) => {
    const v = g.minutely_15.global_tilted_irradiance[i];
    if (v == null) return;
    const mitte = (t - 450) * 1000;                        // Mitte des vorangehenden 15-min-Intervalls
    const l = lokal(mitte);
    if (l.datum !== datum) return;                         // Stempel 00:00 gehoert zum Vortag
    const kw = Math.max(0, (v / 1000) * faktorBei(F, l.h + (l.min + 0.5) / 60));
    punkte.push([mitte, Math.round(kw * 100) / 100]);
    kwh += kw * 0.25;
  });
  if (!punkte.length) throw new Error("Open-Meteo lieferte keine 15-min-Werte");
  return {
    datum, erstellt: new Date().toISOString(), schrittMin: 15,
    tagesKwh: Math.round(kwh), faktoren: F.map((f) => Math.round(f * 10) / 10), punkte,
  };
}

// Prognose von heute: einmal ab 05:00 rechnen, danach nur noch die gespeicherte liefern
export async function morgenprognose(): Promise<Prognose | null> {
  const jetzt = lokal(Date.now());
  const alt = (await blob.getJSON(KEY(jetzt.datum)).catch(() => undefined)) as Prognose | undefined;
  if (alt) return alt;
  if (jetzt.h < AB_STUNDE) return null;
  const p = await erstellen();
  await blob.setJSON(KEY(p.datum), p);
  console.log(`Prognose ${p.datum} erstellt: ${p.tagesKwh} kWh, Spitze ` +
    `${Math.max(...p.punkte.map((x) => x[1])).toFixed(1)} kW`);
  return p;
}

// Alle gespeicherten Tage kurz (fuer "Prognose gegen Ist" im Dashboard), neueste zuletzt
async function liste(tage: number) {
  const keys = (await blob.list("pv_prognose_")).map((b: { key: string }) => b.key).sort().slice(-tage);
  const out: { datum: string; kwh: number; erstellt: string }[] = [];
  for (const k of keys) {
    const p = (await blob.getJSON(k).catch(() => undefined)) as Prognose | undefined;
    if (p) out.push({ datum: p.datum, kwh: p.tagesKwh, erstellt: p.erstellt });
  }
  return { tage: out };
}

export default async function (req: Request): Promise<Response> {
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
  const antwort = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, ...extra } });
  try {
    const q = new URL(req.url).searchParams;
    if (q.has("liste")) return antwort(200, await liste(Math.min(366, +(q.get("liste") || 0) || 60)), { "Cache-Control": "public, max-age=600" });
    const datum = q.get("datum");
    let p: Prognose | null | undefined;
    if (datum && datum !== lokal(Date.now()).datum) {
      if (!/^\d{4}-\d\d-\d\d$/.test(datum)) return antwort(400, { fehler: "datum=YYYY-MM-DD" });
      p = (await blob.getJSON(KEY(datum)).catch(() => undefined)) as Prognose | undefined;
    } else p = await morgenprognose();
    if (!p) return antwort(404, { fehler: "keine Prognose für diesen Tag (wird ab 05:00 erstellt)" });
    return antwort(200, p, { "Cache-Control": "public, max-age=300" });
  } catch (e) {
    console.error(e);
    return antwort(502, { fehler: String(e) });
  }
}
