package de.trisar.fahrer.auto

import android.app.Application
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.lifecycleScope
import de.trisar.fahrer.BuildConfig
import de.trisar.fahrer.fahrt.FahrtDetails
import de.trisar.fahrer.fahrt.FahrtAdresse
import de.trisar.fahrer.haupt.Datum
import de.trisar.fahrer.haupt.DienstAnfrage
import de.trisar.fahrer.haupt.FahrerOrtung
import de.trisar.fahrer.haupt.Fahrt
import de.trisar.fahrer.haupt.FahrtenSpeicher
import de.trisar.kern.Backend
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

/**
 * Android Auto der Fahrer-App, Nachbau von CarPlaySzene.swift (nur Vorlagen der Car App Library):
 *   Liste   – kommende Fahrten nach Tag, vorne die Abholzeit als Lime-Plakette (gefuellt = angenommen,
 *             nur Rand = Antwort offen). Darunter offene Dienstanfragen.
 *   Fahrt   – Abholung, Ziel, Gaeste, Flug, Notiz. Knoepfe: offen -> Annehmen / Ablehnen,
 *             sonst Navigation (Karten-App des Autos, zum Ziel wenn unterwegs, sonst zur Abholung).
 *   Hinweis – kommt eine neue Fahrt oder Dienstanfrage dazu, fragt Android Auto sofort.
 * Daten ueber den FahrtenSpeicher der App (eigener ViewModelStore je Sitzung, Realtime auf jobs).
 * Kategorie POI: eine Kategorie "Fahrten" gibt es bei Google nicht. Im Auto erscheint die App nur
 * mit Android-Auto-Entwicklereinstellung "Unbekannte Quellen" (APK nicht aus dem Play Store).
 */
class TrisarAutoDienst : CarAppService() {
    override fun createHostValidator(): HostValidator =
        if (BuildConfig.DEBUG) HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        else HostValidator.Builder(applicationContext).addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample).build()

    override fun onCreateSession(): Session = TrisarAutoSitzung()
}

class TrisarAutoSitzung : Session() {
    private val ablage = ViewModelStore()
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    internal lateinit var speicher: FahrtenSpeicher
    /** null = noch nicht geprueft, "" = nicht angemeldet, sonst die Fahrer-ID. */
    internal var fahrerID: String? = null
    /** Fahrten und Dienstanfragen, die schon da waren oder fuer die der Hinweis schon kam. */
    private val bekannt = mutableSetOf<String>()
    private var ersterStand = true

    override fun onCreateScreen(intent: Intent): Screen {
        speicher = ViewModelProvider(ablage, ViewModelProvider.AndroidViewModelFactory.getInstance(carContext.applicationContext as Application))[FahrtenSpeicher::class.java]
        val liste = FahrtenListeAuto(carContext, this)
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                bereich.cancel()
                ablage.clear()
            }
        })
        bereich.launch {
            runCatching { Backend.client.auth.awaitInitialization() }
            Backend.client.auth.sessionStatus.collect { status ->
                if (status is SessionStatus.Initializing) return@collect
                val id = (status as? SessionStatus.Authenticated)?.session?.user?.id
                    ?: Backend.client.auth.currentUserOrNull()?.id.takeIf { status is SessionStatus.Authenticated }
                val neu = id ?: ""
                if (neu == fahrerID) return@collect
                fahrerID = neu
                bekannt.clear(); ersterStand = true
                // Auch ohne offenes Handy-Fenster Fahrten laden und Standort senden (wie CarPlay).
                speicher.setzeFahrer(id)
                FahrerOrtung.einrichten(carContext)
                FahrerOrtung.setzeFahrer(id)
                liste.invalidate()
            }
        }
        bereich.launch {
            combine(speicher.fahrten, speicher.dienstAnfragen, speicher.geladen) { f, d, g -> Triple(f, d, g) }.collect { (f, d, g) ->
                liste.invalidate()
                if (g) neuesMelden(f, d)
            }
        }
        // Countdown jede Minute neu.
        bereich.launch { while (isActive) { delay(60_000); liste.invalidate() } }
        return liste
    }

    /** Neue offene Fahrt oder Dienstanfrage: sofort fragen (der erste Stand steht schon in der Liste). */
    private fun neuesMelden(fahrten: List<Fahrt>, dienste: List<DienstAnfrage>) {
        val offeneFahrten = fahrten.filter { it.wartetAufAntwort }
        val offeneDienste = dienste.filter { it.status.orEmpty().equals("pending", true) }
        try {
            if (ersterStand) { ersterStand = false; return }
            val sm = carContext.getCarService(androidx.car.app.ScreenManager::class.java)
            if (sm.top !is FahrtenListeAuto) return
            offeneFahrten.firstOrNull { it.id !in bekannt }?.let { sm.push(NeueFahrtAuto(carContext, this, it)); return }
            offeneDienste.firstOrNull { it.id !in bekannt }?.let { sm.push(DienstFrageAuto(carContext, this, it)) }
        } finally {
            bekannt += fahrten.map { it.id }
            bekannt += dienste.map { it.id }
        }
    }
}

