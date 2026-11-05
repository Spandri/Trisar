package de.trisar.dispo.planung

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.content.FileProvider
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign

/**
 * Hauptansicht nach der Planung: alle Tage des Einsatzes (EinsatzUebersichtAnsicht.swift).
 * Karten wischen (kippen raeumlich weg, rasten mit Feder ein), als letzte Karte der ganze Einsatz,
 * Tipp auf eine Tageskarte oeffnet den Tag, jede Karte laesst sich als Bild teilen,
 * "Neue Planung" fuehrt in den Kalender.
 */
@Composable
internal fun EinsatzUebersichtAnsicht(
    tage: List<String>,
    vorschlaegeJeTag: Map<String, List<EinsatzVorschlag>>,
    startIndex: Int,
    zurueck: () -> Unit,
    neuePlanung: () -> Unit,
    tagOeffnen: (Int) -> Unit,
) {
    val tagesKarteOben = 127f
    val gesamtKarteOben = 159f
    val wischOben = 100f
    val letzte = tage.size
    val lage = remember { Animatable(max(0, min(startIndex, tage.size)).toFloat()) }
    val scope = rememberCoroutineScope()
    val aktiv = max(0, min(letzte, lage.value.roundToInt()))
    val tagesTitel = tage.map { EinsatzUhr.tagKurz(it) }
    val gesamtTitel = if (tage.isEmpty()) "" else {
        val von = EinsatzUhr.format(tage.first(), "d. MMM")
        val bis = EinsatzUhr.format(tage.last(), "d. MMM")
        if (tage.size > 1) "$von – $bis" else von
    }
    val tagesWallets = tage.map { EinsatzWallet.werte(vorschlaegeJeTag[it] ?: emptyList()) }
    val gesamtWallet = EinsatzWallet.werte(tage.flatMap { vorschlaegeJeTag[it] ?: emptyList() })
    val gesamtAktiv = aktiv == letzte
    var teilen by remember { mutableStateOf<Int?>(null) }

    fun zuKarte(i: Int) {
        scope.launch { lage.animateTo(max(0, min(letzte, i)).toFloat(), spring(dampingRatio = 0.78f, stiffness = 240f)) }
    }

    Box(Modifier.fillMaxSize()) {
        EinsatzHintergrund()
        PlanLeinwand(basisHoehe = 873f) {
            // Karussell
            val dichte = LocalDensity.current
            Box(
                Modifier.platz(0f, wischOben, 402f, 500f).pointerInput(letzte) {
                    val breitePx = 402.dp.toPx()
                    awaitEachGesture {
                        val runter = awaitFirstDown(requireUnconsumed = false)
                        val tempo = VelocityTracker()
                        tempo.addPosition(runter.uptimeMillis, runter.position)
                        var summe = Offset.Zero
                        var waagerecht: Boolean? = null
                        var start: Float? = null
                        while (true) {
                            val e = awaitPointerEvent()
                            val c = e.changes.firstOrNull { it.id == runter.id } ?: break
                            tempo.addPosition(c.uptimeMillis, c.position)
                            if (!c.pressed) break
                            summe += c.positionChange()
                            if (waagerecht == null && summe.getDistance() >= 6.dp.toPx()) waagerecht = abs(summe.x) >= abs(summe.y)
                            if (waagerecht == true) {
                                c.consume()
                                val s = start ?: lage.value.also { start = it }
                                var pos = s - summe.x / breitePx
                                // Am Anfang und Ende gibt die Bahn nur widerwillig nach.
                                if (pos < 0) pos = -(1 - 1 / (1 - pos * 0.9f)) * 0.35f
                                if (pos > letzte) pos = letzte + (1 - 1 / (1 + (pos - letzte) * 0.9f)) * 0.35f
                                scope.launch { lage.snapTo(pos) }
                            } else if (waagerecht == false) {
                                break
                            }
                        }
                        val s = start
                        if (waagerecht == true && s != null) {
                            val v = -tempo.calculateVelocity().x / breitePx
                            var ziel = (lage.value + v * 0.18f).roundToInt()
                            val st = s.roundToInt()
                            ziel = max(st - 1, min(st + 1, ziel))
                            zuKarte(ziel)
                        }
                    }
                }
            ) {
                for (i in 0..letzte) {
                    val d = i - lage.value
                    val ad = min(abs(d), 1.4f)
                    val karte = Modifier
                        .platz(20f, (if (i < letzte) tagesKarteOben else gesamtKarteOben) - wischOben)
                        .zIndex(100 - abs(d) * 10)
                        .graphicsLayer {
                            val f = 1 - ad * 0.16f - ad * 0.03f
                            scaleX = f; scaleY = f
                            rotationY = -(if (d == 0f) 0f else sign(d)) * ad * 38f
                            cameraDistance = 12f * dichte.density
                            translationX = d * 402.dp.toPx()
                            alpha = if (abs(d) > 1.35f) 0f else max(0f, 1 - ad * 0.45f)
                        }
                    if (i < letzte) {
                        TagesWalletKarte(tagesTitel[i], tagesWallets[i], karte.tippen { tagOeffnen(i) })
                    } else {
                        GesamtWalletKarte(gesamtTitel, gesamtWallet, karte)
                    }
                }
            }

            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Box(Modifier.platz(324f, 60f, 50f, 50f).tippen { teilen = aktiv }) {
                Icon("teilen_pfeil", Modifier.platz(18f, 12f, 13f, 17f), skalierung = ContentScale.FillBounds)
                Icon("teilen_schale", Modifier.platz(15f, 23f, 19f, 14f), skalierung = ContentScale.FillBounds)
            }

            val punkteY by animateFloatAsState(if (gesamtAktiv) 568f else 580f, tween(420, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)), label = "punkte")
            Box(Modifier.mittig(201f, punkteY, letzte * 17f + 7f, 7f)) {
                for (i in 0..letzte) {
                    val deckung by animateFloatAsState(if (i == aktiv) 1f else 0.25f, tween(260), label = "p$i")
                    val groesse by animateFloatAsState(if (i == aktiv) 1.15f else 1f, tween(260), label = "g$i")
                    Box(Modifier.platz(i * 17f - 5f, -8f, 17f, 23f).tippen { zuKarte(i) }) {
                        Box(Modifier.platz(5f, 8f, 7f, 7f).scale(groesse).background(EinsatzFarbe.lime.copy(alpha = deckung), CircleShape))
                    }
                }
            }

            RahmenText(
                "Neue Planung", 24f, 700, EinsatzFarbe.lime,
                Modifier.platz(112f, 629f, 178f, 51f).border(2.dp, EinsatzFarbe.lime, RectangleShape).tippen(neuePlanung),
                abstand = -0.5f,
            )
        }

        // Bild zum Teilen: Hintergrund und Karte an ihrer Stelle, ohne Knoepfe, Punkte und Leiste.
        teilen?.let { i ->
            TeilBild(
                gesamt = i == letzte,
                inhalt = {
                    if (i == letzte) GesamtWalletKarte(gesamtTitel, gesamtWallet, Modifier.platz(20f, gesamtKarteOben))
                    else TagesWalletKarte(tagesTitel[i], tagesWallets[i], Modifier.platz(20f, tagesKarteOben))
                },
                fertig = { teilen = null },
            )
        }
    }
}

