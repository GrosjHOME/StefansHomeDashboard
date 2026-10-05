package ch.grosjhome.zuhause

import android.content.Context
import org.json.JSONArray
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.ZonedDateTime
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * "Wie viele Geraete duerfen jetzt laufen?" - dieselbe Rechnung wie die Heute-Karte im
 * Dashboard-Tab Nutzung (PLANNER in dashboard/index.html, "Jetzt: n von 3 gleichzeitig").
 * Geraete, Grundlast und Boiler-Referenz dort und hier gleich halten.
 */
object Planer {
    private class Geraet(val h: Double, val peakKw: Double, val kwh: Double)

    // Eco-Programme: Laufdauer h, Spitzenleistung kW, Energie je Durchgang kWh
    private val GERAETE = listOf(
        Geraet(3.0, 2.0, 0.7),     // Waschmaschine
        Geraet(3.5, 2.0, 0.85),    // Geschirrspueler
        Geraet(3.0, 0.9, 1.45)     // Tumbler
    )
    private val GRUNDLAST = doubleArrayOf(0.7, 0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.65, 0.7)   // kW je Monat
    private val BOILER_KWH = doubleArrayOf(8.7, 5.5, 6.7, 6.9, 7.3, 5.8, 5.0, 7.3, 6.6, 6.4, 8.5, 7.5) // kWh/Tag je Monat
    private const val NOWCAST_MAX = 1.3
    private const val PV_KANAL = 172430
    private val ZONE = ZoneId.of("Europe/Zurich")

    /** jetzt = gleichzeitig moeglich, heute = Geraete, die heute noch ins Solarfenster passen. */
    class Ergebnis(val jetzt: Int, val heute: Int, val von: Int, val freiKw: Double)

    private fun omUrl(zeitraum: String) =
        "https://api.open-meteo.com/v1/forecast?latitude=46.966&longitude=7.742" +
                "&hourly=global_tilted_irradiance&tilt=60&azimuth=0&$zeitraum&timezone=Europe%2FZurich"

    /**
     * Einstrahlung auf die geneigte Flaeche: "YYYY-MM-DDTHH" (Ortszeit, Stundenbeginn) -> W/m².
     * Open-Meteo-Strahlung ist das Mittel der VORANGEHENDEN Stunde (Stempel 13:00 = 12-13 Uhr),
     * daher gehoert Wert i+1 zur Stunde, die bei Stempel i beginnt - wie die ThingSpeak-Stundenmittel.
     */
    private fun gti(url: String): Map<String, Double> {
        val h = Daten.json(url).getJSONObject("hourly")
        val t = h.getJSONArray("time")
        val g = h.getJSONArray("global_tilted_irradiance")
        val m = HashMap<String, Double>()
        for (i in 0 until t.length() - 1) if (!g.isNull(i + 1)) m[t.getString(i).take(13)] = g.getDouble(i + 1)
        return m
    }

    private val UTC_STEMPEL = DateTimeFormatter.ofPattern("yyyy-MM-dd'%20'HH:mm:ss").withZone(ZoneOffset.UTC)

    private fun stundenmittel(kanal: Int, tage: Int, key: String? = null): JSONArray =
        Daten.feeds(kanal, "days=$tage&average=60&timezone=Europe/Zurich", key)

    /** Werte eines Feldes je Stunde des Tages `datum` (YYYY-MM-DD). */
    private fun stunden(f: JSONArray, feld: String, datum: String): Map<Int, Double> {
        val m = HashMap<Int, Double>()
        for (i in 0 until f.length()) {
            val x = f.getJSONObject(i)
            val k = x.getString("created_at")
            if (!k.startsWith(datum)) continue
            val v = x.optString(feld, "").toDoubleOrNull() ?: continue
            m[k.substring(11, 13).toInt()] = v
        }
        return m
    }