// MARK: Hilfen

internal object AutoText {
    private val unterwegs = setOf("in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")
    private val beimGast = setOf("at_pickup", "pickup", "beim_pickup", "beim pickup")

    fun unterwegs(f: Fahrt) = f.status.lowercase() in unterwegs
    fun beimGast(f: Fahrt) = f.status.lowercase() in beimGast

    /** Gleiche Namen wie CarPlay und die App. */
    fun status(f: Fahrt): String = when {
        unterwegs(f) -> "Unterwegs"
        beimGast(f) -> "Beim Gast"
        f.wartetAufAntwort -> "Antwort offen"
        else -> "Angenommen"
    }

    fun zeitpunkt(f: Fahrt): LocalDateTime? = runCatching {
        LocalDateTime.of(LocalDate.parse(f.fahrtDatum.take(10)), LocalTime.parse(f.etd.take(5)))
    }.getOrNull()

    /** "in 25 min", "in 2 h 5 min", leer wenn vorbei oder mehr als 24 h. */
    fun abstand(f: Fahrt): String {
        val z = zeitpunkt(f) ?: return ""
        val min = Duration.between(LocalDateTime.now(), z).toMinutes()
        if (min < 0 || min > 24 * 60) return ""
        return if (min < 60) "in $min min" else "in ${min / 60} h ${min % 60} min"
    }

    fun abholung(f: Fahrt) = FahrtAdresse.fuerNavigation(f.abholName, f.abholAdresse, f.abholOrtID != null)
    fun ziel(f: Fahrt) = FahrtAdresse.fuerNavigation(f.zielName, f.zielAdresse, f.zielOrtID != null)

    fun dienstZeit(d: DienstAnfrage): String =
        listOfNotNull(d.service_start_time?.take(5), d.service_end_time?.take(5)).joinToString("–")

    /** Abholzeit als Lime-Plakette (gefuellt = angenommen, nur Rand = Antwort offen). */
    fun plakette(text: String, gefuellt: Boolean): CarIcon {
        val g = 128
        val bmp = Bitmap.createBitmap(g, g, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val lime = 0xFFE3F654.toInt()
        val dunkel = 0xFF1D1C1D.toInt()
        val flaeche = RectF(4f, 4f, g - 4f, g - 4f)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = if (gefuellt) lime else dunkel
        c.drawRoundRect(flaeche, 30f, 30f, p)
        if (!gefuellt) {
            p.style = Paint.Style.STROKE; p.strokeWidth = 6f; p.color = lime
            c.drawRoundRect(flaeche, 30f, 30f, p)
        }
        val t = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (gefuellt) dunkel else lime
            textSize = 40f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        c.drawText(text, g / 2f, g / 2f - (t.descent() + t.ascent()) / 2, t)
        return CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
    }

    fun grenze(ctx: CarContext, typ: Int, standard: Int): Int =
        if (ctx.carAppApiLevel >= 2) runCatching { ctx.getCarService(ConstraintManager::class.java).getContentLimit(typ) }.getOrDefault(standard)
        else standard
}

// MARK: Liste

internal class FahrtenListeAuto(ctx: CarContext, private val sitzung: TrisarAutoSitzung) : Screen(ctx) {
    override fun onGetTemplate(): Template {
        val id = sitzung.fahrerID
        if (id == "") {
            return MessageTemplate.Builder("Bitte in der TRISAR-App auf dem Handy anmelden.")
                .setTitle("TRISAR").setHeaderAction(Action.APP_ICON).build()
        }
        val s = sitzung.speicher
        if (id == null || !s.geladen.value) {
            return ListTemplate.Builder().setTitle("TRISAR").setHeaderAction(Action.APP_ICON).setLoading(true).build()
        }
        val heute = Datum.tagWert()
        val fahrten = s.fahrten.value
            .filter { it.fahrtDatum >= heute || AutoText.unterwegs(it) || AutoText.beimGast(it) }
            .sortedWith(compareBy({ it.fahrtDatum }, { it.etd }))
        val dienste = s.dienstAnfragen.value.filter { it.status.orEmpty().equals("pending", true) }
        var frei = AutoText.grenze(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_LIST, 6)
        val b = ListTemplate.Builder().setTitle("TRISAR").setHeaderAction(Action.APP_ICON)
        if (fahrten.isEmpty() && dienste.isEmpty()) {
            return b.setSingleList(ItemList.Builder().setNoItemsMessage("Keine Fahrten. Neue Fahrten erscheinen hier von selbst.").build()).build()
        }
        // Dienstanfragen zuerst, damit sie bei voller Liste nicht wegfallen.
        val dienstZeilen = dienste.take(frei).map { d ->
            Row.Builder().setTitle("Dienstanfrage " + Datum.tagEtikett(d.service_date.orEmpty()))
                .addText(AutoText.dienstZeit(d).ifEmpty { "Antwort offen" }.let { if (it == "Antwort offen") it else "$it · Antwort offen" })
                .setBrowsable(true)
                .setOnClickListener { screenManager.push(DienstFrageAuto(carContext, sitzung, d)) }
                .build()
        }
        frei -= dienstZeilen.size
        val gezeigt = fahrten.take(maxOf(0, frei))
        val tage = gezeigt.map { it.fahrtDatum }.distinct()
        for (tag in tage) {
            val liste = ItemList.Builder()
            gezeigt.filter { it.fahrtDatum == tag }.forEach { f -> liste.addItem(fahrtZeile(f)) }
            b.addSectionedList(SectionedItemList.create(liste.build(), Datum.tagEtikett(tag)))
        }
        if (dienstZeilen.isNotEmpty()) {
            val liste = ItemList.Builder()
            dienstZeilen.forEach { liste.addItem(it) }
            b.addSectionedList(SectionedItemList.create(liste.build(), "Dienst"))
        }
        return b.build()
    }

