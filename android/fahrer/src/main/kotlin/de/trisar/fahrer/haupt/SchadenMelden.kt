package de.trisar.fahrer.haupt

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.graphics.ImageBitmap
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToInt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import de.trisar.kern.DrehBilder
import de.trisar.kern.DrehSatz
import de.trisar.kern.FahrzeugForm
import de.trisar.kern.Farbe
import de.trisar.kern.FormSpeicher
import de.trisar.kern.drehBildRahmen
import de.trisar.kern.drehBildZeichnen
import de.trisar.kern.schadenMarke
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.max
import kotlin.math.min

private data class Punkt(val x: Float, val y: Float, val zeile: String, val seite: String)

// Aufsicht 120 x 240, angezeigt 150 hoch.
private const val WAGEN_B = 120f
private const val WAGEN_H = 240f
private const val FELD_HOEHE = 150f

private val ZONEN = mapOf(
    "front-links" to "VL", "front-mitte" to "V", "front-rechts" to "VR",
    "seite-links" to "L", "seite-mitte" to "Dach", "seite-rechts" to "R",
    "heck-links" to "HL", "heck-mitte" to "H", "heck-rechts" to "HR",
)
private val BAUTEILE = listOf(
    "reifen" to "Reifen", "felge" to "Felge", "tuer" to "Tür", "stossstange" to "Stoßstange",
    "spiegel" to "Spiegel", "scheibe" to "Scheibe", "lack" to "Lack", "innenraum" to "Innenraum",
)

/**
 * Nachbau von SchadenMelden.jsx wie SchadenMeldenAnsicht.swift (Raster 402 x 864): Foto (bis 3),
 * Stelle per Tipp auf die Aufsicht des Wagens plus Bauteil, Notiz, Abschicken.
 * Fotos ueber die Kamera des Systems oder die Galerie, wie im Web auf dem Handy.
 */
