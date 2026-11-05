package de.trisar.dispo.planung

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

/**
 * Einsatzplanung Schritt 1: Zeitraum waehlen (EinsatzKalenderAnsicht.swift, Figma 2571:12506).
 * Start- und Endzeit oben, Monatskalender (nur Tage mit Fahrten ab heute waehlbar), erster Tipp
 * Starttag, zweiter Endtag, Pfeil unten rechts startet die Planung.
 */
@Composable
internal fun EinsatzKalenderAnsicht(
    heuteIso: String,
    tageMitFahrten: Set<String>,
    anfang: EinsatzZeitraum?,
    zurueck: () -> Unit,
    einstellungen: () -> Unit,
    weiter: (EinsatzZeitraum) -> Unit,
) {
    var von by remember { mutableStateOf(anfang?.von) }
    var bis by remember { mutableStateOf(anfang?.bis) }
    var startZeit by remember { mutableStateOf(anfang?.startZeit ?: "") }
    var endZeit by remember { mutableStateOf(anfang?.endZeit ?: "") }
    var monat by remember { mutableStateOf(YearMonth.from(EinsatzUhr.datum(anfang?.von ?: heuteIso))) }
    var zeitOffen by remember { mutableStateOf<String?>(null) }

    val spaltenX = floatArrayOf(53f, 103f, 154f, 204.5f, 255f, 305f, 354.5f)
    val kopfX = floatArrayOf(51f, 102.5f, 154f, 205.5f, 254.5f, 303f, 352f)
    val kreis = 35f
    val lime = EinsatzFarbe.lime
    val limeHalb = lime.copy(alpha = 0.5f)

    data class KTag(val nr: Int, val iso: String, val spalte: Int, val zeile: Int)
    val tage = remember(monat) {
        val wochentag = monat.atDay(1).dayOfWeek.value - 1   // Montag = 0
        (0 until monat.lengthOfMonth()).map { i ->
            val index = wochentag + i
            KTag(i + 1, monat.atDay(i + 1).toString(), index % 7, index / 7)
        }
    }
    val zeilenAbstand = if (((tage.lastOrNull()?.zeile ?: 4) + 1) > 5) 46f else 54f
    fun zeileY(z: Int) = 402f + z * zeilenAbstand
    fun waehlbar(iso: String) = iso >= heuteIso && iso in tageMitFahrten
    val ende = bis ?: von
    fun imBand(iso: String): Boolean { val v = von ?: return false; val b = bis ?: return false; return iso in v..b }
    val heute = EinsatzUhr.datum(heuteIso)
    val vorMonatGesperrt = monat.year < heute.year || (monat.year == heute.year && monat.monthValue <= heute.monthValue)
    val monatsName = monat.atDay(15).format(DateTimeFormatter.ofPattern("LLLL", Locale.GERMAN))

    fun tagTippen(iso: String) {
        if (!waehlbar(iso)) return
        val v = von
        if (v == null || bis != null || iso < v) { von = iso; bis = null; return }
        if (iso == v) { bis = null; return }
        bis = iso
    }

    Box(Modifier.fillMaxSize()) {
        EinsatzHintergrund()
        PlanLeinwand(basisHoehe = 873f) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Icon("filter", Modifier.platz(332f, 60f, 50f, 50f).tippen(einstellungen), skalierung = ContentScale.FillBounds)

            ZeitFeld(20f, "Start Zeit", startZeit) { zeitOffen = "start" }
            ZeitFeld(204f, "End Zeit", endZeit) { zeitOffen = "ende" }

            Box(
                Modifier.platz(53f, 261f, 46f, 36f).alpha(if (vorMonatGesperrt) 0.5f else 1f)
                    .tippen { if (!vorMonatGesperrt) monat = monat.minusMonths(1) },
                contentAlignment = Alignment.Center,
            ) { Icon("kal_pfeil_links", Modifier.size(26.136.dp, 15.909.dp), skalierung = ContentScale.FillBounds) }
            RahmenText(monatsName, 30f, 700, EinsatzFarbe.titel, Modifier.platz(20f, 262f, 362f, 30f), abstand = -0.5f)
            Box(Modifier.platz(314f, 261f, 46f, 36f).tippen { monat = monat.plusMonths(1) }, contentAlignment = Alignment.Center) {
                Icon("kal_pfeil_links", Modifier.size(26.136.dp, 15.909.dp).rotate(180f), skalierung = ContentScale.FillBounds)
            }

            listOf("M", "D", "M", "D", "F", "S", "S").forEachIndexed { i, t ->
                RahmenText(t, 16f, 500, limeHalb, Modifier.mittig(kopfX[i], 348f - 12f, 30f, 24f))
            }

            // Band je Wochenzeile (25 % Lime, Enden rund, wo das Band weiterlaeuft).
            val v = von
            val b = bis
            if (v != null && b != null) {
                val zeilen = sortedMapOf<Int, Pair<KTag, KTag>>()
                for (t in tage) if (imBand(t.iso)) {
                    val e = zeilen[t.zeile] ?: (t to t)
                    zeilen[t.zeile] = (if (t.spalte < e.first.spalte) t else e.first) to (if (t.spalte > e.second.spalte) t else e.second)
                }
                for ((z, e) in zeilen) {
                    val beginnt = e.first.iso == v
                    val endet = e.second.iso == b
                    val l = if (beginnt) spaltenX[e.first.spalte] else spaltenX[e.first.spalte] - kreis / 2
                    val r = if (endet) spaltenX[e.second.spalte] else spaltenX[e.second.spalte] + 20.5f
                    val links = if (!beginnt) 50.dp else 0.dp
                    val rechts = if (!endet) 50.dp else 0.dp
                    Box(
                        Modifier.platz(l, zeileY(z) - kreis / 2, max(0f, r - l), kreis)
                            .background(lime.copy(alpha = 0.25f), RoundedCornerShape(topStart = links, bottomStart = links, topEnd = rechts, bottomEnd = rechts))
                    )
                }
            }
            for (t in tage) if (t.iso == von || t.iso == ende) {
                Box(
                    Modifier.platz(spaltenX[t.spalte] - kreis / 2, zeileY(t.zeile) - kreis / 2, kreis, kreis)
                        .background(hex(0x010100), CircleShape).border(1.dp, lime, CircleShape)
                )
            }
            for (t in tage) {
                val aktiv = waehlbar(t.iso)
                Box(
                    Modifier.platz(spaltenX[t.spalte] - 22f, zeileY(t.zeile) - 22f, 44f, 44f).tippen { tagTippen(t.iso) },
                    contentAlignment = Alignment.Center,
                ) { PText("${t.nr}", 16f, 500, if (aktiv) lime else lime.copy(alpha = 0.25f), 0.5f) }
            }

            RahmenText(
                "Zurücksetzen", 14f, 500, limeHalb,
                Modifier.mittig(201f, 689f - 12f, 160f, 24f).tippen { von = null; bis = null; startZeit = ""; endZeit = "" },
            )
            GrosserPfeil(
                modifier = Modifier.platz(309f, 665f, 65f, 48f).alpha(if (von == null) 0.5f else 1f).tippen {
                    val vv = von ?: return@tippen
                    weiter(EinsatzZeitraum(vv, ende ?: vv, startZeit, endZeit))
                },
            )
        }
        zeitOffen?.let { art ->
            ZeitBlatt(
                wert = if (art == "start") startZeit else endZeit,
                setzen = { neu -> if (art == "start") startZeit = neu else endZeit = neu },
                schliessen = { zeitOffen = null },
            )
        }
    }
}

