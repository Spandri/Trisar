package de.trisar.fahrer.haupt

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.ReiseLage
import de.trisar.kern.ReiseVerbindung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Dauerhafte Benachrichtigung waehrend einer Dienstreise (Gegenstueck zur Live-Aktivitaet in iOS).
 * Eigener Kanal "Dienstreise", leise, nicht wegwischbar. Sichtbar ab 30 min vor dem Start einer
 * angenommenen, nicht beendeten Dienstreise bis 15 min nach der letzten Ankunft bzw. bis
 * "Dienstreise beenden". Laeuft nur, solange der App-Prozess lebt (wie die uebrige Live-Abfrage,
 * mit laufender Ortung also auch im Hintergrund). Aktualisiert jede Minute und bei neuem Live-Stand.
 *
 * Notification.ProgressStyle (Live Updates) gibt es erst ab API 36 bzw. androidx.core 1.17. Das Projekt
 * baut gegen API 35 mit core 1.15, darum hier eine normale Benachrichtigung.
 */
@SuppressLint("StaticFieldLeak")
object DienstreiseLive {
    private const val KANAL = "dienstreise"
    private const val NUMMER = 4712
    private const val VORLAUF_MS = 30 * 60 * 1000L
    private const val NACHLAUF_MS = 15 * 60 * 1000L
    private const val LIVE_INTERVALL_MS = 120_000L

    private lateinit var app: Context
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var gestartet = false
    private var liveTakt: Job? = null
    private var liveFuer: String? = null
    /** Live-Stand je Abschnitt (bzw. "haupt" ohne Abschnitte) der gerade gezeigten Dienstreise. */
    private var liveJe: Map<String, ReiseVerbindung> = emptyMap()
    private var gezeigt = false

    /** Einmal nach der Anmeldung aufrufen. Folgt DienstreiseSpeicher.liste (leer nach Abmelden). */
    fun starten(ctx: Context) {
        if (gestartet) return
        gestartet = true
        app = ctx.applicationContext
        bereich.launch { DienstreiseSpeicher.liste.collect { aktualisieren() } }
        bereich.launch {
            while (isActive) {
                aktualisieren()
                // Zur naechsten vollen Minute (Uhrzeiten im Text springen sonst zu spaet).
                delay(60_000L - System.currentTimeMillis() % 60_000L + 200L)
            }
        }
    }

    /** "HH:MM" am Tag (YYYY-MM-DD) in der Zeit des Geraets -> ms (wie ReiseLage). */
    private fun zeitpunkt(tag: String?, uhr: String?): Long? {
        if (tag.isNullOrBlank()) return null
        val u = Regex("^(\\d{1,2}):(\\d{2})").find(uhr.orEmpty()) ?: return null
        return runCatching {
            LocalDate.parse(tag.take(10)).atTime(LocalTime.of(u.groupValues[1].toInt(), u.groupValues[2].toInt()))
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
    }

    private fun teile(reise: FahrerDienstreise): List<DienstreiseAbschnitt> =
        if (reise.abschnitte.size > 1) reise.abschnitte else listOf(ReiseLage.alsAbschnitt(reise.r))

    /** Live-Stand je Abschnitt, ohne Abschnitte mit Rueckfall auf den Stand beim Anlegen. */
    private fun liveLage(reise: FahrerDienstreise): Map<String, ReiseVerbindung> {
        if (reise.abschnitte.size > 1) return liveJe
        val v = liveJe["haupt"] ?: reise.r.gespeicherteVerbindung
            ?: ReiseVerbindung(if (reise.r.flug) "flug" else "zug", reise.r.nummer)
        return mapOf("haupt" to v)
    }

    private fun abZeit(a: DienstreiseAbschnitt, w: ReiseVerbindung?) = w?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)
    private fun anZeit(a: DienstreiseAbschnitt, w: ReiseVerbindung?) = w?.ankunft?.ifEmpty { null } ?: a.an_zeit.orEmpty().take(5)

