package ch.grosjhome.zuhause

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * 4x3-Widget "Zuhause": PV, Boiler, Auto (Wallbox) und ID.3.
 * Aktualisiert sich etwa alle 15 min (Android-Minimum fuer Hintergrundarbeit) und sofort
 * beim Antippen; der Pfeil oben rechts oeffnet das Dashboard.
 */
class ZuhauseWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Aktualisierung.planen(ctx)
        Aktualisierung.jetzt(ctx)
    }

    override fun onEnabled(ctx: Context) = Aktualisierung.planen(ctx)

    override fun onDisabled(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(Aktualisierung.PERIODISCH)
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == AKTION_NEU_LADEN) {
            WidgetAnsicht.zeigeLaedt(ctx)
            Aktualisierung.jetzt(ctx)
        }
    }

    companion object {
        const val AKTION_NEU_LADEN = "ch.grosjhome.zuhause.NEU_LADEN"
    }
}

object Aktualisierung {
    const val PERIODISCH = "zuhause-periodisch"

    /** Alle 15 min (kuerzer erlaubt Android nicht), nur mit Netz. */
    fun planen(ctx: Context) {
        val netz = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val req = PeriodicWorkRequest.Builder(AktualisierungsArbeit::class.java, 15, TimeUnit.MINUTES)
            .setConstraints(netz).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODISCH, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** Sofort (Antippen, Widget neu hinzugefuegt) - ohne Netz-Bedingung, damit das Widget
     *  auch "keine Verbindung" zeigen kann statt haengenzubleiben. */
    fun jetzt(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniqueWork(
            "zuhause-jetzt", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequest.Builder(AktualisierungsArbeit::class.java).build()
        )
    }
}

class AktualisierungsArbeit(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val werte = try { Daten.laden() } catch (e: Exception) { null }
        WidgetAnsicht.zeige(applicationContext, werte)
        return Result.success()
    }
}
