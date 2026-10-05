package ch.grosjhome.zuhause

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Einzige Bildschirmseite der App: erklaert, wie man das Widget hinzufuegt, und hilft bei
 * der Fehlersuche (Test im Vordergrund + Android-Einschraenkungen fuer den Hintergrund).
 * Das einmalige Oeffnen hebt ausserdem den "gestoppt"-Zustand frisch installierter Apps auf.
 */
class InfoActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        layout.addView(TextView(this).apply { textSize = 22f; text = getString(R.string.app_name) })
        layout.addView(TextView(this).apply {
            textSize = 16f
            setPadding(0, pad, 0, pad)
            text = getString(R.string.anleitung)
        })
        layout.addView(Button(this).apply {
            text = getString(R.string.dashboard_oeffnen)
            setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(WidgetAnsicht.DASHBOARD))) }
        })
        layout.addView(Button(this).apply {
            text = getString(R.string.jetzt_testen)
            setOnClickListener { testen() }
        })
        layout.addView(Button(this).apply {
            text = getString(R.string.app_einstellungen)
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        })
        status = TextView(this).apply { textSize = 14f; setPadding(0, pad, 0, 0) }
        layout.addView(status)
        setContentView(ScrollView(this).apply { addView(layout) })
        Aktualisierung.planen(this)
    }

    override fun onResume() {
        super.onResume()
        zeigeStatus(null)
    }

    /** Abruf im Vordergrund - klappt er hier, aber nicht im Widget, bremst Android den Hintergrund. */
    private fun testen() {
        zeigeStatus("läuft …")
        Thread {
            val w = Daten.laden()
            WidgetAnsicht.zeige(this, w)
            val ergebnis = if (w.fehler == null)
                "OK – PV ${Daten.kw(w.pvKw)}, ID.3 ${Daten.id3(w.soc, w.reichweiteKm)}"
            else if (w.leer) "Fehler: ${w.fehler}" else "teilweise (${w.fehler})"
            runOnUiThread { zeigeStatus(ergebnis) }
        }.start()
    }

    private fun zeigeStatus(test: String?) {
        val cm = getSystemService(ConnectivityManager::class.java)
        val datensparen = cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val pm = getSystemService(PowerManager::class.java)
        status.text = buildString {
            append("Fehlersuche\n")
            if (test != null) append("• Test jetzt: $test\n")
            append("• Letzte Hintergrund-Aktualisierung: ${Protokoll.text(this@InfoActivity)}\n")
            append("• Datensparmodus: " + (if (datensparen) "blockiert Hintergrund-Daten ⚠️ – in den App-Einstellungen unter Mobile Daten „Uneingeschränkte Datennutzung“ erlauben" else "ok") + "\n")
            append("• Akku: " + (if (am.isBackgroundRestricted) "Hintergrund eingeschränkt ⚠️ – in den App-Einstellungen unter Akku auf „Nicht eingeschränkt“ stellen" else "ok"))
            append(if (pm.isIgnoringBatteryOptimizations(packageName)) " (nicht optimiert)" else " (optimiert)")
        }
    }
}