@Composable
internal fun SchadenMeldenSeite(
    satz: DrehSatz? = null,
    schliessen: () -> Unit,
    melden: suspend (String, String, List<Bitmap>, kotlinx.serialization.json.JsonObject?) -> Boolean,
) {
    val ctx = LocalContext.current
    // Drehbares Auto, wenn es fuer das Modell eine Form gibt, sonst die Aufsicht wie bisher
    var form by remember { mutableStateOf<FahrzeugForm?>(null) }
    LaunchedEffect(satz?.modell) { form = satz?.let { FormSpeicher.form(ctx, it) } }
    val mitDreh = satz != null && form != null
    var marke by remember { mutableStateOf<DrehMarke?>(null) }
    val bereich = rememberCoroutineScope()
    val fokus = LocalFocusManager.current
    val feld = remember { FocusRequester() }
    var fotos by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var punkt by remember { mutableStateOf<Punkt?>(null) }
    var bauteil by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var quelleWaehlen by remember { mutableStateOf(false) }
    var sendet by remember { mutableStateOf(false) }
    var kameraZiel by remember { mutableStateOf<Uri?>(null) }
    val tastaturOffen = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    val stelleName = listOf(
        punkt?.let { ZONEN["${it.zeile}-${it.seite}"] }.orEmpty(),
        bauteil?.let { b -> BAUTEILE.firstOrNull { it.first == b }?.second }.orEmpty(),
    ).filter { it.isNotEmpty() }.joinToString(" – ")
    val bereit = punkt != null && !sendet

    val kamera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val ziel = kameraZiel
        if (ok && ziel != null) bereich.launch { ProfilDienst.bildLaden(ctx, ziel)?.let { fotos = listOf(it) } }
    }
    val galerie = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { uris ->
        if (uris.isNotEmpty()) bereich.launch {
            val bilder = uris.take(3).mapNotNull { ProfilDienst.bildLaden(ctx, it) }
            if (bilder.isNotEmpty()) fotos = bilder
        }
    }

    fun kameraStarten() {
        val ordner = File(ctx.cacheDir, "schadenfotos").apply { mkdirs() }
        val datei = File(ordner, "foto-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".schadenfotos", datei)
        kameraZiel = uri
        runCatching { kamera.launch(uri) }
    }
    // CAMERA steht im Manifest, darum braucht auch die System-Kamera die Erlaubnis.
    val kameraErlaubnis = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) kameraStarten() }
    fun kameraOeffnen() {
        if (androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) kameraStarten()
        else kameraErlaubnis.launch(android.Manifest.permission.CAMERA)
    }

    Box(Modifier.fillMaxSize().tippen { fokus.clearFocus() }) {
        Leinwand(basisHoehe = 864f) {
            ZurueckKnopf(Modifier.platz(20f, 60f), schliessen)
            Text("Schaden melden", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = Farbe.lime), modifier = Modifier.platz(20f, 122f, 362f))

            // Foto (mit drehbarem Auto 30 flacher, dafuer Stelle groesser)
            Block(186f, if (mitDreh) 120f else 150f) {
                Box(Modifier.size(362.dp, if (mitDreh) 80.dp else 110.dp).background(Color.White).clipToBounds().tippen { quelleWaehlen = true }, contentAlignment = Alignment.Center) {
                    if (fotos.isEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KameraZeichen(Modifier.size(34.dp, 28.dp))
                            Text("Foto aufnehmen", style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)))
                        }
                    } else {
                        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            for (b in fotos) Image(b.asImageBitmap(), null, Modifier.weight(1f).fillMaxHeight(), contentScale = ContentScale.Crop)
                        }
                        Box(Modifier.fillMaxSize().padding(end = 8.dp, bottom = 8.dp), contentAlignment = Alignment.BottomEnd) {
                            Text("Neu aufnehmen", style = grotesk(11f, 700, abstand = -0.5f, farbe = Color.Black),
                                modifier = Modifier.background(hex(0xE3F654)).padding(horizontal = 10.dp, vertical = 4.dp))
                        }
                    }
                }
            }

            // Stelle
            Block(if (mitDreh) 318f else 348f, if (mitDreh) 330f else 300f) {
                Column(Modifier.size(362.dp, if (mitDreh) 290.dp else 260.dp).background(Color.White).padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Stelle", style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0xDDDCDC)))
                        Spacer(Modifier.weight(1f))
                        Text(stelleName.ifEmpty { if (mitDreh) "Auto drehen, auf die Stelle tippen" else "Auf dem Fahrzeug antippen" }, style = grotesk(14f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)))
                    }
                    Box(Modifier.padding(top = 8.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
                    val f = form
                    if (satz != null && f != null) {
                        DrehStelle(satz, f, marke, Modifier.padding(top = 6.dp)) { m ->
                            marke = m
                            val a = f.aufsicht(m.p)
                            val (zeile, seite) = f.bereich(m.p)
                            punkt = Punkt(a.x, a.y, zeile, seite)
                        }
                    } else {
                        Box(Modifier.fillMaxWidth().height((FELD_HOEHE + 8f).dp), contentAlignment = Alignment.BottomCenter) {
                            WagenAufsicht(punkt) { punkt = it }
                        }
                    }
                    // Weicher Auslauf rechts: zeigt, dass weitere Bauteile folgen.
                    Row(
                        Modifier.padding(top = if (mitDreh) 10.dp else 16.dp).fillMaxWidth()
                            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                            .drawWithContent {
                                drawContent()
                                drawRect(Brush.horizontalGradient(0f to Color.Black, 0.9f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                            }
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        for ((schluessel, name) in BAUTEILE) {
                            val an = bauteil == schluessel
                            Box(
                                Modifier.height(30.dp).background(if (an) hex(0xE3F654) else Color.White)
                                    .border(1.dp, if (an) hex(0x1C1C1D) else hex(0xDDDCDC))
                                    .tippen { bauteil = if (an) null else schluessel }.padding(horizontal = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text(name, style = grotesk(12f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)), maxLines = 1) }
                        }
                    }
                }
            }

            // Notiz
            Block(660f, 92f) {
                Box(Modifier.size(362.dp, 52.dp).background(Color.White).tippen { feld.requestFocus() }.padding(14.dp)) {
                    BasicTextField(
                        text, { text = it },
                        textStyle = grotesk(14f, abstand = 0.25f, farbe = Color.Black.copy(alpha = 0.9f)),
                        cursorBrush = SolidColor(Color.Black),
                        maxLines = 2,
                        modifier = Modifier.fillMaxWidth().focusRequester(feld),
                        decorationBox = { inner ->
                            Box {
                                if (text.isEmpty()) Text("Schreiben...", style = grotesk(14f, abstand = 0.25f, farbe = Color(129, 129, 129).copy(alpha = 0.5f)))
                                inner()
                            }
                        },
                    )
                }
            }

            // Abschicken
            Row(
                Modifier.platz(20f, 764f, 362f, 56f).background(if (punkt != null) hex(0xE3F754) else hex(0x3A3A3A))
                    .tippen {
                        if (!bereit) return@tippen
                        fokus.clearFocus()
                        sendet = true
                        val genau = punkt?.let { p ->
                            kotlinx.serialization.json.buildJsonObject {
                                put("x", kotlinx.serialization.json.JsonPrimitive(p.x.toDouble()))
                                put("y", kotlinx.serialization.json.JsonPrimitive(p.y.toDouble()))
                                bauteil?.let { put("bauteil", kotlinx.serialization.json.JsonPrimitive(it)) }
                                // Mit drehbarem Auto dazu Modell, Ansicht, Bildpunkt im Drehbild und Punkt am Auto (mm)
                                val m = marke
                                if (mitDreh && m != null && satz != null) {
                                    put("modell", kotlinx.serialization.json.JsonPrimitive(satz.modell))
                                    put("ansicht", kotlinx.serialization.json.JsonPrimitive(m.ansicht))
                                    put("bild", kotlinx.serialization.json.JsonArray(listOf(m.bild.x, m.bild.y).map {
                                        kotlinx.serialization.json.JsonPrimitive((it * 10).roundToInt() / 10.0)
                                    }))
                                    put("p", kotlinx.serialization.json.JsonArray(m.p.map { kotlinx.serialization.json.JsonPrimitive((it * 1000).roundToInt()) }))
                                }
                            }
                        }
                        bereich.launch { melden(stelleName, text, fotos, genau); sendet = false }
                    }
                    .padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Schaden melden", style = grotesk(16f, 700, abstand = -0.5f, farbe = if (punkt != null) Color.Black else hex(0x868786)))
                Spacer(Modifier.weight(1f))
                if (sendet) CircularProgressIndicator(Modifier.size(20.dp), color = Color.Black, strokeWidth = 2.dp)
                else if (punkt != null) Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
            }
        }
        if (!tastaturOffen) FussleisteUnten()

        // Auswahl wie confirmationDialog in iOS: Kamera, Galerie, Abbrechen.
        if (quelleWaehlen) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)).tippen { quelleWaehlen = false }, contentAlignment = Alignment.BottomCenter) {
                Column(Modifier.navigationBarsPadding().padding(12.dp).width(378.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.fillMaxWidth().background(hex(0x242525), RoundedCornerShape(14.dp))) {
                        Text("Foto", style = grotesk(13f, farbe = Farbe.grauText), modifier = Modifier.fillMaxWidth().padding(14.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        if (ctx.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)) {
                            AuswahlZeile("Foto aufnehmen") { quelleWaehlen = false; kameraOeffnen() }
                        }
                        AuswahlZeile("Aus Mediathek wählen") {
                            quelleWaehlen = false
                            galerie.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }
                    }
                    Box(Modifier.fillMaxWidth().height(56.dp).background(hex(0x242525), RoundedCornerShape(14.dp)).tippen { quelleWaehlen = false },
                        contentAlignment = Alignment.Center) {
                        Text("Abbrechen", style = grotesk(17f, 700, farbe = Farbe.lime))
                    }
                }
            }
        }
    }
}

