// Zuhause-Waechter: meldet Stoerungen per E-Mail (Val Town, Val "GrosjeansHomeDashboard", Datei
// waechter.ts, Trigger: Cron alle 30 min). Einrichtung: README, Abschnitt "Waechter (Val Town)".
//
// Prueft bei jedem Lauf:
//  - liefern alle ThingSpeak-Kanaele noch (letzter Eintrag nicht aelter als maxMin)?
//    Die Heizung nur in der Heizsaison (Okt-Apr), sonst "Sommerpause".
//  - ist der Kessel oben noch warm (Kanal 172428, field1 >= KESSEL_MIN)? Nur in der Heizsaison;
//    Lesefehler der Fuehler (0.0, -127) zaehlen nicht.
//    ID.3-Kanal veraltet = der Tibber-Poller (id3.ts im selben Val) laeuft nicht, z. B. Token-Kette gerissen.
//  - sendet der Pumpwerk-Logger noch (Kanal 3484334, jede Minute) und meldet das Pumpwerk eine Stoerung
//    (field6 = 1, Kontakt offen)? Der Kanal ist privat: Lese-Key in der Umgebungsvariablen PUMPWERK_READ_KEY.
//  - meldet die PV-Steuerung die SD-Karte als OK (Kanal 172430, field7 = 1)?
//  - ist die PV-Morgenprognose von heute um 06:00 entstanden (prognose.ts/morgens.ts im selben Val)?
//  - muss der 20-m3-Schnitzel-Bunker in den naechsten SCHNITZEL_VORLAUF Tagen aufgefuellt werden (Rest unter 10 %)?
//    Gleiche Rechnung wie im Dashboard (Heizung -> Schnitzel-Bunker): Auffuellungen aus dem Blob "schnitzel_daten"
//    (heizung.ts), Austragung (field6) je Tag aus Kanal 172428, im Blob "schnitzel_tage" gemerkt. Nur in der Heizsaison.
//  - ist die Aschebox in den naechsten ASCHE_VORLAUF Tagen voll? Gleiche Rechnung wie im Dashboard (Heizung -> Aschebox):
//    Leerungen aus dem Blob "asche_leerungen" (heizung.ts), Brennzeit je Tag (Brennphasen aus Abgas/Kessel) aus Kanal 172428,
//    im Blob "asche_tage" gemerkt. Nur in der Heizsaison. Nach dem Eintragen der Leerung kommt die Entwarnung.
//
// E-Mail: bei einer neuen Stoerung, wenn alles wieder in Ordnung ist, und taeglich als Erinnerung,
// solange etwas gestoert ist. Eine Stoerung zaehlt erst, wenn sie zwei Laeufe hintereinander
// besteht (kein Alarm wegen eines einzelnen Aussetzers von ThingSpeak). std/email schickt nur an
// die Adresse des Val-Town-Kontos - im Code steht keine Adresse.

import { blob } from "https://esm.town/v/std/blob/main.ts";
import { email } from "https://esm.town/v/std/email";   // ohne /main.ts (sonst 404)

const DASHBOARD = "https://grosjhome.github.io/StefansHomeDashboard/";
const PROGNOSE_URL = "https://steffgrosjean--23dbba40c0d911f1a70c1607ee4eb77e.web.val.run/";
const PV_READ_KEY = "6GIAGINL9VN4CTL8";   // oeffentlicher Lese-Key (steht auch im Dashboard)
const ZONE = "Europe/Zurich";
const STATUS_KEY = "waechter_status";
const ERINNERUNG_MS = 24 * 3600_000;
const KESSEL_MIN = 50;   // Grad C, Kessel oben darunter = Feuer aus / Stoerung
const HEIZSAISON = [9, 10, 11, 0, 1, 2, 3];   // Okt-Apr (Monatsindex 0-11)

// Schnitzel-Bunker (wie SCHNITZEL im Dashboard)
const SZ = { BUNKER: 20, SCHWELLE: 10, START_M3_H: 0.5, LAT: 46.966, LON: 7.742, KANAL: 172428 };
const SCHNITZEL_VORLAUF = 2;   // Tage: so frueh vor dem Auffuellen kommt die Mail
const SZ_TAGE_VERSION = 3;   // 2 = Stoerungszeit zaehlt nicht als Austragung, 3 = Mai bis August zaehlt nichts (Logger nur zu Testzwecken)
const SZ_TAGE_KEY = "schnitzel_tage", SZ_MAX_TAGE = 150, SZ_MAX_ABRUFE = 25;   // je Lauf hoechstens so viele Tage nachholen

