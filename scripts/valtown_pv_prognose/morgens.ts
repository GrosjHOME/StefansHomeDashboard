// PV-Morgenprognose: rechnet um 06:00 Ortszeit die Prognose des Tages (Val Town, Val
// "GrosjeansHomeDashboard", Datei morgens.ts, Trigger: Cron). Logik und Abruf: prognose.ts.
//
// Cron-Ausdruck (UTC!): 0 4-8 * * *  -> stuendlich 04-08 UTC = 06:00 Sommerzeit bzw. 06:00
// Winterzeit beim ersten Lauf ab 06:00 Ortszeit. Die weiteren Laeufe tun nichts, solange die
// Prognose schon gespeichert ist - sie holen sie nur nach, falls ein Lauf gescheitert ist.

import { morgenprognose } from "./prognose.ts";

export default async function (_interval: unknown) {
  const p = await morgenprognose();
  console.log(p ? `Prognose ${p.datum} vorhanden (erstellt ${p.erstellt}, ${p.tagesKwh} kWh)`
                : "vor 06:00 Ortszeit - nichts zu tun");
}
