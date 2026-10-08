package ch.grosjhome.zuhause

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.Locale
import javax.net.ssl.SSLException
import kotlin.math.max
import kotlin.math.roundToInt

/** Live-Werte fuer das Widget - aus denselben ThingSpeak-Kanaelen wie das Dashboard. */
data class Werte(
    val pvKw: Double?,         // PV-Leistung (Kanal 172430, field1 in W)
    val boilerW: Double?,      // Boiler-Ladeleistung (Kanal 502977, field3 in W; 10 = wartet auf PV)
    val autoKw: Double?,       // Wallbox-Ladeleistung (Kanal 172228, field4 in µW)
    val wallbox: Int?,         // Wallbox-Status (field8: 65 getrennt, 66 laedt nicht, 67 laedt)
    val soc: Double?,          // ID.3 Ladezustand in % (Kanal 3514838, field1)
    val reichweiteKm: Double?, // ID.3 Reichweite in km (field2)
    val zielSoc: Double?,      // ID.3 Soll-Ladezustand in % (field4, in der App eingestellt)
    val kesselC: Double?,      // Kessel oben in °C (Kanal 172428, field1) - nur waehrend der Heizsaison, sonst null
    val fuellstand: Double?,   // Holzschnitzel-Fuellstand in % (field4), dito
    val brennt: Boolean,       // Feuer brennt: Abgas mehr als 30 K ueber Kessel oben (wie die Brennphase im Dashboard)
    val geraete: Planer.Ergebnis?, // wie viele Geraete jetzt laufen duerfen (null = Prognose fehlt)
    val zeit: Long,            // Zeitpunkt des Abrufs
    val fehler: String?        // erster Fehler beim Abruf (kurz, deutsch), null = alles geladen
) {
    /** Kein einziger Kanal geladen. */
    val leer: Boolean get() = pvKw == null && boilerW == null && autoKw == null && wallbox == null && soc == null
}

object Daten {
    // Derselbe Lese-Key wie im (oeffentlichen) Dashboard; nur Lesen, kein Schreiben.
    const val PV_READ_KEY = "6GIAGINL9VN4CTL8"