// Aschebox (wie ASCHE im Dashboard)
const ASCHE_VORLAUF = 2;   // Tage: so frueh vor "Box voll" kommt die Mail
const AS_TAGE_VERSION = 1, AS_TAGE_KEY = "asche_tage", AS_MAX_TAGE = 150, AS_MAX_ABRUFE = 15;   // mit den Schnitzel-Abrufen je Lauf hoechstens ~40 Tage
const GLUT_SPRUNG_K = 30, GLUT_ABKLING_K = 15, GLUT_MAX_MIN = 5;   // Glutstoss ueber den Abgas-Sprung (wie im Dashboard)
// Hinweise sind keine Stoerungen der Anlage: eigener Betreff, eigene Liste in der Mail
const HINWEISE: Record<string, string> = { asche: "🪣 Aschebox leeren", schnitzel: "🪵 Schnitzel-Bunker auffüllen" };

const PUMPWERK_READ_KEY = (Deno.env.get("PUMPWERK_READ_KEY") || "").trim() || undefined;   // privater Kanal, Key nur als Umgebungsvariable

// Alle Kanaele senden auch nachts (PV ~3 min, Wallbox/Boiler/Pumpwerk minuetlich, ID.3 alle 15 min)
const KANAELE: { id: string; name: string; kanal: number; key?: string; maxMin: number; saison?: number[] }[] = [
  { id: "pv", name: "PV-Anlage", kanal: 172430, key: PV_READ_KEY, maxMin: 45 },
  { id: "wallbox", name: "Wallbox", kanal: 172228, maxMin: 45 },
  { id: "boiler", name: "Boiler", kanal: 502977, maxMin: 45 },
  { id: "pumpwerk", name: "Pumpwerk (Logger)", kanal: 3484334, key: PUMPWERK_READ_KEY, maxMin: 20 },
  { id: "id3", name: "ID.3 (Tibber-Poller id3.ts)", kanal: 3514838, maxMin: 90 },
  { id: "heizung", name: "Heizung", kanal: 172428, maxMin: 120, saison: HEIZSAISON },
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

// ---- Schnitzel-Bunker ----
const hgt = (t: number) => (t < 12 ? 20 - t : 0);   // Heizgradtage 20/12
const median = (a: number[]) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const plusTage = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Beginn eines Zuercher Kalendertags als UTC-Zeitpunkt (Sommer-/Winterzeit beachtet)
function tagBeginn(ymd: string): number {
  const g = Date.parse(ymd + "T00:00:00Z"), p = lokalVoll(g), alsUtc = Date.parse(`${p.datum}T${p.hm}:00Z`);
  return g - (alsUtc - g);
}
const lokalVoll = (ms: number) => {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return { datum: s.slice(0, 10), hm: s.slice(11, 16) };
};
const austrMinute = (v: number) => Math.abs(v - 0.4) < 0.02 || Math.abs(v - 0.7) < 0.02 || Math.abs(v - 1) < 0.02;   // field6: Austragung laeuft
const tsStempel = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
// Austragung eines Tages (Minuten), dazu je Auffuellen an diesem Tag die Minuten davor (va) und danach (na)
// Minuten-Feeds eines Zuercher Tags (Kanal 172428); je Lauf nur einmal geholt, Schnitzel und Asche brauchen dieselben Tage
const tagCache = new Map<string, Promise<any[]>>();
function tagFeeds(ymd: string): Promise<any[]> {
  let p = tagCache.get(ymd);
  if (!p) {
    p = (async () => {
      const von = tagBeginn(ymd), bis = Math.min(tagBeginn(plusTage(ymd, 1)), Date.now());
      const r = await fetch(`https://api.thingspeak.com/channels/${SZ.KANAL}/feeds.json?results=8000&start=${encodeURIComponent(tsStempel(von))}&end=${encodeURIComponent(tsStempel(bis))}`);
      if (!r.ok) throw new Error(`ThingSpeak HTTP ${r.status}`);
      return ((await r.json()).feeds ?? []) as any[];
    })();
    p.catch(() => tagCache.delete(ymd));   // Fehler nicht merken
    tagCache.set(ymd, p);
  }
  return p;
}
// Tagesmittel der Aussentemperatur (14 Tage zurueck + 7 Tage Prognose), je Lauf einmal
let wetterCache: Promise<Record<string, number>> | null = null;
function temperaturen(): Promise<Record<string, number>> {
  if (!wetterCache) {
    wetterCache = (async () => {
      const om = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${SZ.LAT}&longitude=${SZ.LON}&daily=temperature_2m_mean&past_days=14&forecast_days=7&timezone=Europe%2FZurich`)).json();
      const temps: Record<string, number> = {}; (om?.daily?.time ?? []).forEach((t: string, i: number) => { const v = om.daily.temperature_2m_mean[i]; if (v != null) temps[t] = v; });
      return temps;
    })();
    wetterCache.catch(() => { wetterCache = null; });
  }
  return wetterCache;
}
async function austrTag(ymd: string, schnitte: number[]) {
  const f = await tagFeeds(ymd);
  let min = 0; const teile: Record<string, { va: number; na: number }> = {};
  for (const ts of schnitte) teile[ts] = { va: 0, na: 0 };
  // Stoerung (0.2, zu lange gelaufen): der ganze Lauf bis zur Stoerung plus die Stoerungsminuten zaehlen nicht als Austragung
  const fl: number[] = []; let lauf: number[] = [];
  f.forEach((x, i) => { const v = parseFloat(x.field6); fl[i] = 0;
    if (isFinite(v) && austrMinute(v)) lauf.push(i);
    else if (isFinite(v) && Math.abs(v - 0.2) < 0.02) { for (const k of lauf) fl[k] = 2; lauf = []; fl[i] = 2; }
    else { for (const k of lauf) fl[k] = 1; lauf = []; } });
  for (const k of lauf) fl[k] = 1;
  const sommer = ["05", "06", "07", "08"].includes(ymd.slice(5, 7));   // ausserhalb der Heizsaison zaehlt nichts
  for (let i = 0; i < f.length; i++) { const x = f[i]; if (fl[i] !== 1 || sommer) continue; min++;
    const t = Date.parse(x.created_at); for (const ts of schnitte) { if (t <= ts) teile[ts].va++; else teile[ts].na++; } }
  return { min, n: f.length, teile };
}
// Ergebnis: Text = auffuellen bald faellig, null = in Ordnung, undefined = (noch) nicht berechenbar
async function schnitzelPruefen(heute: string): Promise<string | null | undefined> {
  const d = (await blob.getJSON("schnitzel_daten").catch(() => null)) as any;
  const fJeTag: Record<string, { ymd: string; ts: number; rest: number }> = {};
  for (const z of ((d?.auffuellungen ?? []) as string[]).slice().sort()) { const ts = Date.parse(z); if (!isFinite(ts)) continue;
    const ymd = lokal(ts).datum; fJeTag[ymd] = { ymd, ts, rest: +(d?.rest?.[z] ?? 0) }; }   // mehrere am selben Tag: der letzte gilt
  const f = Object.keys(fJeTag).sort().map((k) => fJeTag[k]);
  if (!f.length) return null;   // noch kein Auffuellen erfasst: Stand unbekannt
  // Tagesliste: ab dem vorletzten Auffuellen bzw. 15 Tage zurueck, hoechstens SZ_MAX_TAGE
  let von = plusTage(heute, -15); for (const F of f) if (F.ymd < von) von = F.ymd;
  const minVon = plusTage(heute, -SZ_MAX_TAGE); if (von < minVon) von = minVon;
  let cache = ((await blob.getJSON(SZ_TAGE_KEY).catch(() => null)) as any) ?? { tage: {}, teile: {} };
  if (cache.v !== SZ_TAGE_VERSION) cache = { v: SZ_TAGE_VERSION, tage: {}, teile: {} };   // Zaehlweise geaendert (Stoerungszeit): Tageswerte neu holen
  const tage: Record<string, number> = {}, teile: Record<string, { va: number; na: number }> = {};
  let abrufe = 0, fehlt = false;
  for (let y = von; y <= heute; y = plusTage(y, 1)) {
    const schnitte = f.filter((F) => F.ymd === y).map((F) => F.ts);
    const fertig = y < heute && cache.tage[y] !== undefined && schnitte.every((ts) => cache.teile[ts]);
    if (fertig) { tage[y] = cache.tage[y]; for (const ts of schnitte) teile[ts] = cache.teile[ts]; continue; }
    if (abrufe >= SZ_MAX_ABRUFE) { fehlt = true; continue; }
    abrufe++;
    const w = await austrTag(y, schnitte);
    tage[y] = w.min; Object.assign(teile, w.teile);
    if (y < heute && (w.n > 0 || y < plusTage(heute, -2))) { cache.tage[y] = w.min; Object.assign(cache.teile, w.teile); }   // leere Tage erst cachen, wenn sicher vorbei
  }
  for (const k of Object.keys(cache.tage)) if (k < minVon) delete cache.tage[k];   // alte Tage aufraeumen
  await blob.setJSON(SZ_TAGE_KEY, cache);
  if (fehlt) { console.log(`Schnitzel: ${abrufe} Tage nachgeholt, Rest beim naechsten Lauf`); return undefined; }
  const voll = (a: string, b: string | null) => { let s = 0; for (const [y, m] of Object.entries(tage)) if (y > a && (b === null || y < b)) s += m; return s; };
  const vor = (F: { ymd: string; ts: number }) => teile[F.ts]?.va ?? tage[F.ymd] ?? 0;
  const nach = (F: { ts: number }) => teile[F.ts]?.na ?? 0;
  // Verbrauch je Minute Austragung: Median der Intervalle, sonst Startwert 0.5 m3 je Stunde Austragung (ca. 70 m3 je Saison bei 130-150 h Austragung)
  const raten: number[] = [];
  for (let i = 1; i < f.length; i++) { const a = f[i - 1], b = f[i]; if (a.ymd < von) continue;
    const A = voll(a.ymd, b.ymd) + nach(a) + vor(b), m3 = SZ.BUNKER * (1 - b.rest / 100); if (A >= 60 && m3 > 0) raten.push(m3 / A); }
  const temps = await temperaturen();
  let as = 0, nT = 0, asH = 0, hs14 = 0, nH = 0;
  for (let y = plusTage(heute, -14); y < heute; y = plusTage(y, 1)) { if (tage[y] === undefined) continue; as += tage[y]; nT++;
    if (temps[y] != null) { asH += tage[y]; hs14 += hgt(temps[y]); nH++; } }
  const mittelA = nT ? as / nT : 0, rateAH = nH >= 5 && hs14 >= 10 && asH > 0 ? asH / hs14 : null;
  let k = median(raten), quelle = raten.length ? `${raten.length} Auffüllung${raten.length === 1 ? "" : "en"}` : "erste Schätzung";
  if (!k && (rateAH || mittelA > 0)) k = SZ.START_M3_H / 60;   // k = m3 je Minute
  if (!k) return undefined;
  const X = f[f.length - 1]; if (X.ymd < von) return undefined;
  const seitA = voll(X.ymd, null) + nach(X), inhalt = Math.max(0, SZ.BUNKER - k * seitA), pct = (inhalt / SZ.BUNKER) * 100;
  // Tage bis zur Schwelle (wie das Dashboard: Austragung je Heizgradtag x Prognose, danach deren Mittel)
  const pred = (y: string) => (rateAH !== null && temps[y] != null ? rateAH * hgt(temps[y]) : mittelA);
  let rest = (inhalt - (SZ.BUNKER * SZ.SCHWELLE) / 100) / k, tageBis: number | null = null;
  if (rest <= 0) tageBis = 0;
  else { rest -= Math.max(0, pred(heute) - (tage[heute] ?? 0));
    const zuk: number[] = []; for (let q = 1; q <= 7; q++) { const y = plusTage(heute, q); if (temps[y] != null) zuk.push(pred(y)); }
    const fern = zuk.length ? zuk.reduce((s, v) => s + v, 0) / zuk.length : mittelA;
    if (rest <= 0) tageBis = 0; else for (let n = 1; n <= 60; n++) { const y = plusTage(heute, n); rest -= temps[y] != null ? pred(y) : fern; if (rest <= 0) { tageBis = n; break; } } }
  console.log(`Schnitzel: ${pct.toFixed(0)} % (${inhalt.toFixed(1)} m³), ${(k * 60).toFixed(2)} m³/h Austragung (${quelle}), Schwelle in ${tageBis ?? ">60"} Tagen`);
  if (tageBis === null || tageBis > SCHNITZEL_VORLAUF) return null;
  const wann = tageBis === 0 ? "jetzt" : tageBis === 1 ? "morgen" : `in ${tageBis} Tagen`;
  return `Schnitzel-Bunker: noch ca. ${pct.toFixed(0)} % (${inhalt.toFixed(1)} m³) – auffüllen ${wann} (Schwelle ${SZ.SCHWELLE} %, Verbrauch aus ${quelle})`;
}

// ---- Aschebox ----
// Brennphasen wie heizPhasen() im Dashboard: Beginn bei Abgas (field8) - Kessel oben (field1) > 30 K, Ende unter 20 K;
// zaehlt ab 60 s Dauer und 45 K Spitze. Dazu Glutstoesse bei heissem Kessel ueber den Abgas-Sprung. Ergebnis in ms.
function heizPhasen(ff: any[]): { s: number; e: number }[] {
  const out: { s: number; e: number; max: number }[] = [], v: { t: number; a: number }[] = [];
  let an: number | null = null, maxD = 0, lastT: number | null = null;
  for (const x of ff) {
    const t = Date.parse(x.created_at), a = parseFloat(x.field8), k = parseFloat(x.field1);
    if (!isFinite(a) || !isFinite(k) || a > 400 || a < -100 || k <= 0 || k >= 150) continue;   // Lesefehler (0.0, -127) und Spitzen
    v.push({ t, a });
    const d = a - k;
    if (an === null) { if (d > 30) { an = t; maxD = d; } }
    else { if (d > maxD) maxD = d; if (d < 20) { out.push({ s: an, e: t, max: maxD }); an = null; } }
    lastT = t;
  }
  if (an !== null && lastT !== null) out.push({ s: an, e: lastT, max: maxD });
  const ph = out.filter((x) => x.e - x.s >= 60000 && x.max >= 45).map((x) => ({ s: x.s, e: x.e }));
  let sperre = 0; const sprung: { s: number; e: number }[] = [];
  for (let i = 2; i < v.length; i++) {
    const p = v[i]; if (p.t < sperre) continue;
    if (p.t - v[i - 2].t > 3.5 * 60000) continue;   // Messluecke
    const base = Math.min(v[i - 1].a, v[i - 2].a); if (p.a - base < GLUT_SPRUNG_K) continue;
    if (ph.some((o) => p.t >= o.s - 2 * 60000 && p.t <= o.e + 2 * 60000)) continue;   // gehoert zu einer Brennphase
    let ende: number | null = null;
    for (let j = i + 1; j < v.length && v[j].t - p.t <= GLUT_MAX_MIN * 60000; j++) { if (v[j].a <= base + GLUT_ABKLING_K) { ende = v[j].t; break; } }
    if (ende === null) continue;
    sprung.push({ s: p.t, e: ende }); sperre = ende;
  }
  return ph.concat(sprung);
}
// Brennzeit eines Tages (min, gerundet wie im Dashboard) und je Leerung an diesem Tag die Minuten davor (vb) und danach (nb)
async function brennTag(ymd: string, schnitte: number[]) {
  const ff = await tagFeeds(ymd), ph = heizPhasen(ff);
  const teile: Record<string, { vb: number; nb: number }> = {};
  for (const ts of schnitte) {
    let vb = 0, nb = 0;
    for (const p of ph) { vb += Math.max(0, Math.min(p.e, ts) - p.s) / 60000; nb += Math.max(0, p.e - Math.max(p.s, ts)) / 60000; }
    if (ff.length) teile[ts] = { vb: Math.round(vb), nb: Math.round(nb) };   // ohne Daten: ganzer Tag zum alten Intervall
  }
  return { min: Math.round(ph.reduce((s, p) => s + (p.e - p.s) / 60000, 0)), n: ff.length, teile };
}
// Ergebnis: Text = Box bald voll, null = in Ordnung (oder noch keine Leerung erfasst), undefined = (noch) nicht berechenbar
async function aschePruefen(heute: string): Promise<string | null | undefined> {
  const d = (await blob.getJSON("asche_leerungen").catch(() => null)) as any;
  const proTag: Record<string, { ymd: string; ts: number; pct: number }> = {};
  for (const z of ((d?.leerungen ?? []) as string[]).slice().sort()) { const ts = Date.parse(z); if (!isFinite(ts)) continue;
    const ymd = lokal(ts).datum; proTag[ymd] = { ymd, ts, pct: +(d?.anteile?.[z] || 100) }; }   // mehrere am selben Tag: der letzte gilt
  const alle = Object.keys(proTag).sort().map((k) => proTag[k]);
  if (!alle.length) return null;   // ohne Leerung keine Kapazitaet, also keine Prognose (wie im Dashboard)
  // Tagesliste ab Saisonstart (bzw. 1. September), hoechstens AS_MAX_TAGE zurueck
  const jahr = +heute.slice(0, 4) - (+heute.slice(5, 7) >= 9 ? 0 : 1);
  let cache = ((await blob.getJSON(AS_TAGE_KEY).catch(() => null)) as any) ?? {};
  if (cache.v !== AS_TAGE_VERSION) cache = { v: AS_TAGE_VERSION, tage: {}, teile: {}, saison: {} };
  let von: string = cache.saison[jahr] ?? `${jahr}-09-01`;
  const minVon = plusTage(heute, -AS_MAX_TAGE); if (von < minVon) von = minVon;
  const tage: Record<string, number> = {}, teile: Record<string, { vb: number; nb: number }> = {};
  let abrufe = 0, fehlt = false;
  for (let y = von; y <= heute; y = plusTage(y, 1)) {
    const schnitte = alle.filter((L) => L.ymd === y).map((L) => L.ts);
    const fertig = y < heute && cache.tage[y] !== undefined && schnitte.every((ts) => cache.teile[ts] !== undefined);
    if (fertig) { tage[y] = cache.tage[y]; for (const ts of schnitte) if (cache.teile[ts]) teile[ts] = cache.teile[ts]; continue; }
    if (abrufe >= AS_MAX_ABRUFE) { fehlt = true; continue; }
    abrufe++;
    const w = await brennTag(y, schnitte);
    tage[y] = w.min; Object.assign(teile, w.teile);
    if (y < heute && (w.n > 0 || y < plusTage(heute, -2))) {   // leere Tage erst cachen, wenn sicher vorbei
      cache.tage[y] = w.min; for (const ts of schnitte) cache.teile[ts] = w.teile[ts] ?? null; }
  }
  for (const k of Object.keys(cache.tage)) if (k < minVon) delete cache.tage[k];
  // Saisonstart = erster Tag mit >= 30 min Brennzeit
  let saison: string | null = null;
  for (const y of Object.keys(tage).sort()) if (tage[y] >= 30) { saison = y; break; }
  if (saison && !fehlt && !cache.saison[jahr]) cache.saison[jahr] = saison;
  await blob.setJSON(AS_TAGE_KEY, cache);
  if (fehlt) { console.log(`Asche: ${abrufe} Tage nachgeholt, Rest beim naechsten Lauf`); return undefined; }
  if (!saison) return null;   // Saison hat noch nicht begonnen
  const voll = (a: string, incl: boolean, b: string | null) => { let s = 0;
    for (const [y, m] of Object.entries(tage)) if ((incl ? y >= a : y > a) && (b === null || y < b)) s += m; return s; };
  const vor = (L: { ymd: string; ts: number }) => teile[L.ts]?.vb ?? tage[L.ymd] ?? 0;
  const nach = (L: { ts: number }) => teile[L.ts]?.nb ?? 0;
  const lt = alle.filter((L) => L.ymd >= saison!);
  // Kapazitaet (Brennzeit der vollen Box): Median der Intervalle, je auf 100 % hochgerechnet; das erste beginnt am Saisonstart
  const kaps: number[] = []; let prev: typeof lt[0] | null = null;
  for (const L of lt) {
    const startTs = prev ? prev.ts : tagBeginn(saison);
    if (L.ts > startTs) {
      const b = (prev ? voll(prev.ymd, false, L.ymd) + nach(prev) : voll(saison, true, L.ymd)) + vor(L);
      if (b > 0) kaps.push(b / (L.pct / 100));
    }
    prev = L;
  }
  const kap = median(kaps);
  if (!kap) return null;   // noch keine Leerung in dieser Saison
  const X = lt.length ? lt[lt.length - 1] : null;
  const seit = X ? voll(X.ymd, false, null) + nach(X) : voll(saison, true, null), pct = (seit / kap) * 100;
  // Prognose: Brennzeit je Heizgradtag der letzten 14 abgeschlossenen Tage x Heizgradtage der 7-Tage-Prognose, danach deren Mittel
  const temps = await temperaturen();
  let bs = 0, nT = 0, bsH = 0, hs = 0, nH = 0;
  for (let y = plusTage(heute, -14); y < heute; y = plusTage(y, 1)) { if (tage[y] === undefined) continue; bs += tage[y]; nT++;
    if (temps[y] != null) { bsH += tage[y]; hs += hgt(temps[y]); nH++; } }
  const mittelTag = nT ? bs / nT : 0, rateHGT = nH >= 5 && hs >= 10 ? bsH / hs : null;
  const pred = (y: string) => (rateHGT !== null && temps[y] != null ? rateHGT * hgt(temps[y]) : mittelTag);
  let rest = kap - seit, tageBis: number | null = null;
  if (rest <= 0) tageBis = 0;
  else { rest -= Math.max(0, pred(heute) - (tage[heute] ?? 0));
    const zuk: number[] = []; for (let q = 1; q <= 7; q++) { const y = plusTage(heute, q); if (temps[y] != null) zuk.push(pred(y)); }
    const fern = zuk.length ? zuk.reduce((s, v) => s + v, 0) / zuk.length : mittelTag;
    for (let n = 1; n <= 120 && rest > 0; n++) { const y = plusTage(heute, n); rest -= temps[y] != null ? pred(y) : fern; if (rest <= 0) { tageBis = n; break; } } }
  const quelle = `${kaps.length} Leerung${kaps.length === 1 ? "" : "en"}`;
  console.log(`Asche: ${pct.toFixed(0)} % (${(seit / 60).toFixed(1)} h von ${(kap / 60).toFixed(0)} h Brennzeit, ${quelle}), voll in ${tageBis ?? ">120"} Tagen`);
  if (tageBis === null || tageBis > ASCHE_VORLAUF) return null;
  const wann = tageBis === 1 ? "morgen" : `in ${tageBis} Tagen`;
  return `Aschebox: ca. ${Math.min(999, pct).toFixed(0)} % – ${tageBis === 0 ? "jetzt leeren" : "voll " + wann} (Brennzeit pro Leerung ${(kap / 60).toFixed(0)} h aus ${quelle})`;
}

// Aktuelle Probleme: id -> Beschreibung (alt: Stand des letzten Laufs, fuer Pruefungen, die einmal nicht rechnen koennen)
async function pruefen(alt: Status): Promise<Record<string, string>> {
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
      if (k.id === "heizung" && f.length && !(alter > k.maxMin)) {   // field1 = Kessel oben, letzter gueltiger Wert
        let ko: number | null = null;
        for (const x of f) { const v = parseFloat(x.field1); if (isFinite(v) && v > 0 && v < 150) ko = v; }
        if (ko !== null && ko < KESSEL_MIN) p.kessel = `Heizung: Kessel oben nur ${ko.toFixed(1)} °C (unter ${KESSEL_MIN} °C, Kanal 172428, Feld 1)`;
      }
      if (k.id === "pumpwerk" && f.length) {   // field6 = Stoerung aktiv (1 = Kontakt offen), letzter gueltiger Wert
        let st: number | null = null;
        for (const x of f) { const v = parseFloat(x.field6); if (isFinite(v)) st = v; }
        if (st !== null && st >= 0.5) p.pumpwerkStoerung = "Pumpwerk: Störung gemeldet (Kontakt offen, Kanal 3484334, Feld 6)";
      }
    } catch (e) {
      p[k.id] = `${k.name}: Kanal ${k.kanal} nicht abrufbar (${e})`;
    }
  }
  // Morgenprognose: ab 07:00 muss die von heute da sein und um 06:xx entstanden sein
  if (heute.h >= 7) {
    try {
      const r = await fetch(PROGNOSE_URL);
      const pr = await r.json();
      if (!r.ok || pr.datum !== heute.datum) p.prognose = `PV-Morgenprognose: keine Prognose für heute (${pr.fehler ?? "HTTP " + r.status})`;
      else if (lokal(Date.parse(pr.erstellt)).h !== 6) {
        p.prognose = `PV-Morgenprognose: erst um ${zeit(Date.parse(pr.erstellt))} erstellt statt 06:00 (Cron morgens.ts prüfen)`;
      }
    } catch (e) {
      p.prognose = `PV-Morgenprognose: nicht abrufbar (${e})`;
    }
  }
  // Schnitzel-Bunker: nur in der Heizsaison; ein Fehler hier ist keine Stoerung der Anlage (nur Log). Kann einmal nicht
  // gerechnet werden, bleibt ein schon gemeldeter Hinweis stehen (sonst kaeme faelschlich "wieder in Ordnung")
  // Gleiches fuer die Aschebox
  if (HEIZSAISON.includes(heute.monat)) {
    const hinweis = async (id: string, name: string, f: (h: string) => Promise<string | null | undefined>) => {
      let t: string | null | undefined;
      try { t = await f(heute.datum); } catch (e) { console.log(`${name}: nicht berechnet (${e})`); t = undefined; }
      if (t) p[id] = t; else if (t === undefined && alt.probleme[id]) p[id] = alt.probleme[id];
    };
    await hinweis("schnitzel", "Schnitzel", schnitzelPruefen);
    await hinweis("asche", "Asche", aschePruefen);
  }
  return p;
}

export default async function (_interval: unknown) {
  tagCache.clear(); wetterCache = null;   // falls die Laufzeit warm bleibt: jeder Lauf holt frisch
  const alt = ((await blob.getJSON(STATUS_KEY).catch(() => undefined)) as Status | undefined) ??
    { probleme: {}, verdacht: [], gemeldet: 0 };
  const aktuell = await pruefen(alt);

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
    // Stoerungen und Hinweise (Aschebox leeren, Bunker auffuellen) getrennt auflisten
    const stoer = Object.keys(bestaetigt).filter((id) => !(id in HINWEISE)), hinw = Object.keys(bestaetigt).filter((id) => id in HINWEISE);
    const zeile = (id: string) => `- ${bestaetigt[id]}${neu.includes(id) ? "  (neu)" : ""}`;
    if (stoer.length) z.push("Aktuelle Störungen:", ...stoer.map(zeile), "");
    if (hinw.length) z.push(hinw.length > 1 ? "Hinweise:" : "Hinweis:", ...hinw.map(zeile), "");
    const erledigt = behoben.filter((id) => id in HINWEISE), wieder = behoben.filter((id) => !(id in HINWEISE));
    if (wieder.length) z.push("Wieder in Ordnung:", ...wieder.map((id) => `- ${alt.probleme[id]}`), "");
    if (erledigt.length) z.push("Erledigt:", ...erledigt.map((id) => `- ${alt.probleme[id]}`), "");
    z.push(`Dashboard: ${DASHBOARD}`, "", "– Zuhause-Wächter (Val Town)");
    const erin = erinnern && !neu.length ? " (Erinnerung)" : "";
    // "🪣 Aschebox leeren" -> Symbol vorne, Text hinter "Zuhause:"
    const hText = hinw.map((id) => HINWEISE[id].replace(/^\S+ /, "")).join(" und ");
    const subject = stoer.length
      ? `⚠ Zuhause: ${stoer.length} Störung${stoer.length > 1 ? "en" : ""}${hinw.length ? " · " + hText : ""}${erin}`
      : hinw.length
      ? `${HINWEISE[hinw[0]].split(" ")[0]} Zuhause: ${hText}${erin}`
      : wieder.length
      ? "✅ Zuhause: wieder alles in Ordnung"
      : `✅ Zuhause: ${erledigt.map((id) => HINWEISE[id].replace(/^\S+ /, "")).join(" und ")} erledigt`;
    await email({ subject, text: z.join("\n") });
    gemeldet = Date.now();
    console.log(`E-Mail: ${subject}`);
  }
  console.log(Object.keys(aktuell).length ? `Probleme: ${Object.values(aktuell).join(" | ")}` : "alles in Ordnung");
  await blob.setJSON(STATUS_KEY, { probleme: bestaetigt, verdacht: Object.keys(aktuell), gemeldet } satisfies Status);
}
