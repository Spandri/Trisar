package de.trisar.dispo.stamm

import de.trisar.kern.Backend
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.widthIn
import de.trisar.dispo.FlaggeMitRand
import de.trisar.dispo.FlaggenKnoepfe
import de.trisar.dispo.Flaggen
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import io.github.jan.supabase.postgrest.from
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.FahrerMarkierung
import de.trisar.dispo.Navileiste
import de.trisar.kern.CssRadial
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch
import java.text.Collator
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val GELB = hex(0xFDE047)

/** Fahrer, dessen Ansicht beim Erscheinen des Bereichs direkt aufgehen soll (openDriverById, Sprung vom Fahrzeug). */
internal object FahrerSprung { var id: String? = null }

/** Ansicht im Fahrer-Bereich (openDriverCreate/openDriverEditor in App.jsx). */
private sealed interface FahrerSeite {
    data object Liste : FahrerSeite
    data object Erstellen : FahrerSeite
    data class Bearbeiten(val fahrer: DispoFahrer) : FahrerSeite
    data class Ansicht(val fahrer: DispoFahrer) : FahrerSeite
}

/**
 * Fahrer-Bereich der Dispo (FahrerBereichAnsicht.swift): Liste (AlleFahrer.jsx), von dort
 * Anlegen/Bearbeiten (FahrerErstellenView.jsx).
 */
@Composable
internal fun FahrerBereichSeite(zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit = {}) {
    val liste = remember { FahrerListeDienst() }
    val scope = rememberCoroutineScope()
    var seite by remember { mutableStateOf<FahrerSeite>(FahrerSeite.Liste) }
    // Scrollposition der Liste bleibt beim Zurueckkommen erhalten (12.11.).
    val listenScroll = rememberScrollState()
    /** Markierte Fahrer bleiben ueber Anlegen/Bearbeiten erhalten (sessionStorage im Web). */
    /** Auf der Karte markierte Fahrer sind hier schon ausgewaehlt (fahrerMarkierung im Web). */
    val markiert = remember { mutableStateListOf<String>().apply { if (FahrerMarkierung.wirkt) addAll(FahrerMarkierung.ids) } }

    DisposableEffect(Unit) {
        liste.starten(scope)
        onDispose { liste.stoppen() }
    }

    fun zurueckZurListe() {
        seite = FahrerSeite.Liste
        scope.launch { liste.laden() }
    }

    // Sprung vom Fahrzeug: Ansicht oeffnen, sobald der Fahrer in der Liste steht.
    androidx.compose.runtime.LaunchedEffect(liste.fahrer, liste.laedt) {
        val ziel = FahrerSprung.id ?: return@LaunchedEffect
        val f = liste.fahrer.firstOrNull { it.id == ziel }
        if (f == null) { if (!liste.laedt) FahrerSprung.id = null; return@LaunchedEffect }
        FahrerSprung.id = null
        seite = FahrerSeite.Ansicht(f)
    }
    // Sprung zum Fahrzeug (openVehicleById): Fahrzeug-Bereich oeffnet es dann im Bearbeiten.
    val fahrzeugOeffnen: (String) -> Unit = { id -> FahrzeugSprung.id = id; zeigen(DispoZiel.FAHRZEUGE) }

    when (val s = seite) {
        FahrerSeite.Liste -> AlleFahrerSeite(liste, markiert, listenScroll, zeigen, erstellen = { seite = FahrerSeite.Erstellen }, bearbeiten = { seite = FahrerSeite.Bearbeiten(it) },
            oeffnen = { seite = FahrerSeite.Ansicht(it) })
        // Tipp auf einen Fahrer: Stunden, Ablauf, Dienste (wie FahrerAnsichtView.jsx).
        is FahrerSeite.Ansicht -> androidx.compose.runtime.key("ansicht-" + s.fahrer.id) {
            FahrerAnsichtSeite(s.fahrer, zurueck = { zurueckZurListe() }, bearbeiten = { seite = FahrerSeite.Bearbeiten(s.fahrer) }, oeffneFahrt = oeffneFahrt,
                fahrzeugOeffnen = fahrzeugOeffnen)
        }
        FahrerSeite.Erstellen -> androidx.compose.runtime.key("neu") { FahrerErstellenSeite(null) { zurueckZurListe() } }
        is FahrerSeite.Bearbeiten -> androidx.compose.runtime.key(s.fahrer.id) { FahrerErstellenSeite(s.fahrer, fahrzeugOeffnen) { zurueckZurListe() } }
    }
}

// MARK: - Alle Fahrer

/**
 * Nachbau von AlleFahrer.jsx (Raster 402, LAYOUT_GRID). Der KI-Planer-Knopf fuehrt zur Planung,
 * Mit markierten Fahrern: "Dienste planen" schickt Dienststart, Dienstende und Pausen (wie DienstePlanenBlatt.jsx).
 */
