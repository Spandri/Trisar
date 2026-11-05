package de.trisar.dispo

import android.content.Context
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import de.trisar.kern.Icon
import de.trisar.kern.TrisarFussleiste
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/** Ziele der Dispo-App (wie DispoZiel in iOS, Ansichtsnamen aus admin/src/App.jsx). */
enum class DispoZiel { START, KARTE, FAHRTEN, FAHRZEUGE, FAHRER, KUNDEN, PLANUNG, KI_ASSISTENT, FAHRT_NEU, PROFIL }

/**
 * Feste Leiste unten (Navibar + Fussleiste), wie Navileiste.swift.
 * SCHNITTSTELLE: Signatur nicht aendern. Umsetzung baut der Agent "dispo-a".
 *
 * NaviFooterKomponente + Navibar.jsx: Leiste 362 x 78 bei left 20 direkt auf der Fussleiste,
 * darueber 32 weicher Uebergang nach Schwarz.
 */
@Composable
fun Navileiste(aktiv: DispoZiel, waehlen: (DispoZiel) -> Unit) {
    val ctx = LocalContext.current
    val einstellungen = remember { ctx.getSharedPreferences("trisar_dispo", Context.MODE_PRIVATE) }
    // Gemerkte Schnellwahl wie @AppStorage in iOS (gleiche Schluessel wie localStorage im Web).
    val fahrtenFeld = remember {
        SchnellwahlZustand(
            optionen = listOf(
                SchnellwahlOption(DispoZiel.FAHRZEUGE, "Vehicle_Nav_Trisar_01_grau", "Vehicle_Nav_Trisar_01_Lime", 24f, 24f),
                SchnellwahlOption(DispoZiel.FAHRTEN, "Arrow_Nav_Trisar_Icons_01_grau", "Arrow_Nav_Trisar_Icons_01_Lime", 24f, 23f),
                SchnellwahlOption(DispoZiel.FAHRER, "Person_Trisar_Icons_01_grau", "Person_Trisar_Icons_01_Lime", 23f, 23f),
            ),
            breite = 68f, x = 144f, speicher = einstellungen, schluessel = "admin_nav_quick_selected_v1", standard = "fahrten",
        )
    }
    val kiFeld = remember {
        SchnellwahlZustand(
            optionen = listOf(
                SchnellwahlOption(DispoZiel.PLANUNG, "KI_Trisar_Icons_01_grau", "KI_Trisar_Icons_01_Lime", 23f, 23f),
                SchnellwahlOption(DispoZiel.KI_ASSISTENT, "KI_Assistent_Trisar_Icons_01_grau", "KI_Assistent_Trisar_Icons_01_Lime", 35f, 23f),
            ),
            breite = 64f, x = 212f, speicher = einstellungen, schluessel = "admin_nav_ki_selected_v1", standard = "planung",
        )
    }
    val felder = listOf(fahrtenFeld, kiFeld)
    // Hoechstens ein Feld offen.
    fun oeffnen(feld: SchnellwahlZustand) { felder.forEach { if (it !== feld) it.offen = false }; feld.offen = true }

    Box(Modifier.fillMaxSize()) {
        // Wie der pointerdown-Hoerer im Web: ein Tipp daneben klappt das Menue zu.
        if (felder.any { it.offen }) {
            Box(Modifier.fillMaxSize().tippen { felder.forEach { it.offen = false } })
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
            // 200 Luft ueber der Leiste fuer das aufgeklappte Menue (bleibt so in den Grenzen fuers Antippen).
            Box(Modifier.align(Alignment.CenterHorizontally).size(402.dp, (131 + LUFT).dp)) {
                Box(
                    Modifier.platz(0f, LUFT, 402f, 131f)
                        .background(Brush.verticalGradient(0f to Color.Transparent, (32f / 131f) to Color.Black, 1f to Color.Black))
                        .tippen { }
                )
                Leiste(aktiv, waehlen, fahrtenFeld, kiFeld, ::oeffnen, Modifier.platz(20f, LUFT + 32f, 362f, 78f))
                felder.forEach { f ->
                    if (f.offen) SchnellwahlMenue(f, waehlen, Modifier.platz(20f + f.x + (f.breite - MENUE_BREITE) / 2f, LUFT + 32f + 8f - MENUE_LUFT - f.menueHoehe(aktiv), MENUE_BREITE, f.menueHoehe(aktiv)), aktiv)
                }
            }
            Box(Modifier.fillMaxWidth().background(Color.Black).navigationBarsPadding()) { TrisarFussleiste() }
        }
    }
}

