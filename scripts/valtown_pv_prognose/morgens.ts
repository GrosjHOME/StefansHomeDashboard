// PV-Morgenprognose: rechnet um 05:00 Ortszeit die Prognose des Tages (Val Town, Val
// "grosjeansHomeDashboard", Datei morgens.ts, Trigger: Cron). Logik und Abruf: prognose.ts.
//
// Cron-Ausdruck (UTC!): 0 3-7 * * *  -> stuendlich 03-07 UTC = 05:00 Sommerzeit bzw. 05:00
// Winterzeit beim ersten Lauf ab 05:00 Ortszeit. Die weiteren Laeufe tun nichts, solange die
// Prognose schon gespeichert ist - sie holen sie nur nach, falls ein Lauf gescheitert ist.

import { morgenprognose } from "./prognose.ts";

export default async function (_interval: unknown) {
  const p = await morgenprognose();
  console.log(p ? `Prognose ${p.datum} vorhanden (erstellt ${p.erstellt}, ${p.tagesKwh} kWh)`
                : "vor 05:00 Ortszeit - nichts zu tun");
}