@Composable
private fun AlleFahrerSeite(
    liste: FahrerListeDienst,
    markiert: MutableList<String>,
    listenScroll: androidx.compose.foundation.ScrollState,
    zeigen: (DispoZiel) -> Unit,
    erstellen: () -> Unit,
    bearbeiten: (DispoFahrer) -> Unit,
    oeffnen: ((DispoFahrer) -> Unit)? = null,
) {
    val ctx = LocalContext.current
    var suche by remember { mutableStateOf("") }
    var sucheFokus by remember { mutableStateOf(false) }
    var statusFilter by remember { mutableStateOf("alle") }
    var startZeit by remember { mutableStateOf("") }
    var startDatum by remember { mutableStateOf(Dienstzeit.heute()) }
    var endZeit by remember { mutableStateOf("") }
    var endDatum by remember { mutableStateOf(Dienstzeit.heute()) }
    var chartStart by remember { mutableIntStateOf(Planung.CHART_START) }
    var planenOffen by remember { mutableStateOf(false) }
    var flaggenFehler by remember { mutableStateOf("") }
    var exportOffen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // Flagge bei allen Markierten setzen (null = entfernen), danach die Liste neu laden.
    fun flaggeWaehlen(flagge: String?) {
        if (markiert.isEmpty()) return
        val ids = markiert.toList()
        flaggenFehler = ""
        scope.launch {
            val fehler = Flaggen.setzen(ids, flagge)
            if (fehler != null) flaggenFehler = fehler else liste.laden()
        }
    }

    val kartenOben = 698f
    val kartenSchritt = 96f
    val jetzt = LocalTime.now()

    // Ohne Dispo-Rollen, sortiert nach Nachname, Vorname.
    val deutsch = remember { Collator.getInstance(Locale.GERMAN).apply { strength = Collator.PRIMARY } }
    val sichtbare = liste.fahrer
        .filter { (it.role ?: "").trim().lowercase() !in setOf("dispo", "dispatcher", "admin", "koordinator", "coordinator", "pruefung") }
        .sortedWith { a, b -> deutsch.compare(a.lastName, b.lastName).takeIf { it != 0 } ?: deutsch.compare(a.firstName, b.firstName) }
    val gefiltert = gefilterteFahrer(sichtbare, suche, statusFilter, startZeit, startDatum, endZeit, endDatum, jetzt)
    val angebot = Planung.angebot(sichtbare)
    val fahrten = Planung.fahrten(liste.fahrten)
    val bedarf = Planung.bedarf(fahrten)
    val inhalt = max(1364f, kartenOben + max(gefiltert.size, 1) * kartenSchritt + 220f)

    fun umschalten(id: String) {
        if (id.isEmpty()) return
        if (id in markiert) markiert.remove(id) else markiert.add(id)
    }

    // Die Auswahl hier gilt als Markierung in der ganzen Dispo (Karte, Fahrzeuge, Fahrten, Fahrt anlegen,
    // KI-Assistent), auch wenn die Mehrfachauswahl der Karte aus ist (14.11.).
    // Auswahlmodus der Liste = mindestens ein Fahrer ausgewaehlt.
    androidx.compose.runtime.LaunchedEffect(markiert.toList(), liste.fahrer) {
        val m = FahrerMarkierung
        if (markiert.isEmpty() && !m.aktiv) return@LaunchedEffect
        val nachID = liste.fahrer.associateBy { it.id }
        val neu = markiert.map { id ->
            val alt = m.fahrer.firstOrNull { it.id == id }
            FahrerMarkierung.Eintrag(
                id,
                nachID[id]?.name?.ifEmpty { null } ?: alt?.name ?: "",
                nachID[id]?.vehicleId?.ifEmpty { null } ?: alt?.vehicleId ?: "",
            )
        }
        if (m.ids != neu.map { it.id } || neu.withIndex().any { (i, f) -> f.name != m.fahrer.getOrNull(i)?.name }) m.ersetzen(neu)
    }

    fun zeitWaehlen(start: Boolean, zeit: Boolean) {
        val wert = if (start) (if (zeit) startZeit else startDatum) else (if (zeit) endZeit else endDatum)
        if (zeit) {
            val m = Dienstzeit.minuten(wert) ?: (jetzt.hour * 60 + jetzt.minute)
            TimePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, h, mi ->
                val neu = "%02d:%02d".format(h, mi)
                if (start) { startZeit = neu; if (startDatum.isEmpty()) startDatum = Dienstzeit.heute() }
                else { endZeit = neu; if (endDatum.isEmpty()) endDatum = Dienstzeit.heute() }
            }, m / 60, m % 60, true).show()
        } else {
            val d = runCatching { LocalDate.parse(wert) }.getOrDefault(LocalDate.now())
            DatePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, y, mo, t ->
                val neu = LocalDate.of(y, mo + 1, t).toString()
                if (start) startDatum = neu else endDatum = neu
            }, d.year, d.monthValue - 1, d.dayOfMonth).show()
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        CssRadial(1.4142f, 1.0221f, listOf(0x0048CFL to 0f, 0x000000L to 0.46f, 0x000000L to 1f))
        Leinwand(874f, inhalt, listenScroll) {
            ZurueckKnopf(Modifier.platz(20f, 60f)) { zeigen(DispoZiel.START) }
            // Stunden aller oder ausgewaehlter Fahrer als Excel, Zeitraum frei waehlbar.
            ExportKnopf(Modifier.platz(402f - 20f - 50f, 60f)) { exportOffen = true }
            StammTitel("Alle Fahrer", Modifier.platz(20f, 140f))

            PlanungsUebersicht(angebot, fahrten, bedarf, chartStart, { chartStart = it }, Modifier.platz(20f, 206f, 362f, 198f)) {
                zeigen(DispoZiel.PLANUNG)
            }

            // Suchfeld: links "Fahrer Suchen", beim Tippen "Fahrer".
            val aktiv = sucheFokus || suche.isNotBlank()
            Row(Modifier.platz(20f, 428f, 362f, 56f).border(2.dp, GELB).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (aktiv) "Fahrer" else "Fahrer Suchen", style = grotesk(16f, 500, abstand = 0.4f, farbe = GELB.copy(alpha = 0.6f)), maxLines = 1)
                Eingabe(suche, { suche = it }, "", grotesk(16f, 500, abstand = 0.4f, farbe = GELB.copy(alpha = 0.85f)), Color.Transparent,
                    Modifier.weight(1f).padding(start = 12.dp, end = 12.dp), gross = KeyboardCapitalization.None,
                    fokusGeaendert = { sucheFokus = it })
                if (suche.isNotBlank()) {
                    Box(Modifier.size(24.dp).tippen { suche = "" }, contentAlignment = Alignment.Center) {
                        Icon("clear-field-green", Modifier.size(20.dp))
                    }
                } else {
                    Icon("alle-fahrer-search", Modifier.size(24.dp))
                }
            }

            StammZeilenKnopf("Fahrer erstellen", "Arrow_Trisar_Icons_01", Modifier.platz(20f, 496f, 362f, 56f),
                iconBreite = 34f, iconHoehe = 21f, textFarbe = 0x262626, innen = 12f, aktion = erstellen)

            val chips = listOf(Triple("Im Dienst", "im_dienst", 0xFFFFFFL), Triple("Frei", "frei", 0x59BE80L), Triple("Unfertig", "unfertig", 0xFF6F63L))
            chips.forEachIndexed { i, c ->
                StatusChip(c.first, c.third, statusFilter == c.second, Modifier.platz(20f + i * 125f, 564f, 112f, 42f)) {
                    statusFilter = if (statusFilter == c.second) "alle" else c.second
                }
            }

            ZeitFilterFeld(startZeit, startDatum, "Start...", Modifier.platz(20f, 618f, 175f, 56f),
                waehlen = { zeitWaehlen(true, it) }, leeren = { startZeit = ""; startDatum = "" })
            ZeitFilterFeld(endZeit, endDatum, "Ende...", Modifier.platz(207f, 618f, 175f, 56f),
                waehlen = { zeitWaehlen(false, it) }, leeren = { endZeit = ""; endDatum = "" })

            when {
                liste.laedt -> Text("Fahrer werden geladen ...", style = grotesk(16f, 500, farbe = LIME), modifier = Modifier.platz(20f, kartenOben, 362f))
                liste.fehler.isNotEmpty() -> FehlerKasten(liste.fehler, Modifier.platz(20f, kartenOben, 362f))
                gefiltert.isEmpty() -> Box(
                    Modifier.platz(20f, kartenOben, 362f, 84f).background(hex(0x0E0E0E)).border(1.dp, hex(0x2A2A2A)).padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { Text("Keine Fahrer für diesen Filter gefunden.", style = grotesk(16f, 500, farbe = LIME)) }
                else -> gefiltert.forEachIndexed { i, f ->
                    androidx.compose.runtime.key(f.id) {
                        FahrerKarte(
                            f, f.imDienst(jetzt), f.id in markiert, Modifier.platz(20f, kartenOben + i * kartenSchritt, 362f, 84f),
                            antippen = { if (markiert.isNotEmpty()) umschalten(f.id) else (oeffnen ?: bearbeiten)(f) },
                            markieren = { umschalten(f.id) },
                            bearbeiten = { bearbeiten(f) },
                        )
                    }
                }
            }
        }

        if (markiert.isNotEmpty()) {
            // Flaggen: eine Reihe ueber der Leiste, setzen die Flagge bei allen Markierten.
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(end = 36.dp, bottom = 226.dp), contentAlignment = Alignment.BottomEnd) {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (flaggenFehler.isNotEmpty()) {
                        Box(Modifier.widthIn(max = 362.dp).background(hex(0x171717)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text(flaggenFehler, style = grotesk(12f, 500, 12f * 1.35f, farbe = hex(0xFF8E8E)))
                        }
                    }
                    FlaggenKnoepfe(
                        ids = markiert.toList(),
                        flaggeVon = { id -> liste.fahrer.firstOrNull { it.id == id }?.flagge },
                        wahl = { flaggeWaehlen(it) },
                        waagerecht = true,
                    )
                }
            }
            // Markierung loeschen: right 24, bottom 160.
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(end = 24.dp, bottom = 160.dp), contentAlignment = Alignment.BottomEnd) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.height(54.dp).background(Color.Black).border(2.dp, LIME).tippen { planenOffen = true }.padding(horizontal = 20.dp), contentAlignment = Alignment.Center) {
                        Text("Dienste planen", style = grotesk(16f, 500, abstand = 0.4f, farbe = LIME))
                    }
                    // Rot mit dem TRISAR-Schliessen-Icon, Rand schwarz wie der Auswahlknopf der Karte.
                    Box(Modifier.size(54.dp).background(hex(0xFF6F63), CircleShape).border(2.dp, Color.Black, CircleShape).tippen { markiert.clear() }, contentAlignment = Alignment.Center) {
                        Icon("Schliessen_Trisar_Icons_01", Modifier.size(22.dp))
                    }
                }
            }
        }
        if (exportOffen) StundenExportFenster { exportOffen = false }
        if (planenOffen) {
            DienstePlanenBlatt(markiert.toList()) { planenOffen = false; scope.launch { liste.laden() } }
        }

        // Mit offener Tastatur blendet das Web die Leiste aus.
        if (!sucheFokus) Navileiste(DispoZiel.FAHRER, zeigen)
    }
}

private fun gefilterteFahrer(
    basis: List<DispoFahrer>, suche: String, statusFilter: String,
    startZeit: String, startDatum: String, endZeit: String, endDatum: String, jetzt: LocalTime,
): List<DispoFahrer> {
    // Suche: mehrere Begriffe mit ';', reine Zahl mit ';' = genaue Fahrernummer.
    val teile = suche.split(";")
    val endetMitStrich = suche.trimEnd().endsWith(";")
    val begriffe = teile.mapIndexedNotNull { i, roh ->
        val t = roh.trim().lowercase()
        if (t.isEmpty()) return@mapIndexedNotNull null
        val abgeschlossen = i < teile.size - 1 || endetMitStrich
        t to (t.all { it.isDigit() } && abgeschlossen)
    }
    fun wert(f: DispoFahrer, b: Pair<String, Boolean>): Int {
        val name = f.name.lowercase(); val fz = f.vehicle.lowercase(); val nr = f.driverNumber?.toString() ?: ""
        val t = b.first
        if (b.second) return if (nr == t) 1000 else -1
        return when {
            name == t -> 920
            name.startsWith(t) -> 860
            nr == t -> 820
            nr.startsWith(t) -> 780
            name.contains(t) -> 730
            nr.contains(t) -> 700
            fz.startsWith(t) -> 640
            fz.contains(t) -> 600
            else -> -1
        }
    }
    val nachSuche = if (begriffe.isEmpty()) basis else basis.mapIndexedNotNull { i, f ->
        val w = begriffe.map { wert(f, it) }.filter { it >= 0 }
        val beste = w.maxOrNull() ?: return@mapIndexedNotNull null
        Triple(f, i, beste + (w.size - 1) * 10)
    }.sortedWith(compareByDescending<Triple<DispoFahrer, Int, Int>> { it.third }.thenBy { it.second }).map { it.first }

    val nachStatus = nachSuche.filter { f ->
        when (statusFilter) {
            "im_dienst" -> f.imDienst(jetzt)
            "frei" -> !f.imDienst(jetzt) && !f.unfertig
            "unfertig" -> f.unfertig
            else -> true
        }
    }

    // Absolutes Zeitfenster aus Datum + Uhrzeit (Minuten seit heute 00:00), auch ueber Mitternacht.
    if (startZeit.isEmpty() && endZeit.isEmpty()) return nachStatus
    return nachStatus.filter { f ->
        val s = Dienstzeit.minuten(f.serviceStartTime) ?: return@filter false
        val e = Dienstzeit.minuten(f.serviceEndTime) ?: return@filter false
        val startTag = Dienstzeit.tagAbstand(startDatum) ?: 0
        val endTag = Dienstzeit.tagAbstand(endDatum) ?: startTag
        val schichtStart = startTag * 1440 + s
        val schichtEnde = schichtStart + if (e >= s) e - s else 1440 - s + e
        val fs = Dienstzeit.minuten(startZeit)
        if (fs != null && schichtStart < startTag * 1440 + fs) return@filter false
        val fe = Dienstzeit.minuten(endZeit)
        if (fe != null && schichtEnde > endTag * 1440 + fe) return@filter false
        true
    }
}

// MARK: - Planungsuebersicht (PlanningOverviewChart)

/**
 * 362 x 198: Balken Fahrer, Linie Fahrten, gestrichelt Bedarf. 18-Stunden-Fenster aus 72 h,
 * stundenweise per Wischen verschiebbar.
 */
