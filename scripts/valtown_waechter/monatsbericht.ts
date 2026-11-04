// Monatsbericht per E-Mail (Val Town, Val "GrosjeansHomeDashboard", Datei monatsbericht.ts, Trigger: Cron taeglich, z. B. 07:10).
// Am 1. eines Monats (bis zum 5. nachgeholt, falls ein Lauf ausfaellt) kommt eine Mail mit dem Vormonat:
//  - PV-Ertrag (Monatszaehler der PV-Steuerung, Feld 3) gegen den gleichen Monat im Vorjahr
//  - Laden: kWh ins Auto, davon PV - wie "PV-Anteil am Laden" im Dashboard (Ueberschuss = PV - Boiler - Reserve, Wallbox Feld 3)
//  - Boiler: kWh fuers Warmwasser, davon PV - wie "PV-Anteil Boiler" (vom PV-Strom geht die Hausreserve der Wallbox ab)
//  - Heizung: Heizzyklen, Gluterhaltung, Brennzeit, Heizgradtage, Brennzeit und Heizzyklen je Heizgradtag, Asche-Leerungen und
//    Bunker-Auffuellungen (Blobs von heizung.ts)
//  - Pumpwerk: Einschaltungen, Laufzeit, Nachtstarts (0-5 Uhr), Minuten mit Stoerung (braucht PUMPWERK_READ_KEY)
// Rechnungen aus waechter.ts (gleiches Val). Gesendet wird einmal je Monat (Blob "monatsbericht_gesendet").
// Zum Ausprobieren: Umgebungsvariable MONATSBERICHT_TEST=1 schickt den Bericht des Vormonats bei jedem Lauf (ohne zu merken).
// std/email schickt nur an die Adresse des Val-Town-Kontos - im Code steht keine Adresse.

import { blob } from "https://esm.town/v/std/blob/main.ts";
import { email } from "https://esm.town/v/std/email";   // ohne /main.ts (sonst 404)
import { DASHBOARD, PV_READ_KEY, PUMPWERK_READ_KEY, lokal, hgt, plusTage, tagBeginn, tsStempel, heizPhasen, pwSumme } from "./waechter.ts";

const KEY_GESENDET = "monatsbericht_gesendet";
const LAT = 46.966, LON = 7.742;
const KANAL = { PV: 172430, WALLBOX: 172228, BOILER: 502977, HEIZUNG: 172428, PUMPWERK: 3484334 };
const FENSTER_TAGE = 5;   // je Abfrage hoechstens 5 Tage (ThingSpeak liefert hoechstens 8000 Eintraege, minuetlich ~7200)
const MONAT = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const zahl = (v: number, d = 0) => v.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
const prozent = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