    private fun fahrtZeile(f: Fahrt): Row {
        val laeuft = AutoText.unterwegs(f) || AutoText.beimGast(f)
        val wann = if (!laeuft && !f.wartetAufAntwort) AutoText.abstand(f).let { if (it.isEmpty()) "" else " · $it" } else ""
        return Row.Builder()
            .setTitle(f.abholKurz)
            .addText("${AutoText.status(f)}$wann · nach ${f.zielKurz}")
            .setImage(AutoText.plakette(f.etd, gefuellt = !f.wartetAufAntwort), Row.IMAGE_TYPE_LARGE)
            .setBrowsable(true)
            .setOnClickListener { screenManager.push(FahrtAuto(carContext, sitzung, f.id)) }
            .build()
    }
}

// MARK: Fahrt

internal class FahrtAuto(ctx: CarContext, private val sitzung: TrisarAutoSitzung, private val fahrtID: String) : Screen(ctx) {
    private var details: FahrtDetails? = null
    private var geladen = false

    init {
        val fahrer = sitzung.fahrerID
        if (!fahrer.isNullOrEmpty()) {
            val d = FahrtDetails(fahrtID, fahrer, ctx.applicationContext)
            details = d
            lifecycleScope.launch {
                runCatching { d.laden() }
                geladen = true
                invalidate()
            }
        }
    }

    private val fahrt: Fahrt? get() = sitzung.speicher.fahrten.value.firstOrNull { it.id == fahrtID }

    override fun onGetTemplate(): Template {
        val f = fahrt ?: return MessageTemplate.Builder("Diese Fahrt gibt es nicht mehr.")
            .setTitle("Fahrt").setHeaderAction(Action.BACK).build()
        val pane = Pane.Builder()
        if (!geladen && details != null) {
            pane.setLoading(true)
        } else {
            val zeilen = mutableListOf<Row>()
            zeilen += Row.Builder().setTitle("Abholung").addText(AutoText.abholung(f).ifEmpty { f.abholKurz }).build()
            zeilen += Row.Builder().setTitle("Ziel").addText(AutoText.ziel(f).ifEmpty { f.zielKurz }).build()
            val d = details
            if (d != null) {
                val gaeste = d.gaeste + if (d.anonym > 0) listOf("${d.anonym} ohne Namen") else emptyList()
                if (gaeste.isNotEmpty()) zeilen += Row.Builder().setTitle("Gäste").addText(gaeste.joinToString(", ")).build()
            }
            if (f.flug.isNotBlank() && f.flug != "STADTFAHRT") {
                zeilen += Row.Builder().setTitle(if (f.istZug) "Zug" else "Flug").addText(f.flug).build()
            }
            d?.notizen?.firstOrNull()?.let { n -> zeilen += Row.Builder().setTitle("Notiz").addText(n.text).build() }
            if (f.istKolonne) zeilen += Row.Builder().setTitle("Kolonne").addText("Fahrt mit mehreren Fahrern").build()
            zeilen.take(AutoText.grenze(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_PANE, 4)).forEach { pane.addRow(it) }
            knoepfe(f).forEach { pane.addAction(it) }
        }
        return PaneTemplate.Builder(pane.build())
            .setTitle("${f.etd} · ${AutoText.status(f)}")
            .setHeaderAction(Action.BACK)
            .build()
    }

