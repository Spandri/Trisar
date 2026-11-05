package de.trisar.dispo.stamm

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.ui.draw.clipToBounds
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.dispo.DispoZiel
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

/** Ansicht im Fahrer-Bereich (openDriverCreate/openDriverEditor in App.jsx). */
private sealed interface FahrerSeite {
    data object Liste : FahrerSeite
    data object Erstellen : FahrerSeite
    data class Bearbeiten(val fahrer: DispoFahrer) : FahrerSeite
}

/**
 * Fahrer-Bereich der Dispo (FahrerBereichAnsicht.swift): Liste (AlleFahrer.jsx), von dort
 * Anlegen/Bearbeiten (FahrerErstellenView.jsx).
 */
@Composable
internal fun FahrerBereichSeite(zeigen: (DispoZiel) -> Unit) {
    val liste = remember { FahrerListeDienst() }
    val scope = rememberCoroutineScope()
    var seite by remember { mutableStateOf<FahrerSeite>(FahrerSeite.Liste) }
    /** Markierte Fahrer bleiben ueber Anlegen/Bearbeiten erhalten (sessionStorage im Web). */
    val markiert = remember { mutableStateListOf<String>() }

    DisposableEffect(Unit) {
        liste.starten(scope)
        onDispose { liste.stoppen() }
    }

    fun zurueckZurListe() {
        seite = FahrerSeite.Liste
        scope.launch { liste.laden() }
    }

    when (val s = seite) {
        FahrerSeite.Liste -> AlleFahrerSeite(liste, markiert, zeigen, erstellen = { seite = FahrerSeite.Erstellen }, bearbeiten = { seite = FahrerSeite.Bearbeiten(it) })
        FahrerSeite.Erstellen -> androidx.compose.runtime.key("neu") { FahrerErstellenSeite(null) { zurueckZurListe() } }
        is FahrerSeite.Bearbeiten -> androidx.compose.runtime.key(s.fahrer.id) { FahrerErstellenSeite(s.fahrer) { zurueckZurListe() } }
    }
}

// MARK: - Alle Fahrer

/**
 * Nachbau von AlleFahrer.jsx (Raster 402, LAYOUT_GRID). Der KI-Planer-Knopf fuehrt zur Planung,
 * "Dienste planen" ist im Web ausgeschaltet (DIENSTE_VON_HAND = false) und fehlt darum hier.
 */
@Composable
private fun AlleFahrerSeite(
    liste: FahrerListeDienst,
    markiert: MutableList<String>,
    zeigen: (DispoZiel) -> Unit,
    erstellen: () -> Unit,
    bearbeiten: (DispoFahrer) -> Unit,
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
        Leinwand(874f, inhalt) {
            ZurueckKnopf(Modifier.platz(20f, 60f)) { zeigen(DispoZiel.START) }
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
                            antippen = { if (markiert.isNotEmpty()) umschalten(f.id) else bearbeiten(f) },
                            markieren = { umschalten(f.id) },
                            bearbeiten = { bearbeiten(f) },
                        )
                    }
                }
            }
        }

        if (markiert.isNotEmpty()) {
            // Markierung loeschen: right 24, bottom 160.
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(end = 24.dp, bottom = 160.dp), contentAlignment = Alignment.BottomEnd) {
                Box(Modifier.size(54.dp).background(LIME, CircleShape).tippen { markiert.clear() }, contentAlignment = Alignment.Center) {
                    Text("X", style = grotesk(26f, 700, farbe = hex(0x1D1C1D)))
                }
            }
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