    /**
     * Kalibrierung pro Tagesstunde: Median(Ist-Leistung / Einstrahlung) der letzten 14 Tage -
     * bildet die Horizont-Verschattung im Tal ab. Aendert sich kaum, daher 6 h zwischengespeichert.
     */
    private fun faktoren(ctx: Context): DoubleArray {
        val p = ctx.getSharedPreferences("planer", Context.MODE_PRIVATE)
        val alt = p.getString("faktoren_v2", null)
        if (alt != null && System.currentTimeMillis() - p.getLong("faktoren_v2_zeit", 0) < 6 * 3_600_000L)
            return alt.split(",").map { it.toDouble() }.toDoubleArray()

        val g = gti(omUrl("past_days=14&forecast_days=0"))
        // ThingSpeak mittelt hoechstens ~8000 Rohwerte (~8 Tage) -> drei 5-Tage-Fenster (UTC)
        val jetzt = System.currentTimeMillis()
        val tag = 86_400_000L
        val fenster = (0 until 3).map { k ->
            val ende = jetzt - k * 5 * tag
            Daten.feeds(PV_KANAL, "average=60&start=" + UTC_STEMPEL.format(Instant.ofEpochMilli(ende - 5 * tag)) +
                    "&end=" + UTC_STEMPEL.format(Instant.ofEpochMilli(ende)), Daten.PV_READ_KEY)
        }
        val proStunde = Array(24) { ArrayList<Double>() }
        for (ist in fenster) for (i in 0 until ist.length()) {
            val x = ist.getJSONObject(i)
            val lokal = Instant.parse(x.getString("created_at")).atZone(ZONE)   // created_at in UTC
            val e = g[lokal.toLocalDateTime().toString().take(13)] ?: continue
            if (e < 40) continue
            val a = x.optString("field1", "").toDoubleOrNull() ?: continue
            proStunde[lokal.hour].add((a / 1000) / (e / 1000))
        }
        val f = DoubleArray(24) { h -> proStunde[h].sorted().let { if (it.isEmpty()) 0.0 else it[it.size / 2] } }
        if (f.none { it > 0 }) for (h in 8..17) f[h] = 25.0   // Rueckfall ohne Ist-Daten
        p.edit().putString("faktoren_v2", f.joinToString(",")).putLong("faktoren_v2_zeit", System.currentTimeMillis()).apply()
        return f
    }

    /** pvKw = aktuelle PV-Leistung, boilerKw/autoKw = aktuelle Ladeleistungen (Vorrang). */
    fun rechne(ctx: Context, pvKw: Double?, boilerKw: Double, autoKw: Double): Ergebnis {
        val f = faktoren(ctx)
        val jetzt = ZonedDateTime.now(ZONE)
        val heute = jetzt.toLocalDate().toString()
        val nowH = jetzt.hour
        val monat = jetzt.monthValue - 1
        val g = gti(omUrl("forecast_days=1"))
        val prog = DoubleArray(24) { h -> (g[heute + "T" + h.toString().padStart(2, '0')] ?: 0.0) / 1000 * f[h] }
        val ist = stunden(stundenmittel(PV_KANAL, 1, Daten.PV_READ_KEY), "field1", heute).mapValues { it.value / 1000 }
        val boilerIst = stunden(stundenmittel(502977, 1), "field3", heute)

        // Nowcast: Restprognose x (Ist / Prognose bis jetzt), ersatzweise Momentanleistung
        var scale = 1.0
        var aSum = 0.0
        var fSum = 0.0
        for (h in 0 until nowH) { val a = ist[h]; if (prog[h] > 0.3 && a != null) { aSum += a; fSum += prog[h] } }
        if (fSum > 1) scale = min(aSum / fSum, NOWCAST_MAX)
        else if (pvKw != null && prog[nowH] > 0.3) scale = min(pvKw / prog[nowH], NOWCAST_MAX)

        fun effKw(h: Int): Double = when {
            h < nowH -> ist[h] ?: (prog[h] * scale)
            h == nowH && pvKw != null -> pvKw
            else -> prog[h] * scale
        }
        val base = GRUNDLAST[monat]
        val last = boilerKw + autoKw
        fun effSur(h: Int) = max(0.0, effKw(h) - base - (if (h == nowH) last else 0.0))

        // Rest-Ueberschuss heute, abzueglich der noch kommenden Boiler-Ladung
        val boilerRef = BOILER_KWH[monat].roundToInt()
        val boilerHeute = boilerIst.values.sumOf { max(0.0, it) / 1000 }.roundToInt()
        val sur = max(0, (nowH..23).sumOf { effSur(it) }.roundToInt() - max(0, boilerRef - boilerHeute))
        val frei = (pvKw ?: (prog[nowH] * scale)) - base - last

        // Geraet geht heute noch, wenn das Solarfenster (Stunden mit >= 1 kW) die Laufzeit fasst
        val q = (nowH..23).filter { effSur(it) >= 1 }
        val moeglich = GERAETE.filter { d -> q.isNotEmpty() && sur >= d.kwh && (q.last() + 1 - q.first()) >= d.h }
        // gleichzeitig: kleinste Spitzenleistung zuerst -> maximale Anzahl
        var rest = frei
        var n = 0
        for (kw in moeglich.map { it.peakKw }.sorted()) if (rest >= kw) { n++; rest -= kw }
        return Ergebnis(n, moeglich.size, GERAETE.size, frei)
    }
}