@Composable
private fun AuswahlZeile(text: String, aktion: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(hex(0x3A3A3A)))
    Box(Modifier.fillMaxWidth().height(56.dp).tippen(aktion), contentAlignment = Alignment.Center) {
        Text(text, style = grotesk(17f, farbe = Farbe.lime))
    }
}

/** Dunkler Kasten ueber die ganze Breite (Ecken 12), darin weiss mit 20 Rand. */
@Composable
private fun Block(oben: Float, hoehe: Float, inhalt: @Composable () -> Unit) {
    Box(Modifier.platz(0f, oben, 402f, hoehe).background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
        Box(Modifier.padding(start = 20.dp, top = 20.dp)) { inhalt() }
    }
}

/** Aufsicht des Wagens (Front oben), Tipp setzt die Marke. */
@Composable
private fun WagenAufsicht(punkt: Punkt?, setzen: (Punkt) -> Unit) {
    val s = FELD_HOEHE / WAGEN_H
    val schwarz = hex(0x1C1C1D)
    Canvas(
        Modifier.size((WAGEN_B * s).dp, FELD_HOEHE.dp).pointerInput(Unit) {
            detectTapGestures { pos ->
                val f = size.height / WAGEN_H
                val x = pos.x / f
                val y = pos.y / f
                val zeile = if (y <= WAGEN_H / 3) "front" else if (y <= WAGEN_H * 2 / 3) "seite" else "heck"
                val seite = if (x <= WAGEN_B / 3) "links" else if (x <= WAGEN_B * 2 / 3) "mitte" else "rechts"
                setzen(Punkt(x, y, zeile, seite))
            }
        }
    ) {
        val f = size.height / WAGEN_H
        scale(f, f, pivot = Offset.Zero) {
            for (r in listOf(Rect(5f, 40f, 18f, 76f), Rect(102f, 40f, 115f, 76f), Rect(5f, 164f, 18f, 200f),
                Rect(102f, 164f, 115f, 200f), Rect(6f, 84f, 20f, 93f), Rect(100f, 84f, 114f, 93f))) {
                drawRect(schwarz, r.topLeft, r.size)
            }
            drawRoundRect(hex(0xF7F7F7), Offset(16f, 4f), Size(88f, 232f), CornerRadius(24f))
            drawRoundRect(schwarz, Offset(16f, 4f), Size(88f, 232f), CornerRadius(24f), style = Stroke(3f))
            drawPath(Path().apply { moveTo(31f, 100f); lineTo(89f, 100f); lineTo(83f, 72f); lineTo(37f, 72f); close() }, schwarz)
            drawPath(Path().apply { moveTo(31f, 148f); lineTo(89f, 148f); lineTo(83f, 178f); lineTo(37f, 178f); close() }, schwarz)
            if (punkt != null) {
                // Marke bleibt ganz im Bild (Radius 17 + 2 Rand).
                val x = min(WAGEN_B - 19f, max(19f, punkt.x))
                val y = min(WAGEN_H - 19f, max(19f, punkt.y))
                drawCircle(hex(0xE3F754), 17f, Offset(x, y))
                drawCircle(schwarz, 17f, Offset(x, y), style = Stroke(2.5f))
                drawCircle(schwarz, 5f, Offset(x, y))
            }
        }
    }
}