private const val LUFT = 200f
private const val MENUE_BREITE = 80f
private const val MENUE_LUFT = 10f
private const val ZEILE = 69f
private const val FELD_HOEHE = 64f

private class SchnellwahlOption(val ziel: DispoZiel, val grau: String, val lime: String, val w: Float, val h: Float)

/** Zustand eines Schnellwahl-Felds, damit Feld und Menue (liegt hoeher in der Leiste) ihn teilen. */
private class SchnellwahlZustand(
    val optionen: List<SchnellwahlOption>,
    val breite: Float,
    val x: Float,
    private val speicher: android.content.SharedPreferences,
    private val schluessel: String,
    standard: String,
) {
    var offen by mutableStateOf(false)
    var gewaehlt by mutableStateOf(speicher.getString(schluessel, standard) ?: standard)
    var gedrueckt by mutableStateOf(false)
    var langGedrueckt = false
    var schwebt by mutableStateOf<DispoZiel?>(null)
    /** Gerade gewaehlt, Seite wechselt gleich: schon lime zeigen. */
    var kommt by mutableStateOf<DispoZiel?>(null)

    fun merken(z: DispoZiel) {
        gewaehlt = name(z)
        speicher.edit().putString(schluessel, gewaehlt).apply()
    }

    fun vorne(aktiv: DispoZiel): DispoZiel {
        kommt?.let { return it }
        if (optionen.any { it.ziel == aktiv }) return aktiv
        return optionen.firstOrNull { name(it.ziel) == gewaehlt }?.ziel ?: optionen[0].ziel
    }

    fun weitere(aktiv: DispoZiel): List<SchnellwahlOption> { val v = vorne(aktiv); return optionen.filter { it.ziel != v } }
    fun menueHoehe(aktiv: DispoZiel): Float = weitere(aktiv).size * ZEILE + 6f

    /** Moeglichkeit unter dem Finger, in Feld-Koordinaten. Grosszuegig: ganze Zeile, etwas breiter. */
    fun optionAn(px: Float, py: Float, aktiv: DispoZiel): DispoZiel? {
        if (!offen) return null
        val liste = weitere(aktiv)
        val oben = -MENUE_LUFT - menueHoehe(aktiv)
        if (abs(px - breite / 2f) > MENUE_BREITE / 2f + 12f || py < oben - 12f || py >= -MENUE_LUFT + 4f) return null
        val i = ((py - oben) / ZEILE).toInt()
        return if (i in liste.indices && py >= oben) liste[i].ziel else liste.lastOrNull()?.ziel
    }

    companion object {
        /** Wie "\(ziel)" in Swift: fahrten, kiAssistent ... */
        fun name(z: DispoZiel): String = z.name.lowercase().split('_').mapIndexed { i, t -> if (i == 0) t else t.replaceFirstChar { it.uppercase() } }.joinToString("")
    }
}