    /** Start und letzte Ankunft der Reise (ms), Ankunft null wenn unbekannt. */
    private fun fenster(reise: FahrerDienstreise, live: Map<String, ReiseVerbindung>): Pair<Long?, Long?> {
        val t = teile(reise)
        val erster = t.first(); val letzter = t.last()
        val tagErster = erster.ab_datum?.ifBlank { null } ?: reise.r.datum
        val start = zeitpunkt(tagErster, abZeit(erster, live[erster.id])) ?: zeitpunkt(reise.r.datum, reise.r.start_zeit)
        val tagLetzter = letzter.ab_datum?.ifBlank { null } ?: reise.r.datum
        val ab = zeitpunkt(tagLetzter, abZeit(letzter, live[letzter.id]))
        var an = zeitpunkt(letzter.an_datum?.ifBlank { null } ?: tagLetzter, anZeit(letzter, live[letzter.id]))
        if (ab != null && an != null && an < ab) an += 24 * 3600 * 1000L
        return start to an
    }

    /** Die Dienstreise, die gerade im Zeitfenster liegt (frueheste zuerst). */
    private fun aktuelleReise(jetzt: Long): FahrerDienstreise? =
        DienstreiseSpeicher.liste.value.filter { it.angenommen && it.z.beendet == null && it.sichtbar }.firstOrNull { reise ->
            val live = if (reise.id == liveFuer) liveLage(reise) else mapOf("haupt" to (reise.r.gespeicherteVerbindung
                ?: ReiseVerbindung(if (reise.r.flug) "flug" else "zug", reise.r.nummer)))
            val (start, ende) = fenster(reise, live)
            start != null && jetzt >= start - VORLAUF_MS && (ende == null || jetzt <= ende + NACHLAUF_MS)
        }

    private fun aktualisieren() {
        if (!::app.isInitialized) return
        val jetzt = System.currentTimeMillis()
        val reise = aktuelleReise(jetzt)
        if (reise == null) {
            liveTakt?.cancel(); liveTakt = null; liveFuer = null; liveJe = emptyMap()
            entfernen()
            return
        }
        if (reise.id != liveFuer) liveStarten(reise)
        zeigen(reise, jetzt)
    }

    /** Live-Stand alle 2 Minuten (wie DienstreiseSeite), nach jeder Antwort neu zeigen. */
    private fun liveStarten(reise: FahrerDienstreise) {
        liveTakt?.cancel()
        liveFuer = reise.id
        liveJe = emptyMap()
        val r = reise.r
        liveTakt = bereich.launch {
            while (isActive) {
                val aktuell = DienstreiseSpeicher.liste.value.firstOrNull { it.id == r.id } ?: reise
                if (aktuell.abschnitte.size > 1) {
                    for (a in aktuell.abschnitte) {
                        if (!DienstreiseAbschnitt.mitLive(a.art) || a.nummer.isNullOrBlank()) continue
                        val w = runCatching { ReiseVerbindung.holen(a.alsReise(r.datum), a.nach_name.orEmpty()) }.getOrNull()
                        if (w != null && w.fehler == null && liveFuer == r.id) liveJe = liveJe + (a.id to w)
                    }
                } else if (r.nummer.isNotEmpty()) {
                    val v = runCatching { ReiseVerbindung.holen(r) }.getOrNull()
                    if (v != null && v.fehler == null && liveFuer == r.id) liveJe = mapOf("haupt" to v)
                }
                aktualisieren()
                delay(LIVE_INTERVALL_MS)
            }
        }
    }