@Composable
private fun PlanungsUebersicht(
    angebot: List<Int>, fahrten: List<Int>, bedarf: List<Int>,
    start: Int, startSetzen: (Int) -> Unit, modifier: Modifier, kiPlaner: () -> Unit,
) {
    val breite = 362f; val hoehe = 198f
    val links = 36f; val oben = 52f; val unten = 34f
    val plotBreite = breite - links
    val plotHoehe = hoehe - oben - unten
    val fenster = Planung.FENSTER
    val maxStart = max(0, angebot.size - fenster)
    val anfang = max(0, min(maxStart, start))
    val stunden = (0 until fenster).map { anfang + it }
    val a = stunden.map { angebot.getOrElse(it) { 0 } }
    val f = stunden.map { fahrten.getOrElse(it) { 0 } }
    val b = stunden.map { bedarf.getOrElse(it) { 0 } }
    val maxWert = max(1, (a + f + b).maxOrNull() ?: 0)
    val messer = rememberTextMeasurer()
    val anfangAktuell by rememberUpdatedState(anfang)
    val setzenAktuell by rememberUpdatedState(startSetzen)

    // "Mi., 04.11. – Do., 05.11. · zum Blättern wischen"
    val df = DateTimeFormatter.ofPattern("EEE, dd.MM.", Locale.GERMANY)
    fun tag(h: Int) = LocalDate.now().plusDays((h / 24).toLong()).format(df)
    val ta = tag(stunden.first()); val te = tag(stunden.last())
    val datumsZeile = if (ta == te) "$ta · zum Blättern wischen" else "$ta – $te · zum Blättern wischen"

    Box(modifier) {
        Text("Planungsübersicht", style = grotesk(16f, 600, abstand = 0.2f, farbe = Color.White), modifier = Modifier.platz(0f, 10f), maxLines = 1)
        Text(datumsZeile, style = grotesk(11f, 500, abstand = 0.2f, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.platz(0f, 30f), maxLines = 1)

        Canvas(Modifier.size(breite.dp, hoehe.dp)) {
            val d = density
            val schritt = plotBreite / fenster
            val balken = max(8f, schritt * 0.82f)
            val grund = oben + plotHoehe
            fun y(v: Int) = oben + (plotHoehe - max(0, v).toFloat() / maxWert * plotHoehe)
            fun mitte(i: Int) = links + i * schritt + schritt / 2
            fun p(x: Float, yy: Float) = Offset(x * d, yy * d)
            fun schrift(text: String, farbe: Color, x: Float, yy: Float, ax: Float) {
                val m = messer.measure(text, TextStyle(fontFamily = de.trisar.kern.Grotesk, fontWeight = androidx.compose.ui.text.font.FontWeight(600), fontSize = 11.sp, color = farbe))
                drawText(m, topLeft = Offset(x * d - m.size.width * ax, yy * d - m.size.height / 2f))
            }

            val achse = hex(0x6A6A6A)
            drawLine(achse, p(links, oben), p(links, grund), d)
            drawLine(achse, p(links, grund), p(breite, grund), d)

            for (wert in listOf(maxWert, max(0, Math.round(maxWert / 2.0).toInt()), 0)) {
                val yy = y(wert)
                drawLine(hex(0x9A9A9A), p(links - 4, yy), p(links, yy), d)
                schrift("$wert", hex(0xB7B7B7), links - 8, yy, 1f)
            }

            for (i in 0 until fenster) {
                val v = max(0, a[i])
                val yy = y(v)
                val h = max(0f, grund - yy)
                if (h <= 0f) continue
                drawRoundRect(
                    hex(0x45A8B6, 0.95f), p(links + i * schritt + (schritt - balken) / 2, yy), Size(balken * d, h * d),
                    CornerRadius(min(3f, h / 2) * d),
                )
            }

            val linie = Path(); val bedarfLinie = Path()
            for (i in 0 until fenster) {
                val p1 = p(mitte(i), y(f[i])); val p2 = p(mitte(i), y(b[i]))
                if (i == 0) { linie.moveTo(p1.x, p1.y); bedarfLinie.moveTo(p2.x, p2.y) } else { linie.lineTo(p1.x, p1.y); bedarfLinie.lineTo(p2.x, p2.y) }
            }
            drawPath(linie, hex(0x59BE80), style = Stroke(3 * d, cap = StrokeCap.Round, join = StrokeJoin.Round))
            drawPath(bedarfLinie, hex(0xE3F654), style = Stroke(2 * d, cap = StrokeCap.Round, join = StrokeJoin.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(6 * d, 4 * d))))

            stunden.forEachIndexed { i, abs ->
                if (abs % 3 != 0) return@forEachIndexed
                val stunde = abs % 24
                val mitternacht = stunde == 0
                val text = if (mitternacht) Dienstzeit.tagMonat(Dienstzeit.plusTage(Dienstzeit.heute(), abs / 24)) else "%02d Uhr".format(stunde)
                schrift(text, hex(if (mitternacht) 0xE3F654 else 0xB7B7B7), mitte(i), hoehe - 12, 0.5f)
            }
        }

        // Wischflaeche ueber dem Plot.
        Box(
            Modifier.platz(links, oben, plotBreite, plotHoehe + unten).pointerInput(Unit) {
                var zugStart = 0
                var weg = 0f
                detectHorizontalDragGestures(
                    onDragStart = { zugStart = anfangAktuell; weg = 0f },
                    onHorizontalDrag = { c, dx ->
                        weg += dx / density
                        val schritt = plotBreite / fenster
                        val neu = max(0, min(maxStart, zugStart + (-weg / schritt).roundToInt()))
                        if (neu != anfangAktuell) setzenAktuell(neu)
                        c.consume()
                    },
                )
            },
        )

        Row(Modifier.platz(0f, 10f, breite, 26f), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(28.dp, 26.dp).tippen(kiPlaner), contentAlignment = Alignment.Center) {
                Icon("KI_Trisar_Icons_01_Lime", Modifier.size(13.dp))
            }
            Legende("Fahrer", 0x45A8B6) { Box(Modifier.size(10.dp).background(hex(0x45A8B6), RoundedCornerShape(2.dp))) }
            Legende("Fahrten", 0x59BE80) { Box(Modifier.size(12.dp, 2.dp).background(hex(0x59BE80))) }
            Legende("Bedarf", 0xE3F654) {
                Canvas(Modifier.size(12.dp, 2.dp)) {
                    drawLine(hex(0xE3F654), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), size.height,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(2 * density, 2 * density)))
                }
            }
        }
    }
}

@Composable
private fun Legende(text: String, farbe: Long, zeichen: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        zeichen()
        Text(text, style = grotesk(11f, 500, farbe = hex(farbe)), maxLines = 1)
    }
}

// MARK: - Karte, Chip, Zeitfeld

/** DriverCard: 362 x 84, nach rechts wischen markiert, nach links wischen bearbeitet. */
@Composable
private fun FahrerKarte(
    fahrer: DispoFahrer, imDienst: Boolean, markiert: Boolean, modifier: Modifier,
    antippen: () -> Unit, markieren: () -> Unit, bearbeiten: () -> Unit,
) {
    val aktionsBreite = 90f; val oeffnen = 36f; val ausloesen = 124f; val maxVersatz = 160f
    val versatz = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val markierenAktuell by rememberUpdatedState(markieren)
    val bearbeitenAktuell by rememberUpdatedState(bearbeiten)
    fun schliessen() { scope.launch { versatz.animateTo(0f, tween(220, easing = EaseOut)) } }

    val v = versatz.value
    val links = max(0f, v); val rechts = max(0f, -v)
    Box(modifier.clipToBounds()) {
        // Aktionen hinter der Karte.
        Box(Modifier.platz(0f, 0f, maxVersatz, 84f).background(LIME).tippen { schliessen(); markieren() }) {
            Icon("Faecher_Done", Modifier.platz(links / 2 - 17, 25f, 34f, 34f))
        }
        Box(Modifier.platz(362f - maxVersatz, 0f, maxVersatz, 84f).background(LIME).tippen { schliessen(); bearbeiten() }) {
            Icon("Edit_Trisar_Icon_01", Modifier.platz(maxVersatz - rechts / 2 - 17, 25f, 34f, 34f))
        }

        val hinten: Long = if (fahrer.unfertig) 0xFF6F63 else if (imDienst) 0xFFFFFF else 0x59BE80
        val zeitFarbe = hex(Dienstzeit.anfrageFarbe(fahrer.planRequestStatus))
        val fahrzeug = fahrer.vehicle.trim()
        Box(
            Modifier.offset(v.dp).size(362.dp, 84.dp).background(hex(hinten))
                .border(2.dp, if (markiert) LIME else Color.Transparent)
                .tippen { if (versatz.value != 0f) schliessen() else antippen() }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onHorizontalDrag = { c, dx ->
                            c.consume()
                            scope.launch { versatz.snapTo(max(-maxVersatz, min(maxVersatz, versatz.value + dx / density))) }
                        },
                        onDragEnd = {
                            val w = versatz.value
                            when {
                                w >= ausloesen -> { schliessen(); markierenAktuell() }
                                w <= -ausloesen -> { schliessen(); bearbeitenAktuell() }
                                w > oeffnen -> scope.launch { versatz.animateTo(aktionsBreite, tween(220, easing = EaseOut)) }
                                w < -oeffnen -> scope.launch { versatz.animateTo(-aktionsBreite, tween(220, easing = EaseOut)) }
                                else -> schliessen()
                            }
                        },
                        onDragCancel = { schliessen() },
                    )
                },
        ) {
            Column(Modifier.platz(18f, 12f, 250f, 60f), verticalArrangement = Arrangement.Center) {
                PassenderText(fahrer.name, 30f, 8f, 250f, 700, hex(0x18181B))
                TextZeile(fahrzeug.ifEmpty { "Kein Fahrzeug zugewiesen" }, grotesk(14f, 500, abstand = 0.35f, farbe = hex(0x18181B, 0.8f)),
                    Modifier.width(250.dp), hoehe = 16f)
            }
            TextZeile("#${fahrer.driverNumber?.toString() ?: "-"}", grotesk(18f, 500, abstand = -0.45f, farbe = hex(0x171717)),
                Modifier.platz(0f, 12f, 362f - 18f, 20f), hoehe = 20f, ausrichtung = Alignment.CenterEnd)
            Column(Modifier.platz(0f, 84f - 10f - 32f, 362f - 14f, 32f), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                TextZeile(fahrer.serviceStartTime.ifEmpty { "--:--" }, grotesk(15f, 600, abstand = 0.2f, farbe = zeitFarbe), hoehe = 15f, ausrichtung = Alignment.CenterEnd)
                TextZeile("- ${fahrer.serviceEndTime.ifEmpty { "--:--" }}", grotesk(15f, 600, abstand = 0.2f, farbe = zeitFarbe), hoehe = 15f, ausrichtung = Alignment.CenterEnd)
            }
            // Flagge: haengt oben links buendig an der Kante der Karte, wie eine Lasche.
            fahrer.flagge?.let { FlaggeMitRand(it, modifier = Modifier.platz(5.2f, -0.8f, 15.6f, 19.6f)) }
        }
    }
}