@Composable
private fun Leiste(
    aktiv: DispoZiel,
    waehlen: (DispoZiel) -> Unit,
    fahrtenFeld: SchnellwahlZustand,
    kiFeld: SchnellwahlZustand,
    oeffnen: (SchnellwahlZustand) -> Unit,
    modifier: Modifier,
) {
    Box(modifier) {
        Box(Modifier.platz(0f, 1f, 281f, 76f).background(hex(0x1E1E1E), RoundedCornerShape(39.dp)))
        Box(Modifier.platz(284f, 1f, 78f, 76f).background(hex(0x111217), RoundedCornerShape(39.dp)).border(1.dp, hex(0x3B3F47), RoundedCornerShape(39.dp)))
        for (x in listOf(7f, 76f, 144f, 212f)) {
            Box(Modifier.platz(x, 8f, 62f, 62f).background(hex(0x1E1E1E, 0.1f), CircleShape))
        }
        // Blauer Kreis unter dem Plus.
        Canvas(Modifier.platz(288f, 4f, 70f, 70f)) {
            drawCircle(
                Brush.radialGradient(
                    0f to hex(0x0048CF), 0.17f to hex(0x00369B), 0.34f to hex(0x002468), 0.6f to hex(0x00091A), 0.68f to Color.Black, 1f to Color.Black,
                    center = Offset(size.width * 0.17f, size.height * 0.17f), radius = 100.dp.toPx(),
                )
            )
        }
        for (x in listOf(72f, 140f, 210f)) Icon("nav-divider", Modifier.platz(x, 22f, 1f, 34f))

        NaviKnopf(if (aktiv == DispoZiel.START) "House_Nav_Trisar_01_Lime" else "House_Nav_Trisar_01_grau", 24f, 24f, aktiv == DispoZiel.START,
            Modifier.platz(7f, 8f, 65f, 64f)) { waehlen(DispoZiel.START) }
        NaviKnopf(if (aktiv == DispoZiel.KARTE) "Pin_Nav_Trisar_Icons_01_Lime" else "Pin_Nav_Trisar_Icons_01_grau", 23f, 23f, aktiv == DispoZiel.KARTE,
            Modifier.platz(76f, 8f, 64f, 64f)) { waehlen(DispoZiel.KARTE) }
        SchnellwahlFeld(fahrtenFeld, aktiv, waehlen, { oeffnen(fahrtenFeld) }, Modifier.platz(fahrtenFeld.x, 8f, fahrtenFeld.breite, FELD_HOEHE))
        SchnellwahlFeld(kiFeld, aktiv, waehlen, { oeffnen(kiFeld) }, Modifier.platz(kiFeld.x, 8f, kiFeld.breite, FELD_HOEHE))

        // Plus: neue Fahrt.
        val gross = if (aktiv == DispoZiel.FAHRT_NEU) 1.25f else 1f
        Box(Modifier.platz(288f, 4f, 70f, 70f).tippen { waehlen(DispoZiel.FAHRT_NEU) }, contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(24.dp).graphicsLayer { scaleX = gross; scaleY = gross }) {
                val s = size.width / 24f
                drawCircle(Color.White, radius = 8.15f * s, style = Stroke(1.7f * s))
                drawLine(Color.White, Offset(12f * s, 8f * s), Offset(12f * s, 16f * s), 1.9f * s, StrokeCap.Round)
                drawLine(Color.White, Offset(8f * s, 12f * s), Offset(16f * s, 12f * s), 1.9f * s, StrokeCap.Round)
            }
        }
    }
}

@Composable
private fun NaviKnopf(icon: String, w: Float, h: Float, aktiv: Boolean, modifier: Modifier, aktion: () -> Unit) {
    val s by animateFloatAsState(if (aktiv) 1.1f else 0.9f, tween(300), label = "navi")
    Box(modifier.tippen(aktion), contentAlignment = Alignment.Center) {
        Icon(icon, Modifier.size(w.dp, h.dp).graphicsLayer { scaleX = s; scaleY = s })
    }
}

/**
 * SchnellwahlKnopf aus Navibar.jsx, eine einzige Geste wie im Web:
 * Antippen oeffnet die vorne liegende Wahl. 450 ms halten klappt die uebrigen darueber auf,
 * hochziehen oeffnet sofort, loslassen ueber einer Moeglichkeit waehlt sie.
 * Loslassen ohne Moeglichkeit nach dem Halten: Menue bleibt offen, Antippen waehlt.
 */