    /** Titel und Text nach Zustand (vor Start, unterwegs, Umstieg, angekommen). */
    private fun inhalt(reise: FahrerDienstreise, jetzt: Long): Pair<String, String> {
        val t = teile(reise)
        val live = liveLage(reise)
        val lage = ReiseLage.berechnen(t, live, reise.r.datum, null, jetzt)
            ?: return "Dienstreise ${reise.r.zeit}" to "→ ${reise.r.ziel_name}"
        val mehrere = t.size > 1
        val a = t[lage.index]
        val w = live[a.id]
        val nummer = a.nummer?.ifBlank { null } ?: w?.nummer.orEmpty()
        val nach = a.nach_name?.ifBlank { null } ?: w?.ankunftOrt?.ifEmpty { null } ?: reise.r.ziel_name
        val ab = abZeit(a, w)
        val an = anZeit(a, w)
        val spaet = ReiseLage.verspaetungMin(w)?.takeIf { it > 0 }?.let { " +$it" }.orEmpty()
        val abschnitt = if (mehrere) "Abschnitt ${lage.index + 1}/${t.size}" else ""
        fun zu(vararg s: String) = s.filter { it.isNotBlank() }.joinToString(" · ")

        return when {
            lage.vorbei -> "Angekommen in ${reise.r.ziel_name.ifBlank { nach }}" to zu(if (an.isNotEmpty()) "an $an" else "", nummer)
            lage.imUmstieg && lage.index > 0 -> {
                val vorher = t[lage.index - 1]
                val wv = live[vorher.id]
                val nAb = DienstreiseAbschnitt.minuten(ab)
                val dAn = DienstreiseAbschnitt.minuten(anZeit(vorher, wv))
                val dauer = if (nAb != null && dAn != null) " ${(nAb - dAn + 1440) % 1440} min" else ""
                // Gleise live gegen Ticket/Fahrplan (15.11.): "Gleis 3 → Gleis 9 statt 7".
                val gleisAn = de.trisar.kern.GleisStand.von(wv?.gleisAn, vorher.gleis_an, wv?.gleisAnPlan).gleis
                val gleisAb = de.trisar.kern.GleisStand.von(w?.gleis, a.gleis_ab, w?.gleisPlan)
                val gleise = when {
                    gleisAn.isNotEmpty() && gleisAb.gleis.isNotEmpty() -> "Gleis $gleisAn → ${gleisAb.text}"
                    else -> gleisAb.text
                }
                zu("Umstieg$dauer", "$nummer ab $ab".trim()) to zu(gleise, "nach $nach")
            }
            lage.vorStart -> {
                val gleis = de.trisar.kern.GleisStand.von(w?.gleis, a.gleis_ab, w?.gleisPlan)
                zu(ab, "$nummer ab ${a.von_name}".trim()) to zu("→ $nach $an".trim(), gleis.text)
            }
            else -> {
                val naechster = t.getOrNull(lage.index + 1)
                val dann = naechster?.nummer?.ifBlank { null }?.let { "dann $it" }.orEmpty()
                val gleisAn = de.trisar.kern.GleisStand.von(w?.gleisAn, a.gleis_an, w?.gleisAnPlan)
                val titel = if (DienstreiseAbschnitt.mitLive(a.art) && w != null)
                    "$nummer → $nach an $an$spaet".trim()
                else zu(an, "$nummer an $nach".trim()) + spaet
                titel to zu(gleisAn.text, dann, abschnitt)
            }
        }
    }

    private fun kanal() {
        val nm = app.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(KANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(KANAL, "Dienstreise", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Laufende Dienstreise mit Abfahrt, Ankunft und Umstieg"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            })
        }
    }

    private fun zeigen(reise: FahrerDienstreise, jetzt: Long) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        kanal()
        val (titel, text) = inhalt(reise, jetzt)
        // Tippen oeffnet die Dienstreise (ueber Push.ausIntent wie eine Mitteilung).
        val start = app.packageManager.getLaunchIntentForPackage(app.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("ziel", "dienstreise")
            putExtra("dienstreise_id", reise.id)
        }
        val tippen = start?.let { PendingIntent.getActivity(app, NUMMER, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val bau = NotificationCompat.Builder(app, KANAL)
            .setSmallIcon(de.trisar.kern.R.drawable.ic_mitteilung)
            .setColor(0xFFE3F754.toInt())
            .setContentTitle(titel)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(tippen)
        runCatching { NotificationManagerCompat.from(app).notify(NUMMER, bau.build()) }.onSuccess { gezeigt = true }
    }

    private fun entfernen() {
        if (!gezeigt) return
        NotificationManagerCompat.from(app).cancel(NUMMER)
        gezeigt = false
    }
}