@Composable
private fun ZeitFeld(links: Float, platzhalter: String, wert: String, oeffnen: () -> Unit) {
    val lime = EinsatzFarbe.lime
    Row(
        Modifier.platz(links, 158f, 178f, 56f).border(2.dp, lime, RectangleShape).tippen(oeffnen).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PText(if (wert.isEmpty()) platzhalter else "$wert Uhr", 16f, 500, if (wert.isEmpty()) lime.copy(alpha = 0.5f) else lime, 0.5f)
        Spacer(Modifier.weight(1f))
        Icon("Edit_Trisar_Icon_01_Lime", Modifier.size(15.dp), skalierung = ContentScale.FillBounds)
    }
}

/**
 * Zeitauswahl wie das Blatt in iOS (im Web `<input type="time">`): Walzen fuer Stunde und Minute,
 * oben Zuruecksetzen und Fertig. Liegt als Blatt unten ueber der Seite.
 */
@Composable
internal fun ZeitBlatt(wert: String, setzen: (String) -> Unit, schliessen: () -> Unit) {
    val anfang = PlanDienstzeit.minuten(wert) ?: (java.time.LocalTime.now().let { it.hour * 60 + it.minute })
    val stunden = rememberLazyListState(anfang / 60)
    val minuten = rememberLazyListState(anfang % 60)
    val lime = EinsatzFarbe.lime
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)).tippen(schliessen), contentAlignment = Alignment.BottomCenter) {
        Column(
            Modifier.fillMaxWidth().background(hex(0x1C1C1D), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .tippen { }.navigationBarsPadding().height(320.dp)
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp)) {
                PText("Zurücksetzen", 16f, 500, lime, modifier = Modifier.tippen { setzen(""); schliessen() })
                Spacer(Modifier.weight(1f))
                PText("Fertig", 16f, 700, lime, modifier = Modifier.tippen {
                    setzen(zwei(gewaehlt(stunden)) + ":" + zwei(gewaehlt(minuten)))
                    schliessen()
                })
            }
            Box(Modifier.fillMaxWidth().padding(top = 30.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.width(220.dp).height(34.dp).background(hex(0x3A3A3C, 0.6f), RoundedCornerShape(8.dp)))
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Walze(stunden, 24)
                    PText(":", 22f, 500, Color.White)
                    Walze(minuten, 60)
                }
            }
        }
    }
}

private const val WALZE_ZEILE = 34f

private fun gewaehlt(s: LazyListState): Int {
    val groesse = s.layoutInfo.visibleItemsInfo.firstOrNull()?.size ?: 1
    return s.firstVisibleItemIndex + if (s.firstVisibleItemScrollOffset > groesse / 2) 1 else 0
}

@Composable
private fun Walze(zustand: LazyListState, anzahl: Int) {
    val mitte by remember { derivedStateOf { gewaehlt(zustand) } }
    LazyColumn(
        Modifier.width(80.dp).height((WALZE_ZEILE * 5).dp),
        state = zustand,
        contentPadding = PaddingValues(vertical = (WALZE_ZEILE * 2).dp),
        flingBehavior = rememberSnapFlingBehavior(zustand),
    ) {
        items(anzahl) { i ->
            Box(Modifier.fillMaxWidth().height(WALZE_ZEILE.dp), contentAlignment = Alignment.Center) {
                PText(zwei(i), 22f, if (i == mitte) 500 else 400, Color.White.copy(alpha = if (i == mitte) 1f else 0.35f), ausrichtung = TextAlign.Center)
            }
        }
    }
}
