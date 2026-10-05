package ch.grosjhome.zuhause

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
import kotlin.math.roundToInt

/** Live-Werte fuer das Widget - aus denselben ThingSpeak-Kanaelen wie das Dashboard. */
data class Werte(
    val pvKw: Double?,         // PV-Leistung (Kanal 172430, field1 in W)
    val boilerW: Double?,      // Boiler-Ladeleistung (Kanal 502977, field3 in W; 10 = wartet auf PV)
    val autoKw: Double?,       // Wallbox-Ladeleistung (Kanal 172228, field4 in µW)
    val wallbox: Int?,         // Wallbox-Status (field8: 65 getrennt, 66 laedt nicht, 67 laedt)
    val soc: Double?,          // ID.3 Ladezustand in % (Kanal 3514838, field1)
    val reichweiteKm: Double?, // ID.3 Reichweite in km (field2)
    val zeit: Long,            // Zeitpunkt des Abrufs
    val fehler: String?        // erster Fehler beim Abruf (kurz, deutsch), null = alles geladen
) {
    /** Kein einziger Kanal geladen. */
    val leer: Boolean get() = pvKw == null && boilerW == null && autoKw == null && wallbox == null && soc == null
}

object Daten {
    // Derselbe Lese-Key wie im (oeffentlichen) Dashboard; nur Lesen, kein Schreiben.
    private const val PV_READ_KEY = "6GIAGINL9VN4CTL8"

    private fun feeds(kanal: Int, anzahl: Int, key: String? = null): JSONArray {
        val url = "https://api.thingspeak.com/channels/$kanal/feeds.json?results=$anzahl" +
                (if (key != null) "&api_key=$key" else "")
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 10_000
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            val text = c.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(text).getJSONArray("feeds")
        } finally {
            c.disconnect()
        }
    }

    /** Letzter vorhandene Wert eines Feldes - nicht jeder Eintrag enthaelt alle Felder. */
    private fun letzter(f: JSONArray?, feld: String): Double? {
        if (f == null) return null
        for (i in f.length() - 1 downTo 0) {
            f.getJSONObject(i).optString(feld, "").toDoubleOrNull()?.let { return it }
        }
        return null
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
    fun laden(): Werte {
        var fehler: String? = null
        fun hole(kanal: Int, anzahl: Int, key: String? = null): JSONArray? =
            try { feeds(kanal, anzahl, key) } catch (e: Exception) { if (fehler == null) fehler = kurz(e); null }

        val pv = hole(172430, 3, PV_READ_KEY)
        val boiler = hole(502977, 3)
        val wallbox = hole(172228, 10)   // stuendlich kommt ein Eintrag nur mit field1 -> mehrere holen
        val auto = hole(3514838, 3)
        return Werte(
            pvKw = letzter(pv, "field1")?.div(1000),
            boilerW = letzter(boiler, "field3"),
            autoKw = letzter(wallbox, "field4")?.times(1e-6),
            wallbox = letzter(wallbox, "field8")?.roundToInt(),
            soc = letzter(auto, "field1"),
            reichweiteKm = letzter(auto, "field2"),
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

    fun id3(soc: Double?, km: Double?): String =
        if (soc == null) "–"
        else "${soc.roundToInt()} %" + (if (km != null) " · ${km.roundToInt()} km" else "")
}