/** Zeichnet den Inhalt unsichtbar in eine Ebene, macht daraus ein PNG und oeffnet das Teilen (navigator.share im Web). */
@Composable
private fun TeilBild(gesamt: Boolean, inhalt: @Composable () -> Unit, fertig: () -> Unit) {
    val ebene = rememberGraphicsLayer()
    val ctx = LocalContext.current
    Box(
        Modifier.size(402.dp, 873.dp).drawWithContent {
            ebene.record { this@drawWithContent.drawContent() }
            // nur aufnehmen, nicht auf den Bildschirm zeichnen
        }
    ) {
        EinsatzHintergrund()
        inhalt()
    }
    LaunchedEffect(Unit) {
        // Bilder (SVG) kurz fertig laden lassen.
        delay(350)
        val bild = runCatching { ebene.toImageBitmap().asAndroidBitmap() }.getOrNull()
        if (bild != null) teilenOeffnen(ctx, bild, if (gesamt) "einsatz.png" else "einsatz-tag.png")
        fertig()
    }
}

private suspend fun teilenOeffnen(ctx: Context, bild: Bitmap, name: String) {
    val datei = withContext(Dispatchers.IO) {
        val ordner = File(ctx.cacheDir, "teilen").apply { mkdirs() }
        File(ordner, name).also { f -> f.outputStream().use { bild.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.teilen", datei)
    val absicht = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    ctx.startActivity(Intent.createChooser(absicht, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