/** Am drehbaren Auto gesetzte Marke: Ansicht, Bildpunkt im Drehbild, Punkt am Auto (m) */
internal data class DrehMarke(val ansicht: Int, val bild: Offset, val p: DoubleArray)

/**
 * Drehbares Auto zum Markieren, wie DrehStelle in SchadenMelden.jsx. Der Punkt sitzt auf der Karosserie
 * und dreht mit, solange die Stelle zu sehen ist. Ist sie verdeckt, blendet er aus, "Zur Markierung"
 * dreht zurueck. Wischen dreht, Tippen markiert, Pfeile drehen um 40 Grad.
 */
@Composable
private fun DrehStelle(satz: DrehSatz, form: FahrzeugForm, marke: DrehMarke?, modifier: Modifier = Modifier, markieren: (DrehMarke) -> Unit) {
    val ctx = LocalContext.current
    val n = satz.bilder
    var bilder by remember(satz) { mutableStateOf<List<ImageBitmap>>(emptyList()) }
    var pos by remember(satz) { mutableFloatStateOf((marke?.ansicht ?: satz.start).toFloat()) }
    val scope = rememberCoroutineScope()
    var drehJob by remember { mutableStateOf<Job?>(null) }
    val k = ((pos.roundToInt() % n) + n) % n
    val sicht = marke?.let { m -> if (m.ansicht == k) m.bild else form.sichtbar(m.p, k) }

    LaunchedEffect(satz) {
        val geladen = coroutineScope { (0 until n).map { i -> async { DrehBilder.bild(ctx, satz.adresse(i)) } }.awaitAll() }
        if (geladen.all { it != null }) bilder = geladen.map { it!! }
    }

    fun drehenNach(ziel: Int) {
        drehJob?.cancel()
        val von = pos
        var d = ((ziel - von.roundToInt()) % n + n) % n
        if (d > n / 2) d -= n
        val nach = von.roundToInt() + d.toFloat()
        val dauer = (220 + abs(d) * 30) * 1_000_000f
        drehJob = scope.launch {
            val t0 = withFrameNanos { it }
            while (true) {
                val t = withFrameNanos { it }
                val q = min((t - t0) / dauer, 1f)
                pos = von + (nach - von) * (1f - (1f - q).pow(3))
                if (q >= 1f) break
            }
        }
    }

    Column(modifier.fillMaxWidth()) {
        Canvas(
            Modifier.fillMaxWidth().height(140.dp).clipToBounds()
                .pointerInput(satz, form) {
                    var start = 0f
                    var weg = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { drehJob?.cancel(); start = pos; weg = 0f },
                        onDragEnd = { pos = pos.roundToInt().toFloat() },
                        onDragCancel = { pos = pos.roundToInt().toFloat() },
                    ) { aenderung, dx ->
                        aenderung.consume()
                        weg += dx / density
                        pos = start + weg / 9f
                    }
                }
                .pointerInput(satz, form) {
                    detectTapGestures { ort ->
                        // Tippen: Strahl durch den Bildpunkt, erster Treffer auf dem Auto
                        val r = drehBildRahmen(satz, size.width.toFloat(), size.height.toFloat())
                        val u = (ort.x - r.left) / r.width * satz.breite
                        val v = (ort.y - r.top) / r.height * satz.hoehe
                        val ansicht = ((pos.roundToInt() % n) + n) % n
                        form.treffen(ansicht, u.toDouble(), v.toDouble())?.let { markieren(DrehMarke(ansicht, Offset(u, v), it)) }
                    }
                },
        ) {
            if (bilder.size != n) return@Canvas
            val r = drehBildRahmen(satz, size.width, size.height)
            drehBildZeichnen(bilder[k], r)
            sicht?.let { s -> schadenMarke(Offset(r.left + s.x / satz.breite * r.width, r.top + s.y / satz.hoehe * r.height)) }
        }
        Row(Modifier.padding(top = 6.dp).fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
            DrehPfeil(links = true) { drehenNach(k - 4) }
            Column(Modifier.weight(1f).padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(FahrzeugForm.ansichtName(k), style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x1D1C1C)), maxLines = 1)
                if (marke != null && sicht == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Von hier nicht zu sehen", style = grotesk(10f, farbe = hex(0x9A9A9A)), maxLines = 1)
                        Box(Modifier.height(16.dp).background(hex(0xE3F754)).tippen { drehenNach(marke.ansicht) }.padding(horizontal = 8.dp),
                            contentAlignment = Alignment.Center) {
                            Text("Zur Markierung", style = grotesk(10f, 700, farbe = Color.Black), maxLines = 1)
                        }
                    }
                } else {
                    val hinweis = when {
                        marke == null -> "Wischen oder Pfeile zum Drehen"
                        marke.ansicht == k -> "Erneut tippen verschiebt den Punkt"
                        else -> "Punkt dreht mit"
                    }
                    Text(hinweis, style = grotesk(10f, farbe = hex(0x9A9A9A)), maxLines = 1)
                }
            }
            DrehPfeil(links = false) { drehenNach(k + 4) }
        }
    }
}

