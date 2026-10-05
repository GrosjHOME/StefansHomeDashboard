package ch.grosjhome.zuhause

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Fuellt das Widget-Layout und verdrahtet die Klicks. */
object WidgetAnsicht {
    const val DASHBOARD = "https://grosjhome.github.io/StefansHomeDashboard/dashboard/"

    private fun ids(ctx: Context): IntArray =
        AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, ZuhauseWidget::class.java))

    fun uhrzeit(ms: Long): String = SimpleDateFormat("HH:mm", Locale.GERMANY).format(Date(ms))

    fun zeige(ctx: Context, w: Werte) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_zuhause)
        v.setTextViewText(R.id.pv, Daten.kw(w.pvKw))
        v.setTextViewText(R.id.boiler, Daten.boiler(w.boilerW))
        v.setTextViewText(R.id.auto, Daten.auto(w.autoKw, w.wallbox))
        v.setTextViewText(R.id.id3, Daten.id3(w.soc, w.reichweiteKm))
        geraete(v, w.geraete)
        // Kopfzeile: Uhrzeit; bei Fehler der Grund (ganz leer) bzw. ein Hinweis (teilweise)
        v.setTextViewText(R.id.stand, when {
            w.fehler == null -> uhrzeit(w.zeit)
            w.leer -> w.fehler
            else -> uhrzeit(w.zeit) + " · unvollständig"
        })
        klicks(ctx, v)
        AppWidgetManager.getInstance(ctx).updateAppWidget(ids(ctx), v)
    }

    /** "2 von 3" - Farbe wie im Dashboard: orange (0, erst spaeter) -> gruen (alle), rot = heute keins mehr. */
    private fun geraete(v: RemoteViews, g: Planer.Ergebnis?) {
        if (g == null) {
            v.setTextViewText(R.id.geraete_zahl, "–")
            v.setTextViewText(R.id.geraete_info, "Prognose fehlt")
            return
        }
        v.setTextViewText(R.id.geraete_zahl, "${g.jetzt} von ${g.von}")
        val anteil = g.jetzt.toFloat() / g.von
        val farbe = if (g.heute == 0) Color.rgb(214, 69, 69)
            else Color.rgb(mix(245, 46, anteil), mix(166, 158, anteil), mix(35, 91, anteil))
        v.setTextColor(R.id.geraete_zahl, farbe)
        val frei = Daten.kw(maxOf(0.0, g.freiKw)) + " frei"
        v.setTextViewText(R.id.geraete_info, when {
            g.heute == 0 -> "heute keins mehr"
            g.jetzt == 0 -> "erst später · $frei"
            else -> frei
        })
    }

    private fun mix(a: Int, b: Int, t: Float) = (a + (b - a) * t).toInt()

    /** Sofortige Rueckmeldung beim Antippen, bis die neuen Werte da sind. */
    fun zeigeLaedt(ctx: Context) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_zuhause)
        v.setTextViewText(R.id.stand, "aktualisiere …")
        AppWidgetManager.getInstance(ctx).partiallyUpdateAppWidget(ids(ctx), v)
    }

    private fun klicks(ctx: Context, v: RemoteViews) {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // ganzes Widget antippen = neu laden
        val neu = Intent(ctx, ZuhauseWidget::class.java).setAction(ZuhauseWidget.AKTION_NEU_LADEN)
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getBroadcast(ctx, 0, neu, flags))
        // Pfeil = Dashboard oeffnen (ist die PWA installiert, oeffnet Android sie direkt)
        val oeffnen = Intent(Intent.ACTION_VIEW, Uri.parse(DASHBOARD))
        v.setOnClickPendingIntent(R.id.oeffnen, PendingIntent.getActivity(ctx, 1, oeffnen, flags))
    }
}