@Composable
private fun SchnellwahlFeld(
    z: SchnellwahlZustand,
    aktiv: DispoZiel,
    waehlen: (DispoZiel) -> Unit,
    oeffnen: () -> Unit,
    modifier: Modifier,
) {
    val haptik = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val aktivJetzt by rememberUpdatedState(aktiv)
    val waehlenJetzt by rememberUpdatedState(waehlen)
    // Beim Erscheinen: aktive Seite gilt als gemerkte Wahl.
    LaunchedEffect(aktiv) { if (z.optionen.any { it.ziel == aktiv } && z.gewaehlt != SchnellwahlZustand.name(aktiv)) z.merken(aktiv) }

    fun menueOeffnen() {
        z.langGedrueckt = true
        haptik.performHapticFeedback(HapticFeedbackType.LongPress)
        oeffnen()
    }

    val vorne = z.vorne(aktiv)
    val klein = z.weitere(aktiv)

    Box(
        modifier.pointerInput(z) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                z.gedrueckt = true
                z.langGedrueckt = false
                var halten: Job? = scope.launch {
                    delay(450)
                    if (z.gedrueckt && !z.offen) menueOeffnen()
                }
                var pos = down.position
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    pos = ch.position
                    if (!ch.pressed) { ch.consume(); break }
                    // Finger geht nach oben: Menue sofort auf, nicht erst nach dem Halten.
                    if (!z.offen && (ch.position.y - down.position.y).toDp().value < -8f) {
                        halten?.cancel(); halten = null
                        menueOeffnen()
                    }
                    if (z.offen) {
                        val neu = z.optionAn(pos.x.toDp().value, pos.y.toDp().value, aktivJetzt)
                        if (neu != z.schwebt) {
                            z.schwebt = neu
                            if (neu != null) haptik.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        }
                    }
                    ch.consume()
                }
                halten?.cancel()
                z.gedrueckt = false
                if (z.offen) {
                    val ziel = z.optionAn(pos.x.toDp().value, pos.y.toDp().value, aktivJetzt)
                    if (ziel != null) {
                        auswaehlen(z, ziel, waehlenJetzt) { haptik.performHapticFeedback(HapticFeedbackType.TextHandleMove) }
                        return@awaitEachGesture
                    }
                    z.schwebt = null
                    if (z.langGedrueckt) { z.langGedrueckt = false; return@awaitEachGesture }
                    z.offen = false
                    return@awaitEachGesture
                }
                if (z.langGedrueckt) { z.langGedrueckt = false; return@awaitEachGesture }
                haptik.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                waehlenJetzt(z.vorne(aktivJetzt))
            }
        }
    ) {
        for (o in z.optionen) {
            val istVorne = o.ziel == vorne
            val eck = klein.indexOfFirst { it.ziel == o.ziel }.coerceAtLeast(0)
            val rechts = eck == 1
            val cx = if (istVorne) z.breite / 2f else if (rechts) z.breite - 7f - o.w / 2f else 7f + o.w / 2f
            val cy = if (istVorne) FELD_HOEHE / 2f else 7f + o.h / 2f
            val feder = spring<Float>(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow)
            val ax by animateFloatAsState(cx, feder, label = "x")
            val ay by animateFloatAsState(cy, feder, label = "y")
            val sk by animateFloatAsState(if (istVorne) (if (z.gedrueckt && !z.offen) 0.96f else 1.1f) else 0.58f, feder, label = "s")
            val bild = if (istVorne && (o.ziel == aktiv || o.ziel == z.kommt)) o.lime else o.grau
            Icon(bild, Modifier.offset((ax - o.w / 2f).dp, (ay - o.h / 2f).dp).size(o.w.dp, o.h.dp)
                .graphicsLayer { scaleX = sk; scaleY = sk; alpha = if (istVorne) 1f else 0.6f })
        }
    }
}

private fun auswaehlen(z: SchnellwahlZustand, ziel: DispoZiel, waehlen: (DispoZiel) -> Unit, haptik: () -> Unit) {
    haptik()
    z.schwebt = null
    z.langGedrueckt = false
    z.kommt = ziel
    z.merken(ziel)
    z.offen = false
    // Sofort wechseln, ohne Pause.
    waehlen(ziel)
    z.kommt = null
}

@Composable
private fun SchnellwahlMenue(z: SchnellwahlZustand, waehlen: (DispoZiel) -> Unit, modifier: Modifier, aktiv: DispoZiel) {
    val haptik = LocalHapticFeedback.current
    // Aufklappen von unten wie .transition(.scale(0.4, anchor: .bottom)) in iOS.
    var start by remember { mutableStateOf(false) }
    val auf by animateFloatAsState(if (start) 1f else 0.4f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow), label = "menue")
    LaunchedEffect(Unit) { start = true }
    val liste = z.weitere(aktiv)
    Box(modifier.graphicsLayer {
        scaleX = auf; scaleY = auf; alpha = ((auf - 0.4f) / 0.6f).coerceIn(0f, 1f)
        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f)
    }.background(hex(0x1E1E1E), RoundedCornerShape(39.dp))) {
        liste.forEachIndexed { i, o ->
            Box(Modifier.platz(8f, 5f + i * ZEILE, 64f, 64f).background(hex(0x1C1917, 0.1f), CircleShape))
            if (i > 0) Box(Modifier.platz(24f, 72f + (i - 1) * ZEILE, 32f, 1f).background(hex(0x54545A, 0.5f)))
            val s by animateFloatAsState(if (z.schwebt == o.ziel) 1.3f else 1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow), label = "schwebt")
            Box(Modifier.platz(8f, 5f + i * ZEILE, 64f, 64f).tippen {
                auswaehlen(z, o.ziel, waehlen) { haptik.performHapticFeedback(HapticFeedbackType.TextHandleMove) }
            }, contentAlignment = Alignment.Center) {
                Icon(o.grau, Modifier.size(o.w.dp, o.h.dp).graphicsLayer { scaleX = s; scaleY = s; alpha = 0.6f })
            }
        }
    }
}