@Composable
private fun DrehPfeil(links: Boolean, aktion: () -> Unit) {
    Box(Modifier.size(40.dp, 30.dp).background(Color.White).border(1.dp, hex(0xDDDCDC)).tippen(aktion), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(9.dp, 14.dp)) {
            val s = size.width / 9f
            val p = Path().apply {
                if (links) { moveTo(7.5f * s, 1.5f * s); lineTo(2f * s, 7f * s); lineTo(7.5f * s, 12.5f * s) }
                else { moveTo(1.5f * s, 1.5f * s); lineTo(7f * s, 7f * s); lineTo(1.5f * s, 12.5f * s) }
            }
            drawPath(p, hex(0x1D1C1C), style = Stroke(2.2f * s))
        }
    }
}

/** Kamerazeichen aus dem Web (34 x 28, Linie 2,5). */
@Composable
private fun KameraZeichen(modifier: Modifier) {
    Canvas(modifier) {
        val s = min(size.width / 34f, size.height / 28f)
        val farbe = hex(0x1C1C1D)
        scale(s, s, pivot = Offset.Zero) {
            drawPath(Path().apply {
                moveTo(2f, 7f); lineTo(10f, 7f); lineTo(13f, 2f); lineTo(21f, 2f); lineTo(24f, 7f); lineTo(32f, 7f); lineTo(32f, 26f); lineTo(2f, 26f); close()
            }, farbe, style = Stroke(2.5f))
            drawCircle(farbe, 6.5f, Offset(17f, 16f), style = Stroke(2.5f))
        }
    }
}