/** Einzeiliger Text, der bis zur Mindestgroesse schrumpft (minimumScaleFactor in iOS). */
@Composable
private fun PassenderText(text: String, groesse: Float, minimum: Float, breite: Float, gewicht: Int, farbe: Color) {
    val messer = rememberTextMeasurer()
    var g = groesse
    val grenze = with(androidx.compose.ui.platform.LocalDensity.current) { breite.dp.roundToPx() }
    while (g > minimum) {
        val m = messer.measure(text, grotesk(g, gewicht, farbe = farbe), maxLines = 1, softWrap = false, constraints = Constraints())
        if (m.size.width <= grenze) break
        g -= 1f
    }
    Text(text, style = grotesk(max(g, minimum), gewicht, farbe = farbe), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.width(breite.dp))
}

/** StatusChip: 112 x 42, Rand in Chip-Farbe, gewaehlt gefuellt. */
@Composable
private fun StatusChip(text: String, farbe: Long, gewaehlt: Boolean, modifier: Modifier, aktion: () -> Unit) {
    Box(
        modifier.background(if (gewaehlt) hex(farbe) else Color.Transparent).border(2.dp, hex(farbe)).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = 0.4f, farbe = if (gewaehlt) hex(0x171717) else hex(farbe)))
    }
}

/** TimeField: Uhrzeit + Datum (tt.mm.) in einem 56er-Kasten, X setzt beides zurueck. */
@Composable
private fun ZeitFilterFeld(zeit: String, datum: String, platzhalter: String, modifier: Modifier, waehlen: (Boolean) -> Unit, leeren: () -> Unit) {
    val belegt = zeit.isNotEmpty() || datum.isNotEmpty()
    Box(modifier.border(2.dp, GELB).clipToBounds()) {
        if (!belegt) {
            Row(Modifier.fillMaxSize().tippen { waehlen(true) }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(platzhalter, style = grotesk(16f, 500, abstand = 0.4f, farbe = GELB))
                Spacer(Modifier.weight(1f))
                Icon("Uhr_Trisar_Icon_01_Lime", Modifier.size(20.dp))
            }
        } else {
            Row(Modifier.fillMaxSize().padding(start = 12.dp, end = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(zeit.ifEmpty { "--:--" }, style = grotesk(18f, 600, abstand = 0.45f, farbe = GELB), modifier = Modifier.weight(1f), maxLines = 1)
                Box(Modifier.padding(start = 6.dp).width(1.dp).height(12.dp).background(GELB.copy(alpha = 0.4f)))
                TextZeile(if (datum.isEmpty()) "tt.mm." else Dienstzeit.tagMonat(datum), grotesk(12f, 500, abstand = 0.3f, farbe = GELB.copy(alpha = 0.85f)),
                    Modifier.width(44.dp), hoehe = 12f, ausrichtung = Alignment.CenterEnd)
            }
            // Tipp-Flaechen wie die unsichtbaren input-Felder im Web.
            Box(Modifier.platz(0f, 0f, 73f, 56f).tippen { waehlen(true) })
            Box(Modifier.platz(75f, 0f, 50f, 56f).tippen { waehlen(false) })
            Box(Modifier.platz(175f - 4f - 36f, 10f, 36f, 36f).tippen(leeren), contentAlignment = Alignment.Center) {
                Text("X", style = grotesk(38f, 700, farbe = LIME), maxLines = 1, softWrap = false)
            }
        }
    }
}

/** Nachbau von FahrerListeView.jsx: im Web eine feste Beispielliste ohne Datenbank (FahrerListeAnsicht.swift). */
@Composable
internal fun FahrerListeSeite(zeigen: (DispoZiel) -> Unit) {
    val eintraege = listOf("Horst Engel" to "verfügbar", "Mara Stein" to "auf Fahrt", "Daniel Koch" to "Pause")
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        de.trisar.kern.DispoHintergrund()
        Leinwand {
            RahmenKnopf("Zurück", Modifier.platz(20f, 60f, null, 40f)) { zeigen(DispoZiel.START) }
            Box(Modifier.platz(0f, 60f, 402f - 20f, 40f), contentAlignment = Alignment.TopEnd) {
                RahmenKnopf("Profil", Modifier.height(40.dp)) { zeigen(DispoZiel.PROFIL) }
            }
            StammTitel("Fahrer Liste", Modifier.platz(20f, 130f), abstand = -0.5f)
            Column(Modifier.platz(20f, 200f, 362f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((name, status) in eintraege) {
                    Column(
                        Modifier.fillMaxWidth().background(hex(0x101010)).border(1.dp, hex(0x2F2F2F)).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(name, style = grotesk(18f, farbe = Color.White))
                        Text("Status: $status", style = grotesk(14f, farbe = hex(0x898889)))
                    }
                }
            }
            Box(Modifier.platz(20f, 640f, 362f, 56f).background(LIME).tippen { zeigen(DispoZiel.KUNDEN) }, contentAlignment = Alignment.Center) {
                Text("Zur Kunden Liste", style = grotesk(16f, 500, farbe = hex(0x262626)))
            }
        }
        Navileiste(DispoZiel.START, zeigen)
    }
}

@Composable
private fun RahmenKnopf(text: String, modifier: Modifier, aktion: () -> Unit) {
    Box(modifier.border(1.dp, hex(0x747474)).tippen(aktion).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        Text(text, style = grotesk(14f, farbe = LIME))
    }
}



/**
 * "Dienste planen" fuer die markierten Fahrer (wie DienstePlanenBlatt.jsx und applyBulkPlanning in AlleFahrer.jsx).
 * Gestaltung wie die Stundenerfassung der Fahrer-App (Figma 2838:12842): dunkle Karte mit gruenem Rand,
 * vier Kacheln Start | Pause | Pause | Ende, darunter die Dauer gross in Lime, unten Rot (Abbrechen) und
 * Gruen (Senden). Dienststart und Dienstende sind unabhaengig: was leer bleibt, wird nicht gesendet.
 * Eine Kachel antippen waehlt sie aus, Plus und Minus darunter verschieben die Zeit in 15-Minuten-Schritten.
 * Legt je Fahrer eine Dienstanfrage an (driver_service_requests, pending) und speichert die Pausen in dienst_pausen.
 */
/** Fahrer bearbeiten: Tag, Zeiten und Pausen eines vorhandenen Dienstes vorbelegen (tag null = neuer Dienst, Tag im Kalender waehlen). */
internal data class DienstVorgabe(
    val tag: String?,
    val start: String = "",
    val ende: String = "",
    val pausen: List<Pair<String, String>> = emptyList(),
)

/** Vorhandener Dienst eines Fahrers an einem Tag (wie dienstBestandLaden im Web). */
internal data class DienstBestand(
    val id: String,
    val start: String,
    val ende: String,
    val pausen: List<Pair<String, String>>,
    val angenommen: Boolean,
    val vorher: Triple<String, String, List<Pair<String, String>>>?,
    /** Treffpunkt und Notiz beim Dienststart (dienst_treffpunkt): Text im Feld, eigener Ort (orte.id) und Notiz. */
    val treffpunktText: String = "",
    val treffpunktOrtID: String = "",
    val notiz: String = "",
)

/** Vergleichsschluessel: hat die Dispo Ort oder Notiz geaendert? (treffpunktSchluessel im Web) */
private fun dpTreffpunktSchluessel(text: String, ortID: String, notiz: String) = listOf(ortID, text.trim(), notiz.trim())

/** Aufgeloester Treffpunkt fuer dienst_treffpunkt (ohne dienst_id), null = nichts gesetzt. */
private sealed interface DpTreffpunktErgebnis {
    data object Leer : DpTreffpunktErgebnis
    data class Zeile(val werte: kotlinx.serialization.json.JsonObject) : DpTreffpunktErgebnis
    data class Fehler(val text: String) : DpTreffpunktErgebnis
}

/**
 * Eingabe -> Zeile fuer dienst_treffpunkt (treffpunktAufloesen im Web). Eigener Ort: Koordinaten aus orte,
 * sonst Adresse suchen. Nicht gefunden: Fehler, damit nichts halb gesendet wird.
 */
private suspend fun dpTreffpunktAufloesen(ctx: android.content.Context, text: String, ortID: String, notiz: String): DpTreffpunktErgebnis {
    val t = text.trim()
    val n = notiz.trim()
    if (t.isEmpty() && n.isEmpty()) return DpTreffpunktErgebnis.Leer
    fun w(x: String?) = if (x.isNullOrEmpty()) kotlinx.serialization.json.JsonNull else kotlinx.serialization.json.JsonPrimitive(x)
    fun z(x: Double?) = if (x == null) kotlinx.serialization.json.JsonNull else kotlinx.serialization.json.JsonPrimitive(x)
    var ort: String? = null; var name: String? = null; var adresse: String? = null; var lat: Double? = null; var lng: Double? = null
    if (t.isNotEmpty()) {
        if (ortID.isNotEmpty()) de.trisar.kern.EigeneOrte.einmalLaden()
        val eigener = de.trisar.kern.EigeneOrte.zuID(ortID.ifEmpty { null })
        if (eigener != null) {
            ort = eigener.id; name = eigener.name; adresse = eigener.adresse.ifEmpty { null }; lat = eigener.lat; lng = eigener.lng
        } else {
            val p = de.trisar.kern.Routen.punkt(ctx, t)
                ?: return DpTreffpunktErgebnis.Fehler("Treffpunkt nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen.")
            name = t.split(",").first().trim(); adresse = t; lat = p.lat; lng = p.lng
        }
    }
    return DpTreffpunktErgebnis.Zeile(kotlinx.serialization.json.buildJsonObject {
        put("ort_id", w(ort)); put("name", w(name)); put("adresse", w(adresse))
        put("lat", z(lat)); put("lng", z(lng)); put("notiz", w(n))
    })
}

/** Fuer diese Dienste speichern, bei Leer entfernen (treffpunktSpeichern im Web). */
private suspend fun dpTreffpunktSpeichern(dienstIDs: List<String>, ergebnis: DpTreffpunktErgebnis) {
    val ids = dienstIDs.filter { it.isNotEmpty() }
    if (ids.isEmpty()) return
    val c = Backend.client
    when (ergebnis) {
        is DpTreffpunktErgebnis.Zeile -> {
            val jetzt = java.time.Instant.now().toString()
            c.from("dienst_treffpunkt").upsert(ids.map { id ->
                kotlinx.serialization.json.JsonObject(ergebnis.werte + mapOf(
                    "dienst_id" to kotlinx.serialization.json.JsonPrimitive(id),
                    "aktualisiert" to kotlinx.serialization.json.JsonPrimitive(jetzt),
                ))
            })
        }
        else -> c.from("dienst_treffpunkt").delete { filter { isIn("dienst_id", ids) } }
    }
}

/** Letzter nicht abgelehnter Dienst je Fahrer und Tag (fuer eine reine Treffpunkt-Aenderung ohne neue Zeile). */
private suspend fun dpVorhandeneDienste(fahrerIDs: List<String>, tage: List<String>): List<String> {
    val zeilen = Backend.client.from("driver_service_requests").select(io.github.jan.supabase.postgrest.query.Columns.raw("id, driver_id, service_date, status, created_at")) {
        filter { isIn("driver_id", fahrerIDs); isIn("service_date", tage) }
        order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
    }.decodeList<kotlinx.serialization.json.JsonObject>()
    fun s(o: kotlinx.serialization.json.JsonObject, k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
    val gesehen = mutableSetOf<String>()
    return zeilen.filter { d ->
        val k = "${s(d, "driver_id")}|${s(d, "service_date")}"
        if (k in gesehen || s(d, "status").lowercase() == "refused") false else { gesehen += k; true }
    }.map { s(it, "id") }
}

/** Letzte nicht abgelehnte Dienstzeile des Tages mit Pausen und gemerktem angenommenem Stand. */
internal suspend fun dienstBestandLaden(fahrer: String, tag: String): DienstBestand? = runCatching {
    val c = Backend.client
    fun text(o: kotlinx.serialization.json.JsonElement?, k: String) =
        ((o as? kotlinx.serialization.json.JsonObject)?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty().take(5)
    fun pausenAus(e: kotlinx.serialization.json.JsonElement?) = ((e as? kotlinx.serialization.json.JsonArray) ?: emptyList())
        .map { text(it, "von") to text(it, "bis") }.filter { it.first.isNotEmpty() && it.second.isNotEmpty() }
    val zeilen = c.from("driver_service_requests").select(io.github.jan.supabase.postgrest.query.Columns.raw("id, service_start_time, service_end_time, status, created_at")) {
        filter { eq("driver_id", fahrer); eq("service_date", tag) }
        order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
        limit(5)
    }.decodeList<kotlinx.serialization.json.JsonObject>()
    val d = zeilen.firstOrNull { ((it["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "").lowercase() != "refused" } ?: return@runCatching null
    val id = (d["id"] as kotlinx.serialization.json.JsonPrimitive).content
    val status = ((d["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "").lowercase()
    val p = c.from("dienst_pausen").select(io.github.jan.supabase.postgrest.query.Columns.list("pausen")) { filter { eq("dienst_id", id) } }
        .decodeList<kotlinx.serialization.json.JsonObject>().firstOrNull()
    val a = c.from("dienst_aenderung").select(io.github.jan.supabase.postgrest.query.Columns.list("vorher")) { filter { eq("dienst_id", id) } }
        .decodeList<kotlinx.serialization.json.JsonObject>().firstOrNull()?.get("vorher") as? kotlinx.serialization.json.JsonObject
    // Treffpunkt und Notiz (dienst_treffpunkt). Fehlt die Tabelle noch, bleibt es leer.
    val tp = runCatching {
        c.from("dienst_treffpunkt").select(io.github.jan.supabase.postgrest.query.Columns.raw("ort_id, name, adresse, notiz")) { filter { eq("dienst_id", id) } }
            .decodeList<kotlinx.serialization.json.JsonObject>().firstOrNull()
    }.getOrNull()
    fun tpText(k: String) = ((tp?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content).orEmpty()
    val tpOrt = tpText("ort_id")
    DienstBestand(id, text(d, "service_start_time"), text(d, "service_end_time"), pausenAus(p?.get("pausen")), status == "accepted",
        a?.let { Triple(text(it, "start"), text(it, "ende"), pausenAus(it["pausen"])) },
        treffpunktText = if (tpOrt.isNotEmpty()) tpText("name") else tpText("adresse").ifEmpty { tpText("name") },
        treffpunktOrtID = tpOrt, notiz = tpText("notiz"))
}.getOrNull()

@Composable
internal fun DienstePlanenBlatt(fahrerIDs: List<String>, vorgabe: DienstVorgabe? = null, fertig: () -> Unit) {
    val gruen = hex(0x59BE80); val rot = hex(0xFF6F63); val kachelGrund = hex(0x242525); val grau = hex(0x5F5F5F)
    val schritt = 15
    val scope = rememberCoroutineScope()
    /** Gewaehlte Tage (Kalender wie bei Fahrt anlegen), sortiert, mindestens einer. Standard heute. */
    var tageListe by remember { mutableStateOf(if (vorgabe != null) listOfNotNull(vorgabe.tag) else listOf(LocalDate.now().toString())) }
    val dialogKontext = LocalContext.current
    var start by remember { mutableStateOf(vorgabe?.start ?: "") }
    var ende by remember { mutableStateOf(vorgabe?.ende ?: "") }
    val pausen = remember { mutableStateListOf<Pair<String, String>>().apply { vorgabe?.pausen?.let { addAll(it) } } }
    // Treffpunkt beim Dienststart (Text + eigener Ort wie beim Standby) und Notiz an den Fahrer (13.11.).
    var treffText by remember { mutableStateOf("") }
    var treffOrtID by remember { mutableStateOf("") }
    var treffNotiz by remember { mutableStateOf("") }
    var treffVorschlaege by remember { mutableStateOf(emptyList<String>()) }
    var treffOffen by remember { mutableStateOf(false) }
    var treffLauf by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    val fokus = LocalFocusManager.current
    LaunchedEffect(Unit) { de.trisar.kern.EigeneOrte.einmalLaden() }
    /** Welche Zeit Plus und Minus verschieben: "start", "ende", "p0-von", "p1-bis" ... */
    var feld by remember { mutableStateOf<String?>(if (vorgabe?.start.isNullOrEmpty()) null else "start") }
    val radCtx = LocalContext.current
    var kalenderOffen by remember { mutableStateOf(false) }
    var speichert by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf<String?>(null) }
    val vorlagen = listOf(Triple("Früh", "06:00", "14:00"), Triple("Tag", "08:00", "16:00"), Triple("Spät", "14:00", "22:00"), Triple("Nacht", "22:00", "06:00"))
    fun uhr(min: Int): String { val x = ((min % 1440) + 1440) % 1440; return "%02d:%02d".format(x / 60, x % 60) }
    fun minuten(w: String) = Dienstzeit.minuten(w)
    /** Spanne ueber Mitternacht gerechnet (Nachtdienst 22–06 = 8 h). */
    fun spanne(von: String, bis: String): Int {
        val a = minuten(von) ?: return 0; val b = minuten(bis) ?: return 0
        return (((b - a) + 1440) % 1440).let { if (it == 0) 1440 else it }
    }
    /** "Heute 11.11.", "Morgen 12.11.", sonst "Mi 13.11." (tagText im Web). */
    fun tagText(iso: String): String {
        val d = runCatching { LocalDate.parse(iso) }.getOrNull() ?: return iso
        val datum = d.format(DateTimeFormatter.ofPattern("dd.MM."))
        val heute = LocalDate.now()
        return when (d) {
            heute -> "Heute $datum"
            heute.plusDays(1) -> "Morgen $datum"
            else -> "${d.format(DateTimeFormatter.ofPattern("EE", Locale.GERMAN)).removeSuffix(".")} $datum"
        }
    }
    val pausenIndex = feld?.takeIf { it.startsWith("p") }?.substring(1, 2)?.toIntOrNull()
    val pausenFeld = if (pausenIndex != null) feld?.substring(3) else null
    val feldWert = when {
        feld == "start" -> start
        feld == "ende" -> ende
        pausenIndex != null -> pausen.getOrNull(pausenIndex)?.let { if (pausenFeld == "von") it.first else it.second } ?: ""
        else -> ""
    }
    fun feldSetzen(wert: String) {
        when {
            feld == "start" -> start = wert
            feld == "ende" -> ende = wert
            pausenIndex != null && pausenIndex < pausen.size -> {
                val p = pausen[pausenIndex]
                pausen[pausenIndex] = if (pausenFeld == "von") wert to p.second else p.first to wert
            }
        }
        fehler = null
    }
    /** Feld weglassen: Start oder Ende wird nicht gesendet, eine Pause faellt weg. */
    fun feldEntfernen() {
        when {
            feld == "start" -> start = ""
            feld == "ende" -> ende = ""
            pausenIndex != null && pausenIndex < pausen.size -> pausen.removeAt(pausenIndex)
        }
        feld = null
    }
    // Drehrad wie in der Stundenerfassung: Stunden und Minuten in 15-Minuten-Schritten.
    fun radOeffnen(wert: String) { zeitRadWaehlen(radCtx, minuten(wert) ?: 480) { feldSetzen(it) } }
    fun zeitTippen(welches: String) {
        val wert = if (welches == "start") start else ende
        if (wert.isEmpty()) {
            // Leere Kachel: sinnvolle Zeit vorschlagen (Ende 8 h nach Start, sonst 16:00).
            if (welches == "start") start = if (ende.isNotEmpty()) uhr((minuten(ende) ?: 960) - 480) else "08:00"
            else ende = if (start.isNotEmpty()) uhr((minuten(start) ?: 480) + 480) else "16:00"
        }
        feld = welches
        fehler = null
        radOeffnen(if (welches == "start") start else ende)
    }
    fun pauseTippen(index: Int, was: String) {
        if (was == "neu") {
            // Neue Pause in der Mitte des Dienstes, 30 Minuten.
            val a = minuten(start)
            val mitte = if (a != null && ende.isNotEmpty()) a + spanne(start, ende) / 2.0 else 720.0
            val von = (mitte / schritt).roundToInt() * schritt + index * 60
            pausen.add(uhr(von) to uhr(von + 30))
            feld = "p${pausen.size - 1}-von"
            radOeffnen(uhr(von))
            return
        }
        feld = "p$index-$was"
        pausen.getOrNull(index)?.let { radOeffnen(if (was == "von") it.first else it.second) }
    }

    // Genau ein Fahrer und ein Tag: vorhandenen Dienst laden und die Kacheln damit fuellen.
    var bestand by remember { mutableStateOf<DienstBestand?>(null) }
    var hatteBestand by remember { mutableStateOf(false) }
    val schluessel = if (fahrerIDs.size == 1 && tageListe.size == 1) "${fahrerIDs[0]}|${tageListe[0]}" else ""
    LaunchedEffect(schluessel) {
        val b = if (schluessel.isEmpty()) null else dienstBestandLaden(fahrerIDs[0], tageListe[0])
        bestand = b
        if (b != null) {
            start = b.start; ende = b.ende; pausen.clear(); pausen.addAll(b.pausen)
            treffText = b.treffpunktText; treffOrtID = b.treffpunktOrtID; treffNotiz = b.notiz
        } else if (hatteBestand) {
            start = ""; ende = ""; pausen.clear()
            treffText = ""; treffOrtID = ""; treffNotiz = ""
        }
        hatteBestand = b != null
        feld = null
    }
    fun gleichePausen(a: List<Pair<String, String>>, b: List<Pair<String, String>>) = a == b
    /** Zustand eines vorausgefuellten Feldes: "neu" (geaendert), "bestaetigt" oder "angefragt". */
    fun zustand(welches: String): String? {
        val b = bestand ?: return null
        val (gleich, leer, wieVorher) = when (welches) {
            "start" -> Triple(start == b.start, start.isEmpty(), b.vorher?.first == start)
            "ende" -> Triple(ende == b.ende, ende.isEmpty(), b.vorher?.second == ende)
            else -> Triple(gleichePausen(pausen.toList(), b.pausen), pausen.isEmpty(), b.vorher?.let { gleichePausen(it.third, pausen.toList()) } ?: false)
        }
        return when {
            !gleich -> "neu"
            leer -> null
            b.angenommen -> "bestaetigt"
            b.vorher != null -> if (wieVorher) "bestaetigt" else "angefragt"
            else -> "angefragt"
        }
    }
    val zStart = zustand("start"); val zEnde = zustand("ende"); val zPausen = zustand("pausen")
    val treffpunktNeu = dpTreffpunktSchluessel(treffText, treffOrtID, treffNotiz) !=
        dpTreffpunktSchluessel(bestand?.treffpunktText.orEmpty(), bestand?.treffpunktOrtID.orEmpty(), bestand?.notiz.orEmpty())
    val unveraendert = bestand != null && zStart != "neu" && zEnde != "neu" && zPausen != "neu" && !treffpunktNeu
    /** Treffpunkt tippen: eigene Orte sofort, Adressvorschlaege nach kurzer Pause (wie beim Standby). */
    fun treffpunktTippen(text: String) {
        treffText = text; treffOrtID = ""; fehler = null
        treffLauf?.cancel()
        val q = text.trim()
        if (q.isEmpty()) { treffVorschlaege = emptyList(); return }
        treffOffen = true
        treffLauf = scope.launch {
            kotlinx.coroutines.delay(250)
            treffVorschlaege = de.trisar.dispo.fahrten.FahrtPruefung.ortsVorschlaege(q)
        }
    }
    /** × bei vorausgefuellten Feldern: zurueck auf den gesendeten Stand, Gesendetes selbst bleibt. */
    fun zurueck(istStart: Boolean): (() -> Unit)? {
        val gesendet = (if (istStart) bestand?.start else bestand?.ende).orEmpty()
        if (gesendet.isEmpty()) return { if (istStart) start = "" else ende = ""; feld = null }
        if ((if (istStart) zStart else zEnde) != "neu") return null
        return { if (istStart) start = gesendet else ende = gesendet; feld = null }
    }

    // Senden geht auch nur mit einer Pause (Dienst des Tages bleibt, der Fahrer bestaetigt nur die Pause).
    val nurPause = start.isEmpty() && ende.isEmpty() && pausen.isNotEmpty()
    // Reihenfolge: Dienststart < Pausenanfang < Pausenende < Dienstende (ueber Mitternacht ab Start).
    val reihenfolge = de.trisar.kern.Stunden.reihenfolgeFehler(start.ifEmpty { null }, ende.ifEmpty { null }, pausen.toList())
    val nichtsGesetzt = start.isEmpty() && ende.isEmpty() && !nurPause
    val anzahl = fahrerIDs.size
    val feldName = when {
        feld == "start" -> "Dienststart"
        feld == "ende" -> "Dienstende"
        pausenIndex != null -> "Pause ${pausenIndex + 1} ${if (pausenFeld == "von") "von" else "bis"}"
        else -> ""
    }

    fun senden() {
        if (fahrerIDs.isEmpty()) { fehler = "Bitte mindestens einen Fahrer markieren."; return }
        if (nichtsGesetzt) return
        if (reihenfolge != null) { fehler = reihenfolge; return }
        if (tageListe.isEmpty()) { fehler = "Bitte einen Tag im Kalender wählen."; return }
        // Vorausgefuellter Dienst: nur Geaendertes senden (fehlende Zeiten uebernimmt der DB-Trigger).
        val b = if (fahrerIDs.size == 1 && tageListe.size == 1) bestand else null
        val mitStart = start.isNotEmpty() && start != b?.start
        val mitEnde = ende.isNotEmpty() && ende != b?.ende
        val pausenGeaendert = b == null || !gleichePausen(pausen.toList(), b.pausen)
        val pausenWeg = b != null && pausenGeaendert && pausen.isEmpty() && b.pausen.isNotEmpty()
        // Treffpunkt oder Notiz geaendert (ohne vorhandenen Dienst: etwas eingetragen).
        val treffpunktGeaendert = dpTreffpunktSchluessel(treffText, treffOrtID, treffNotiz) !=
            dpTreffpunktSchluessel(b?.treffpunktText.orEmpty(), b?.treffpunktOrtID.orEmpty(), b?.notiz.orEmpty())
        if (b != null && !mitStart && !mitEnde && !pausenGeaendert && !treffpunktGeaendert) { fehler = "Keine Änderung zum Senden."; return }
        speichert = true; fehler = null
        val treffTage = tageListe.sorted().ifEmpty { listOf(Dienstzeit.heute()) }
        scope.launch {
            // Treffpunkt vorab aufloesen (eigener Ort oder Adresse), damit nichts halb gesendet wird.
            val tpErgebnis = if (treffpunktGeaendert) dpTreffpunktAufloesen(dialogKontext, treffText, treffOrtID, treffNotiz) else null
            if (tpErgebnis is DpTreffpunktErgebnis.Fehler) { fehler = tpErgebnis.text; speichert = false; return@launch }
            if (b != null && !mitStart && !mitEnde && (!pausenGeaendert || pausenWeg)) {
                // Nur alle Pausen entfernt und/oder nur Treffpunkt/Notiz geaendert: kein neuer Dienst.
                // Pausen weg bestaetigt der Fahrer, Treffpunkt und Notiz muss er nicht neu bestaetigen.
                try {
                    if (pausenWeg) de.trisar.kern.Backend.client.from("dienst_pausen").delete { filter { eq("dienst_id", b.id) } }
                    if (tpErgebnis != null) dpTreffpunktSpeichern(dpVorhandeneDienste(fahrerIDs, treffTage), tpErgebnis)
                    speichert = false
                    fertig()
                } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
                    fehler = (if (pausenWeg) "Pausen nicht entfernt: " else "Treffpunkt nicht gespeichert: ") + x.message
                    speichert = false
                }
                return@launch
            }
            try {
                val c = de.trisar.kern.Backend.client
                fun t(w: String?) = if (w == null) kotlinx.serialization.json.JsonNull else kotlinx.serialization.json.JsonPrimitive(w)
                // Je Fahrer und je gewaehltem Tag eine Dienstanfrage, das Profil bekommt den fruehesten Tag.
                val tage = tageListe.sorted().ifEmpty { listOf(Dienstzeit.heute()) }
                val tag = tage.first()
                // ID vergibt die App: der Treffpunkt wird VOR dem Dienst gespeichert, damit die Push-Mitteilung
                // zum neuen Dienst den Ort schon nennt (push_dienst_ausloeser liest dienst_treffpunkt beim INSERT).
                val paare = tage.flatMap { dienstTag -> fahrerIDs.map { id -> dienstTag to id } }
                val neueIDs = paare.map { java.util.UUID.randomUUID().toString() }
                val zeilen = paare.mapIndexed { i, (dienstTag, id) ->
                    kotlinx.serialization.json.buildJsonObject {
                        put("id", t(neueIDs[i]))
                        put("driver_id", t(id))
                        put("service_date", t(dienstTag))
                        put("service_start_time", t(start.takeIf { mitStart }))
                        put("service_end_time", t(ende.takeIf { mitEnde }))
                        put("status", t("pending"))
                        put("requested_by", t("dispo-android"))
                    }
                }
                if (tpErgebnis != null) {
                    try { dpTreffpunktSpeichern(neueIDs, tpErgebnis) } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
                        fehler = "Treffpunkt nicht gespeichert: ${x.message}"
                        speichert = false
                        return@launch
                    }
                }
                val neu = c.from("driver_service_requests").insert(zeilen) { select(io.github.jan.supabase.postgrest.query.Columns.list("id")) }
                    .decodeList<kotlinx.serialization.json.JsonObject>()
                    .mapNotNull { (it["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content }
                val plan = if (!pausenGeaendert) emptyList() else pausen.filter { it.first != it.second }.map { (v, bis) ->
                    kotlinx.serialization.json.buildJsonObject {
                        put("art", t("fest"))
                        put("von", t(v))
                        put("bis", t(bis))
                    }
                }
                if (plan.isNotEmpty() && neu.isNotEmpty()) {
                    val jetzt = java.time.Instant.now().toString()
                    c.from("dienst_pausen").upsert(neu.map { id ->
                        kotlinx.serialization.json.buildJsonObject {
                            put("dienst_id", t(id))
                            put("pausen", kotlinx.serialization.json.JsonArray(plan))
                            put("aktualisiert", t(jetzt))
                        }
                    })
                } else if (plan.isEmpty() && (pausenWeg || (b == null && vorgabe?.pausen?.isNotEmpty() == true)) && neu.isNotEmpty()) {
                    // Alle Pausen entfernt: der DB-Trigger hat die alten zur neuen Zeile gelegt, also weg damit.
                    runCatching { c.from("dienst_pausen").delete { filter { isIn("dienst_id", neu) } } }
                }
                // Profil: nur das gesetzte Feld, ohne Datumsspalten als Rueckfall (nur Pause: nichts).
                if (mitStart || mitEnde) runCatching {
                    c.from("profiles").update(kotlinx.serialization.json.buildJsonObject {
                        if (mitStart) { put("service_start_time", t(start)); put("service_start_date", t(tag)) }
                        if (mitEnde) { put("service_end_time", t(ende)); put("service_end_date", t(tag)) }
                    }) { filter { isIn("id", fahrerIDs) } }
                }.onFailure {
                    runCatching {
                        c.from("profiles").update(kotlinx.serialization.json.buildJsonObject {
                            if (mitStart) put("service_start_time", t(start))
                            if (mitEnde) put("service_end_time", t(ende))
                        }) { filter { isIn("id", fahrerIDs) } }
                    }
                }
                speichert = false
                fertig()
            } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
                fehler = "Senden fehlgeschlagen: ${x.message}"
                speichert = false
            }
        }
    }

    val form = RoundedCornerShape(12.dp)
    fun Modifier.kachel(aktiv: Boolean) = this.background(kachelGrund, form).then(if (aktiv) Modifier.border(2.dp, LIME, form) else Modifier)

    @Composable
    fun beschriftung(text: String, an: Boolean, zustand: String? = null) {
        Text(text, style = grotesk(16f, 700, abstand = -0.5f, farbe = if (an) Color.White else grau), textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp), maxLines = 1)
        if (bestand != null) {
            val (z, f) = when (zustand) {
                "neu" -> "Neu" to LIME
                "bestaetigt" -> "Bestätigt" to gruen
                "angefragt" -> "Angefragt" to hex(0xFFCD8A)
                else -> "" to Color.Transparent
            }
            Text(z, style = grotesk(11f, 700, 13f, farbe = f), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(), maxLines = 1)
        }
    }

    /** Kleines rotes × oben rechts wie in der Stundenerfassung: setzt die Kachel zurueck. */
    @Composable
    fun androidx.compose.foundation.layout.BoxScope.entfernenKnopf(aktion: () -> Unit) {
        Box(Modifier.align(Alignment.TopEnd).offset(x = 8.dp, y = (-8).dp).size(24.dp).background(rot, CircleShape).tippen(aktion),
            contentAlignment = Alignment.Center) {
            Text("×", style = grotesk(16f, 700, farbe = Color.Black))
        }
    }

    @Composable
    fun zeitKachel(wert: String, aktiv: Boolean, modifier: Modifier, entfernen: (() -> Unit)?, tippen: () -> Unit) {
        Box(modifier) {
            Box(Modifier.fillMaxWidth().height(69.dp).kachel(aktiv).tippen(tippen), contentAlignment = Alignment.Center) {
                Text(wert.ifEmpty { "--:--" }, style = grotesk(22f, 700, abstand = -0.5f, farbe = if (wert.isNotEmpty()) LIME else grau), maxLines = 1, softWrap = false)
            }
            if (wert.isNotEmpty() && entfernen != null) entfernenKnopf(entfernen)
        }
    }

    @Composable
    fun pausenKachel(index: Int, modifier: Modifier) {
        val p = pausen.getOrNull(index)
        val aktivFeld = if (pausenIndex == index) pausenFeld else null
        when {
            // Wie in der Stundenerfassung: gestrichelter Rahmen mit Plus.
            p == null && index == pausen.size -> Box(modifier.height(69.dp).drawBehind {
                drawRoundRect(LIME, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx(),
                    pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
            }.tippen { pauseTippen(index, "neu") }, contentAlignment = Alignment.Center) {
                Text("+", style = grotesk(28f, 700, farbe = LIME))
            }
            p == null -> Box(modifier.height(69.dp).alpha(0.5f).background(kachelGrund, form))
            else -> Box(modifier) {
                Column(Modifier.fillMaxWidth().height(69.dp).kachel(aktivFeld != null), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    for ((w, name) in listOf(p.first to "von", p.second to "bis")) {
                        Text(w, style = grotesk(17f, 700, 22f, -0.5f, if (aktivFeld == name) LIME else grau), textAlign = TextAlign.Center, maxLines = 1, softWrap = false,
                            modifier = Modifier.fillMaxWidth().tippen { pauseTippen(index, name) })
                    }
                }
                entfernenKnopf { if (index < pausen.size) pausen.removeAt(index); feld = null }
            }
        }
    }

    @Composable
    fun pfeil() {
        Icon("Pfeil_Knopf_Figma", Modifier.size(34.dp, 19.dp).rotate(180f))
    }

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).tippen { fertig() }) {
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black).tippen { }
                .navigationBarsPadding().imePadding().verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp),
        ) {
            Column(Modifier.fillMaxWidth().background(hex(0x1A1A1A)).border(2.dp, gruen).padding(start = 17.dp, end = 17.dp, top = 14.dp, bottom = 16.dp)) {
                Text("Dienste planen", style = grotesk(18f, 700, abstand = -0.5f, farbe = LIME), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                Text(if (anzahl > 0) "$anzahl Fahrer ausgewählt" else "Noch keine Fahrer ausgewählt", style = grotesk(12f, 500, farbe = Color.White.copy(alpha = 0.6f)),
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 2.dp))

                // Tage: Kalender wie bei Fahrt anlegen, beliebig viele Tage. Antippen entfernt (ausser dem letzten).
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val mehrere = tageListe.size > 1
                    tageListe.forEach { iso ->
                        Row(
                            Modifier.height(48.dp).kachel(true).tippen { if (mehrere) tageListe = tageListe - iso }.padding(start = 12.dp, end = 10.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(tagText(iso), style = grotesk(15f, 700, 18f, farbe = LIME), maxLines = 1, softWrap = false)
                            if (mehrere) Text("×", style = grotesk(18f, 400, farbe = Color.White.copy(alpha = 0.6f)))
                        }
                    }
                    Box(Modifier.height(48.dp).background(kachelGrund, form).tippen { kalenderOffen = !kalenderOffen }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                        Text(if (kalenderOffen) "Kalender zu" else "+ Tag", style = grotesk(15f, 700, 18f, farbe = if (kalenderOffen) LIME else Color.White), maxLines = 1, softWrap = false)
                    }
                }
                // Monatskalender: auch Vergangenheit, Tage mit Dienst der ausgewaehlten Fahrer mit Punkt.
                if (kalenderOffen) {
                    DienstKalender(tageListe, fahrerIDs, Modifier.padding(top = 10.dp)) { iso ->
                        tageListe = if (iso in tageListe) { if (tageListe.size > 1) tageListe - iso else tageListe } else (tageListe + iso).sorted()
                    }
                }

                // Start | Pause | Pause | Ende
                Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Column(Modifier.weight(1f)) {
                        zeitKachel(start, feld == "start", Modifier.fillMaxWidth(), zurueck(true)) { zeitTippen("start") }
                        beschriftung("Start", start.isNotEmpty(), zStart)
                    }
                    for (i in 0..1) {
                        Column(Modifier.weight(1f)) {
                            pausenKachel(i, Modifier.fillMaxWidth())
                            beschriftung("Pause", false, if (i < pausen.size) zPausen else null)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        zeitKachel(ende, feld == "ende", Modifier.fillMaxWidth(), zurueck(false)) { zeitTippen("ende") }
                        beschriftung("Ende", ende.isNotEmpty(), zEnde)
                    }
                }

                reihenfolge?.let {
                    Text(it, style = grotesk(13f, 700, farbe = hex(0xFF8E8E)), textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                }

                // Dauer gross, wie die Arbeitszeit in der Stundenerfassung
                Column(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (start.isNotEmpty() && ende.isNotEmpty()) {
                        val pause = pausen.sumOf { spanne(it.first, it.second) }
                        val netto = max(0, spanne(start, ende) - pause)
                        Text("%02d:%02d".format(netto / 60, netto % 60), style = grotesk(35f, 700, 44f, -0.5f, LIME))
                        if ((minuten(ende) ?: 0) <= (minuten(start) ?: 0)) {
                            Text("endet am Folgetag", style = grotesk(12f, 500, farbe = Color.White.copy(alpha = 0.6f)))
                        }
                    } else {
                        Text(
                            if (nichtsGesetzt) "Start oder Ende antippen" else if (nurPause) "Nur Pause" else if (start.isNotEmpty()) "Nur Dienststart" else "Nur Dienstende",
                            style = grotesk(18f, 700, 44f, -0.5f, if (nichtsGesetzt) grau else LIME),
                        )
                    }
                }

                // Treffpunkt und Notiz beim Dienststart: nur mit Dienststart (eigener Ort oder Adresse).
                if (start.isNotEmpty() || bestand?.start.orEmpty().isNotEmpty()) {
                    val hinweis = Color.White.copy(alpha = 0.6f)
                    val leerText = Color.White.copy(alpha = 0.3f)
                    val eigener = de.trisar.kern.EigeneOrte.zuID(treffOrtID.ifEmpty { null })
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp).height(56.dp).background(kachelGrund, form).padding(start = 12.dp, end = 6.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (eigener != null) Icon(de.trisar.kern.OrtIcons.grau(eigener.icon), Modifier.size(24.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Treffpunkt beim Dienststart", style = grotesk(11f, 500, 14f, farbe = hinweis), maxLines = 1)
                            Box {
                                if (treffText.isEmpty()) Text("Ort oder Adresse", style = grotesk(15f, 700, 20f, farbe = leerText), maxLines = 1)
                                BasicTextField(treffText, { treffpunktTippen(it) },
                                    Modifier.fillMaxWidth().onFocusChanged { treffOffen = it.isFocused },
                                    textStyle = grotesk(15f, 700, 20f), singleLine = true, cursorBrush = SolidColor(LIME))
                            }
                        }
                        if (treffText.isNotEmpty()) {
                            Box(Modifier.size(36.dp).tippen { treffText = ""; treffOrtID = ""; treffVorschlaege = emptyList(); fehler = null },
                                contentAlignment = Alignment.Center) {
                                Text("×", style = grotesk(20f, 400, farbe = hinweis))
                            }
                        }
                    }
                    // Eigene Orte zuerst, darunter die Adressen (wie beim Standby).
                    val eigeneTreffer = if (treffOrtID.isEmpty()) de.trisar.kern.EigeneOrte.vorschlaege(treffText) else emptyList()
                    if (treffOffen && (eigeneTreffer.isNotEmpty() || treffVorschlaege.isNotEmpty())) {
                        de.trisar.dispo.fahrten.OrtVorschlagListe(eigeneTreffer, treffVorschlaege, Modifier.fillMaxWidth().padding(top = 4.dp),
                            { o -> treffText = o.name; treffOrtID = o.id; treffVorschlaege = emptyList(); treffOffen = false; fokus.clearFocus() }) { i ->
                            treffText = treffVorschlaege[i]; treffOrtID = ""; treffVorschlaege = emptyList(); treffOffen = false; fokus.clearFocus()
                        }
                    }
                    Column(Modifier.fillMaxWidth().padding(top = 6.dp).background(kachelGrund, form).padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 10.dp)) {
                        Text("Notiz an Fahrer", style = grotesk(11f, 500, 14f, farbe = hinweis), maxLines = 1)
                        Box {
                            if (treffNotiz.isEmpty()) Text("z. B. Schild mitnehmen", style = grotesk(15f, 700, 20f, farbe = leerText))
                            BasicTextField(treffNotiz, { treffNotiz = it; fehler = null }, Modifier.fillMaxWidth().height(40.dp),
                                textStyle = grotesk(15f, 700, 20f), cursorBrush = SolidColor(LIME))
                        }
                    }
                }
            }

            // Vorlagen
            val aktiveVorlage = vorlagen.firstOrNull { it.second == start && it.third == ende }?.first
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                vorlagen.forEach { (name, a, b) ->
                    val aktiv = name == aktiveVorlage
                    val farbe = if (aktiv) LIME else Color.White
                    Column(Modifier.weight(1f).height(48.dp).kachel(aktiv).tippen { start = a; ende = b; feld = "start"; fehler = null },
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text(name, style = grotesk(14f, 700, 17f, farbe = farbe))
                        Text("${a.take(2)}–${b.take(2)}", style = grotesk(11f, 400, 14f, farbe = farbe.copy(alpha = 0.7f)))
                    }
                }
            }

            if (unveraendert) {
                Text("Schon gesendet. Zeit antippen zum Ändern.", style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.6f)),
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            }
            fehler?.let { Text(it, style = grotesk(13f, 500, farbe = hex(0xFF8E8E)), modifier = Modifier.padding(top = 8.dp)) }

            val sendenAktiv = !speichert && !nichtsGesetzt && !unveraendert && reihenfolge == null && anzahl > 0
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(Modifier.weight(1f).height(56.dp).background(rot).tippen { fertig() }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Abbrechen", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x202020)), modifier = Modifier.weight(1f), maxLines = 1)
                    pfeil()
                }
                Row(Modifier.weight(1f).height(56.dp).alpha(if (sendenAktiv) 1f else 0.5f).background(gruen).tippen { if (sendenAktiv) senden() }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(if (speichert) "Speichert ..." else "Senden ($anzahl)", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x202020)), modifier = Modifier.weight(1f), maxLines = 1)
                    pfeil()
                }
            }
        }
    }
}