    /** Offen: Annehmen / Ablehnen. Sonst Navigation (hoechstens zwei Knoepfe im Pane). */
    private fun knoepfe(f: Fahrt): List<Action> {
        if (f.wartetAufAntwort) {
            return listOf(
                Action.Builder().setTitle("Annehmen").setBackgroundColor(CarColor.GREEN)
                    .setOnClickListener { AutoAktion.antworten(carContext, sitzung, f, true, screenManager) }.build(),
                Action.Builder().setTitle("Ablehnen")
                    .setOnClickListener { screenManager.push(AblehnenAuto(carContext, sitzung, f)) }.build(),
            )
        }
        return listOf(
            Action.Builder().setTitle(if (AutoText.unterwegs(f)) "Navigation zum Ziel" else "Navigation zur Abholung")
                .setBackgroundColor(CarColor.GREEN)
                .setOnClickListener { AutoAktion.navigieren(carContext, f) }.build(),
        )
    }
}

// MARK: Fragen

internal class AblehnenAuto(ctx: CarContext, private val sitzung: TrisarAutoSitzung, private val f: Fahrt) : Screen(ctx) {
    override fun onGetTemplate(): Template =
        MessageTemplate.Builder("Fahrt ${f.etd} von ${f.abholKurz} ablehnen?")
            .setTitle("Ablehnen").setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle("Ablehnen").setBackgroundColor(CarColor.RED)
                .setOnClickListener { AutoAktion.antworten(carContext, sitzung, f, false, screenManager) }.build())
            .addAction(Action.Builder().setTitle("Abbrechen").setOnClickListener { screenManager.pop() }.build())
            .build()
}

/** Hinweis auf eine neue Fahrt: Annehmen oder Spaeter (Ablehnen geht in der Fahrt-Ansicht, wie CarPlay). */
internal class NeueFahrtAuto(ctx: CarContext, private val sitzung: TrisarAutoSitzung, private val f: Fahrt) : Screen(ctx) {
    override fun onGetTemplate(): Template =
        MessageTemplate.Builder("Neue Fahrt um ${f.etd}: ${f.abholKurz} nach ${f.zielKurz}")
            .setTitle("Neue Fahrt").setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle("Annehmen").setBackgroundColor(CarColor.GREEN)
                .setOnClickListener { AutoAktion.antworten(carContext, sitzung, f, true, screenManager) }.build())
            .addAction(Action.Builder().setTitle("Später").setOnClickListener { screenManager.pop() }.build())
            .build()
}

internal class DienstFrageAuto(ctx: CarContext, private val sitzung: TrisarAutoSitzung, private val d: DienstAnfrage) : Screen(ctx) {
    override fun onGetTemplate(): Template {
        val zeit = AutoText.dienstZeit(d)
        return MessageTemplate.Builder("Dienst ${Datum.tagEtikett(d.service_date.orEmpty())}${if (zeit.isEmpty()) "" else " $zeit"}")
            .setTitle("Dienstanfrage").setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle("Annehmen").setBackgroundColor(CarColor.GREEN)
                .setOnClickListener { sitzung.speicher.dienstAntworten(d, true); screenManager.popToRoot() }.build())
            .addAction(Action.Builder().setTitle("Ablehnen")
                .setOnClickListener { sitzung.speicher.dienstAntworten(d, false); screenManager.popToRoot() }.build())
            .build()
    }
}

// MARK: Aktionen

internal object AutoAktion {
    fun antworten(ctx: CarContext, sitzung: TrisarAutoSitzung, f: Fahrt, annehmen: Boolean, sm: androidx.car.app.ScreenManager) {
        sm.popToRoot()
        CoroutineScope(Dispatchers.Main.immediate).launch {
            val ok = sitzung.speicher.antwortenJetzt(f, annehmen)
            CarToast.makeText(ctx, if (!ok) "Hat nicht geklappt. Bitte am Handy prüfen." else if (annehmen) "Fahrt angenommen" else "Fahrt abgelehnt",
                CarToast.LENGTH_LONG).show()
        }
    }

    /** Karten-App des Autos: unterwegs zum Ziel, sonst zur Abholung (nur ein Ziel moeglich). */
    fun navigieren(ctx: CarContext, f: Fahrt) {
        val adresse = if (AutoText.unterwegs(f)) AutoText.ziel(f) else AutoText.abholung(f)
        if (adresse.isBlank()) return
        try {
            ctx.startCarApp(Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:0,0?q=" + Uri.encode(adresse))))
        } catch (e: Exception) {
            CarToast.makeText(ctx, "Keine Navigations-App gefunden.", CarToast.LENGTH_LONG).show()
        }
    }
}