    fun json(url: String): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        } finally {
            c.disconnect()
        }
    }

    /** ThingSpeak-Feeds eines Kanals, abfrage z. B. "results=3" oder "days=1&average=60&...". */
    fun feeds(kanal: Int, abfrage: String, key: String? = null): JSONArray =
        json("https://api.thingspeak.com/channels/$kanal/feeds.json?$abfrage" +
                (if (key != null) "&api_key=$key" else "")).getJSONArray("feeds")

    /** Letzter vorhandene Wert eines Feldes - nicht jeder Eintrag enthaelt alle Felder. */
    private fun letzter(f: JSONArray?, feld: String, ok: (Double) -> Boolean = { true }): Double? {
        if (f == null) return null
        for (i in f.length() - 1 downTo 0) {
            f.getJSONObject(i).optString(feld, "").toDoubleOrNull()?.let { if (ok(it)) return it }
        }
        return null
    }

    /** Brennt das Feuer? Neuester Eintrag mit gueltigem Kessel (field1) und Abgas (field8): Abgas - Kessel > 30 K. */
    private fun brennt(f: JSONArray?): Boolean {
        if (f == null) return false
        for (i in f.length() - 1 downTo 0) {
            val o = f.getJSONObject(i)
            val k = o.optString("field1", "").toDoubleOrNull()?.takeIf { it > 0 && it < 150 }
            val a = o.optString("field8", "").toDoubleOrNull()?.takeIf { it > -100 && it < 400 }
            if (k != null && a != null) return a - k > 30
        }
        return false
    }

    /** Zeitpunkt des neuesten Eintrags in ms (ThingSpeak: ISO-8601 in UTC), null wenn keiner da ist. */
    private fun letzteZeit(f: JSONArray?): Long? {
        if (f == null || f.length() == 0) return null
        return try { java.time.Instant.parse(f.getJSONObject(f.length() - 1).getString("created_at")).toEpochMilli() }
        catch (e: Exception) { null }
    }

    /** Fehler in wenigen Worten - passt in die Kopfzeile des Widgets. */
    fun kurz(e: Exception): String = when (e) {
        is UnknownHostException -> "kein Internet"
        is SocketTimeoutException -> "Zeitüberschreitung"
        is ConnectException -> "keine Verbindung"
        is SSLException -> "TLS-Fehler"
        is SecurityException -> "Internet verboten"
        else -> e.message?.takeIf { it.startsWith("HTTP") } ?: e.javaClass.simpleName
    }

    /** Jeder Kanal einzeln: faellt einer aus, bleiben die anderen Werte trotzdem sichtbar. */
    fun laden(ctx: Context): Werte {
        var fehler: String? = null
        fun hole(kanal: Int, anzahl: Int, key: String? = null): JSONArray? =
            try { feeds(kanal, "results=$anzahl", key) } catch (e: Exception) { if (fehler == null) fehler = kurz(e); null }

        val pv = hole(172430, 3, PV_READ_KEY)
        val boiler = hole(502977, 3)
        val wallbox = hole(172228, 10)   // stuendlich kommt ein Eintrag nur mit field1 -> mehrere holen
        val auto = hole(3514838, 3)
        // Heizung: der Logger sendet nur in der Heizsaison. Ist der letzte Eintrag aelter als 60 min
        // (wie die Veraltet-Warnung im Dashboard), bleibt der Platz fuer den normalen Titel.
        val heizung = hole(172428, 5)
        val heizAktuell = letzteZeit(heizung)?.let { System.currentTimeMillis() - it < 60 * 60_000L } == true
        // Lesefehler der Fuehler (0.0, -127) ueberspringen wie im Dashboard (kesselOk)
        val kesselC = if (heizAktuell) letzter(heizung, "field1") { it > 0 && it < 150 } else null
        val fuellstand = if (heizAktuell) letzter(heizung, "field4") else null
        val feuer = heizAktuell && brennt(heizung)
        val pvKw = letzter(pv, "field1")?.div(1000)
        val boilerW = letzter(boiler, "field3")
        val autoKw = letzter(wallbox, "field4")?.times(1e-6)
        val status = letzter(wallbox, "field8")?.roundToInt()
        // Geraete-Empfehlung: Boiler und Auto (nur wenn die Wallbox laedt) haben Vorrang
        val geraete = try {
            Planer.rechne(ctx, pvKw, max(0.0, (boilerW ?: 0.0) / 1000),
                if (status == 67) max(0.0, autoKw ?: 0.0) else 0.0)
        } catch (e: Exception) { null }
        return Werte(
            pvKw = pvKw,
            boilerW = boilerW,
            autoKw = autoKw,
            wallbox = status,
            soc = letzter(auto, "field1"),
            reichweiteKm = letzter(auto, "field2"),
            zielSoc = letzter(auto, "field4"),
            kesselC = kesselC,
            fuellstand = fuellstand,
            brennt = feuer,
            geraete = geraete,
            zeit = System.currentTimeMillis(),
            fehler = fehler
        )
    }

    // Anzeige-Texte (Schreibweise wie im Dashboard: Status gross, Dezimalpunkt de-CH)
    private val CH = Locale("de", "CH")

    fun kw(v: Double?): String = if (v == null) "–" else String.format(CH, "%.1f kW", v)

    fun boiler(w: Double?): String = when {
        w == null -> "–"
        w <= 0 -> "Aus"
        w < 50 -> "Wartet auf PV"        // 10 W = Signal "Laden verlangt, zu wenig PV"
        else -> kw(w / 1000)
    }

    fun auto(kwWert: Double?, status: Int?): String = when (status) {
        66 -> "Lädt nicht"
        65 -> "Getrennt"
        else -> kw(kwWert)                // 67 = laedt (oder Status unbekannt)
    }

    /** "64 → 80 % · 230 km" (Ist → Soll); ohne Soll "64 % · 230 km". */
    fun id3(soc: Double?, ziel: Double?, km: Double?): String =
        if (soc == null) "–"
        else "${soc.roundToInt()}" + (if (ziel != null) " → ${ziel.roundToInt()}" else "") + " %" + (if (km != null) " · ${km.roundToInt()} km" else "")
}