/** Monatskalender fuer "Dienste planen" (wie DienstKalender im Web): auch Tage in der Vergangenheit.
 *  Tage, an denen die ausgewaehlten Fahrer schon einen Dienst haben, tragen einen Lime-Punkt. */
@Composable
private fun DienstKalender(gewaehlt: List<String>, fahrerIDs: List<String>, modifier: Modifier, umschalten: (String) -> Unit) {
    var monat by remember { mutableStateOf(LocalDate.now().withDayOfMonth(1)) }
    var belegt by remember { mutableStateOf(emptySet<String>()) }
    LaunchedEffect(monat, fahrerIDs) {
        belegt = if (fahrerIDs.isEmpty()) emptySet() else runCatching {
            Backend.client.from("driver_service_requests").select(io.github.jan.supabase.postgrest.query.Columns.raw("service_date, status")) {
                filter { isIn("driver_id", fahrerIDs); gte("service_date", monat.toString()); lte("service_date", monat.plusMonths(1).minusDays(1).toString()) }
            }.decodeList<kotlinx.serialization.json.JsonObject>()
                .filter { (it["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.lowercase() != "refused" }
                .mapNotNull { (it["service_date"] as? kotlinx.serialization.json.JsonPrimitive)?.content }.toSet()
        }.getOrDefault(emptySet())
    }
    val heute = LocalDate.now().toString()
    val leer = monat.dayOfWeek.value - 1
    val tage = monat.lengthOfMonth()
    val felder: List<Int?> = List(leer) { null } + (1..tage).map { it }
    Column(modifier.fillMaxWidth().background(hex(0x242525), RoundedCornerShape(12.dp)).padding(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("‹", style = grotesk(20f, 700, farbe = LIME), modifier = Modifier.size(36.dp, 32.dp).tippen { monat = monat.minusMonths(1) }, textAlign = TextAlign.Center)
            Text(monat.format(DateTimeFormatter.ofPattern("LLLL yyyy", Locale.GERMAN)), style = grotesk(15f, 700, farbe = Color.White),
                modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            Text("›", style = grotesk(20f, 700, farbe = LIME), modifier = Modifier.size(36.dp, 32.dp).tippen { monat = monat.plusMonths(1) }, textAlign = TextAlign.Center)
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So").forEach {
                Text(it, style = grotesk(11f, 700, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            }
        }
        felder.chunked(7).forEach { woche ->
            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                for (i in 0 until 7) {
                    val tag = woche.getOrNull(i)
                    if (tag == null) { Spacer(Modifier.weight(1f).height(36.dp)); continue }
                    val iso = monat.withDayOfMonth(tag).toString()
                    val an = iso in gewaehlt
                    Box(Modifier.weight(1f).height(36.dp)
                        .background(if (an) LIME else Color.Transparent, RoundedCornerShape(8.dp))
                        .then(if (iso == heute && !an) Modifier.border(1.dp, LIME, RoundedCornerShape(8.dp)) else Modifier)
                        .tippen { umschalten(iso) }, contentAlignment = Alignment.Center) {
                        Text("$tag", style = grotesk(14f, 700, farbe = if (an) Color.Black else if (iso < heute) hex(0x5F5F5F) else Color.White))
                        if (iso in belegt) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).size(5.dp).background(if (an) Color.Black else LIME, CircleShape))
                    }
                }
            }
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(5.dp).background(LIME, CircleShape))
            Text("  schon ein Dienst eingetragen", style = grotesk(11f, 500, farbe = Color.White.copy(alpha = 0.5f)))
        }
    }
}