// Alle Eintraege eines Kanals von..bis (ms), in Fenstern, ohne doppelte an den Grenzen
async function feedsBereich(kanal: number, von: number, bis: number, key?: string): Promise<any[]> {
  const out: any[] = [], seen = new Set<number>();
  for (let s = von; s < bis; s += FENSTER_TAGE * 864e5) {
    const e = Math.min(s + FENSTER_TAGE * 864e5, bis);
    const r = await fetch(`https://api.thingspeak.com/channels/${kanal}/feeds.json?results=8000&start=${encodeURIComponent(tsStempel(s))}&end=${encodeURIComponent(tsStempel(e))}` + (key ? `&api_key=${key}` : ""));
    if (!r.ok) throw new Error(`Kanal ${kanal}: HTTP ${r.status}`);
    for (const x of ((await r.json()).feeds ?? []) as any[]) if (!seen.has(x.entry_id)) { seen.add(x.entry_id); out.push(x); }
  }
  return out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
const zahlOderNull = (v: any) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
// letzter Wert eines Feldes bis t (Stufe halten, hoechstens 15 min alt)
function halter(f: any[], feld: string) { let i = 0, last: { t: number; v: number } | null = null;
  return (t: number) => { while (i < f.length && Date.parse(f[i].created_at) <= t) { const v = zahlOderNull(f[i][feld]); if (v !== null) last = { t: Date.parse(f[i].created_at), v }; i++; }
    return last && t - last.t < 15 * 60000 ? last.v : null; }; }

// PV-Monatsertrag: Feld 3 (Monatszaehler) des letzten Eintrags im Monat
async function pvMonat(jahr: number, m0: number): Promise<number | null> {
  const ende = tagBeginn(`${m0 === 11 ? jahr + 1 : jahr}-${String(m0 === 11 ? 1 : m0 + 2).padStart(2, "0")}-01`) - 1000;
  const r = await fetch(`https://api.thingspeak.com/channels/${KANAL.PV}/feeds.json?results=1&api_key=${PV_READ_KEY}&end=${encodeURIComponent(tsStempel(ende))}`);
  if (!r.ok) return null;
  const f = ((await r.json()).feeds ?? []) as any[]; const v = f.length ? zahlOderNull(f[f.length - 1].field3) : null;
  return v !== null && v >= 1 ? v : null;   // unter 1 kWh = Zaehler nach dem Reset, kein Monatswert
}

// Laden und Boiler: kWh und PV-Anteil (Trapez je Minute, Luecken unter 2 h), gleiche Schaetzung wie im Dashboard
function ladenUndBoiler(wb: any[], pv: any[], bo: any[]) {
  const pvAt = halter(pv, "field1"), boAt = halter(bo, "field3");
  let auto = 0, autoPv = 0, prev: { t: number; c: number; p: number } | null = null, vorgaenge = 0, angeschlossen = false;
  for (const x of wb) { const t = Date.parse(x.created_at), c0 = zahlOderNull(x.field4); const st = Math.round(zahlOderNull(x.field8) ?? 0);
    const an = st === 66 || st === 67; if (an && !angeschlossen) vorgaenge++; angeschlossen = an;
    if (c0 === null) continue; const c = Math.max(0, c0 / 1e6);   // kW (field4 in mW)
    const f3 = zahlOderNull(x.field3), pvW = pvAt(t), boW = Math.max(0, boAt(t) ?? 0);
    const ueb = pvW !== null ? (f3 !== null ? Math.min(f3, pvW - boW) : pvW - boW) : (f3 ?? 0);
    const p = { t, c, p: Math.min(c, Math.max(0, ueb / 1000)) };
    if (prev) { const dt = (t - prev.t) / 36e5; if (dt > 0 && dt < 2) { auto += (prev.c + p.c) / 2 * dt; autoPv += (prev.p + p.p) / 2 * dt; } }
    prev = p; }
  const pvAt2 = halter(pv, "field1"), wbAt = halter(wb, "field3");
  let boiler = 0, boilerPv = 0, prevB: { t: number; c: number; p: number } | null = null;
  for (const x of bo) { const t = Date.parse(x.created_at), c0 = zahlOderNull(x.field3); if (c0 === null) continue; const c = Math.max(0, c0) / 1000;
    const pvW = pvAt2(t) ?? 0, f3 = wbAt(t), res = f3 !== null ? Math.max(0, pvW - c * 1000 - f3) : 0;
    const p = { t, c, p: Math.min(c, Math.max(0, pvW - res) / 1000) };
    if (prevB) { const dt = (t - prevB.t) / 36e5; if (dt > 0 && dt < 2) { boiler += (prevB.c + p.c) / 2 * dt; boilerPv += (prevB.p + p.p) / 2 * dt; } }
    prevB = p; }
  return { auto, autoPv, vorgaenge, boiler, boilerPv };
}

// Tagesmittel der Aussentemperatur fuer den Monat (Prognose-API mit past_days, das Archiv hinkt ~5 Tage nach)
async function temperaturen(): Promise<Record<string, number>> {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=temperature_2m_mean&past_days=40&forecast_days=1&timezone=Europe%2FZurich`);
  const om = await r.json(); const o: Record<string, number> = {};
  (om?.daily?.time ?? []).forEach((t: string, i: number) => { const v = om.daily.temperature_2m_mean[i]; if (v != null) o[t] = v; });
  return o;
}

export async function bericht(jahr: number, m0: number): Promise<{ subject: string; text: string }> {
  const mm = String(m0 + 1).padStart(2, "0"), von1 = `${jahr}-${mm}-01`, naechst = m0 === 11 ? `${jahr + 1}-01-01` : `${jahr}-${String(m0 + 2).padStart(2, "0")}-01`;
  const von = tagBeginn(von1), bis = tagBeginn(naechst), tage: string[] = [];
  for (let y = von1; y < naechst; y = plusTage(y, 1)) tage.push(y);
  const name = `${MONAT[m0]} ${jahr}`, z: string[] = [`Monatsbericht ${name}`, ""];
  const fehler: string[] = [];
  const sicher = async <T>(was: string, f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { fehler.push(`${was}: ${e}`); return null; } };

  // PV
  const pv = await sicher("PV", () => pvMonat(jahr, m0)), pvVj = await sicher("PV Vorjahr", () => pvMonat(jahr - 1, m0));
  if (pv !== null) z.push(`☀️ PV-Anlage: ${zahl(pv)} kWh` + (pvVj ? ` (${MONAT[m0]} ${jahr - 1}: ${zahl(pvVj)} kWh, ${pv >= pvVj ? "+" : "−"}${zahl(Math.abs(Math.round((pv / pvVj - 1) * 100)))} %)` : ""));

  // Laden und Boiler
  const lb = await sicher("Laden/Boiler", async () => {
    const pvF = await feedsBereich(KANAL.PV, von, bis, PV_READ_KEY), wbF = await feedsBereich(KANAL.WALLBOX, von, bis), boF = await feedsBereich(KANAL.BOILER, von, bis);
    return ladenUndBoiler(wbF, pvF, boF); });
  if (lb) {
    const pa = prozent(lb.autoPv, lb.auto), pb = prozent(lb.boilerPv, lb.boiler);
    z.push(`🚗 Laden: ${zahl(lb.auto)} kWh` + (lb.auto >= 0.5 ? `, davon ${zahl(lb.autoPv)} kWh aus PV (${pa} %)` : "") + (lb.vorgaenge ? ` · ${lb.vorgaenge} Mal eingesteckt` : ""));
    z.push(`💧 Boiler: ${zahl(lb.boiler)} kWh` + (lb.boiler >= 0.5 ? `, davon ${zahl(lb.boilerPv)} kWh aus PV (${pb} %)` : "") + ` · Ø ${zahl(lb.boiler / tage.length, 1)} kWh je Tag`);
  }

  // Heizung (nur wenn im Monat gebrannt wurde)
  const hz = await sicher("Heizung", async () => {
    const f = await feedsBereich(KANAL.HEIZUNG, von, bis); if (!f.length) return null;
    const ph = heizPhasen(f), temps = await temperaturen().catch(() => ({} as Record<string, number>));
    let hg = 0, zt = 0, bt = 0; const jeTag: Record<string, { z: number; b: number }> = {};
    for (const p of ph) { const y = lokal(p.s).datum; (jeTag[y] = jeTag[y] || { z: 0, b: 0 }); if (p.voll) jeTag[y].z++; jeTag[y].b += (p.e - p.s) / 60000; }
    for (const y of tage) if (temps[y] != null) { hg += hgt(temps[y]); zt += jeTag[y]?.z ?? 0; bt += jeTag[y]?.b ?? 0; }
    return { zyk: ph.filter((p) => p.voll).length, glut: ph.filter((p) => !p.voll).length, brenn: ph.reduce((s, p) => s + (p.e - p.s) / 60000, 0), hg, zt, bt }; });
  if (hz && hz.brenn > 0) {
    z.push(`🔥 Heizung: ${zahl(hz.zyk)} Heizzyklen (Ø ${zahl(hz.zyk / tage.length, 1)} je Tag), ${zahl(hz.glut)} Gluterhaltung, Brennzeit ${zahl(hz.brenn / 60, 0)} h`);
    if (hz.hg >= 10) z.push(`   ${zahl(hz.hg)} Heizgradtage · ${zahl(hz.bt / hz.hg, 1)} min Brennzeit und ${zahl(hz.zt / hz.hg, 2)} Heizzyklen je Heizgradtag`);
  }
  const imMonat = (iso: string) => { const t = Date.parse(iso); return isFinite(t) && t >= von && t < bis; };
  const ad = (await blob.getJSON("asche_leerungen").catch(() => null)) as any, sd = (await blob.getJSON("schnitzel_daten").catch(() => null)) as any;
  const leer = ((ad?.leerungen ?? []) as string[]).filter(imMonat).length, auf = ((sd?.auffuellungen ?? []) as string[]).filter(imMonat);
  if (leer || auf.length) z.push(`   Asche: ${leer} Leerung${leer === 1 ? "" : "en"} · Schnitzel-Bunker: ${auf.length} Auffüllung${auf.length === 1 ? "" : "en"}` +
    (auf.length ? ` (${zahl(auf.reduce((s, x) => s + 20 * (1 - (+(sd?.rest?.[x] ?? 0)) / 100), 0))} m³)` : ""));

  // Pumpwerk
  if (PUMPWERK_READ_KEY) {
    const pw = await sicher("Pumpwerk", async () => {
      const f = await feedsBereich(KANAL.PUMPWERK, von, bis, PUMPWERK_READ_KEY); if (!f.length) return null;
      const nacht = f.filter((x) => lokal(Date.parse(x.created_at)).h < 5);
      // Nachtstarts je Nacht getrennt (die Zaehler springen um Mitternacht auf 0)
      let ns = 0; const jeNacht: Record<string, any[]> = {}; for (const x of nacht) (jeNacht[lokal(Date.parse(x.created_at)).datum] ||= []).push(x);
      for (const k of Object.keys(jeNacht)) ns += pwSumme(jeNacht[k]).starts;
      const st = f.filter((x) => (zahlOderNull(x.field6) ?? 0) >= 0.5).length;
      return { ...pwSumme(f), nacht: ns, stoerMin: st }; });
    if (pw) z.push(`🚰 Pumpwerk: ${zahl(pw.starts)} Einschaltungen (Ø ${zahl(pw.starts / tage.length, 1)} je Tag), ${zahl(pw.sec / 3600, 1)} h Laufzeit` +
      (pw.starts ? `, Ø ${zahl(pw.sec / pw.starts)} s je Start` : "") + ` · ${pw.nacht} Nachtstarts (0–5 Uhr)` + (pw.stoerMin ? ` · Störung ${pw.stoerMin} min` : ""));
  }
  if (z.length <= 2) z.push("Keine Daten für diesen Monat.");
  if (fehler.length) z.push("", "Nicht berechnet:", ...fehler.map((f) => "- " + f));
  z.push("", `Dashboard: ${DASHBOARD}`, "", "– Zuhause-Monatsbericht (Val Town)");
  return { subject: `📊 Zuhause: Monatsbericht ${name}`, text: z.join("\n") };
}

export default async function (_interval: unknown) {
  const heute = lokal(Date.now()), j = +heute.datum.slice(0, 4), m = +heute.datum.slice(5, 7) - 1, tag = +heute.datum.slice(8, 10);
  const vj = m === 0 ? j - 1 : j, vm = m === 0 ? 11 : m - 1, schluessel = `${vj}-${String(vm + 1).padStart(2, "0")}`;
  const test = (Deno.env.get("MONATSBERICHT_TEST") || "").trim() === "1";
  const gesendet = (await blob.getJSON(KEY_GESENDET).catch(() => null)) as string | null;
  if (!test && (tag > 5 || gesendet === schluessel)) { console.log(`Monatsbericht ${schluessel}: ${gesendet === schluessel ? "schon gesendet" : "nur am 1.–5. des Monats"}`); return; }
  const b = await bericht(vj, vm);
  await email(b);
  if (!test) await blob.setJSON(KEY_GESENDET, schluessel);
  console.log(`E-Mail: ${b.subject}\n${b.text}`);
}
