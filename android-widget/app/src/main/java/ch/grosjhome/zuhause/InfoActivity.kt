package ch.grosjhome.zuhause

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Einzige Bildschirmseite der App: erklaert, wie man das Widget hinzufuegt.
 * Das einmalige Oeffnen hebt ausserdem den "gestoppt"-Zustand frisch installierter Apps auf.
 */
class InfoActivity : Activity() {
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
        setContentView(layout)
        Aktualisierung.planen(this)
    }
}
