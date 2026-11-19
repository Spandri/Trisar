package de.trisar.dispo.fahrzeug

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.dispo.karte.DispoTelemetrie
import de.trisar.dispo.karte.TelemetrieEreignis
import de.trisar.dispo.karte.TelemetrieZeile
import de.trisar.dispo.stamm.Leinwand
import de.trisar.kern.DrehSatz
import de.trisar.kern.FahrzeugAngaben
import de.trisar.kern.FahrzeugBild
import de.trisar.kern.FahrzeugDrehung
import de.trisar.kern.FahrzeugFoto
import de.trisar.kern.FahrzeugKacheln
import de.trisar.kern.FahrzeugTest
import de.trisar.kern.FahrzeugZeile
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.SchrumpfText
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.VinZeile
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlin.math.max

/**
 * Fahrzeugseite der Dispo fuer einen Fahrer, kopiert aus FahrzeugSeite der Fahrer-App
 * ohne Karte oben und ohne „Tracker scannen“: Fahrzeugblock, Fahrzeugdaten (OBD), Schadensbericht.
 */
@Composable
internal fun DispoFahrzeugSeite(fahrerID: String, fahrzeug: FahrzeugZeile?, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val bereich = rememberCoroutineScope()
    val daten = remember(fahrzeug?.id) { DispoFahrzeugDaten(fahrzeug?.id) }
    val telemetrie = remember(fahrerID) { DispoTelemetrie(fahrerID) }
    var meldenOffen by remember { mutableStateOf(false) }
    var unterHoehe by remember { mutableFloatStateOf(0f) }
    val dichte = LocalDensity.current

    LaunchedEffect(daten) { daten.laden() }
    DisposableEffect(telemetrie) {
        telemetrie.starten(bereich)
        onDispose { telemetrie.beenden() }
    }

    val versatz = 20f
    val angaben = FahrzeugAngaben.aus(fahrzeug, daten.ausstattung)
    val katalog = de.trisar.kern.DrehInfo.laden(ctx)
    val dreh = remember(katalog, angaben.modell, angaben.farbe) { DrehSatz.finden(katalog, angaben.modell, angaben.farbe) }
    val raster = angaben.blockRaster(mitDreh = dreh != null)
    // Ohne Karte steht der Fahrzeugblock oben (wie in der Fahrer-App ohne Standort).
    val blockOben = 99f
    val unterBlock = blockOben + raster.hoehe - 1f
    val inhalt = max(1264f, unterBlock + unterHoehe) + 40f + 70f

    // Schwarz und schluckt alle Tipps, damit die Karte darunter nicht reagiert.
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
        awaitPointerEventScope { while (true) { awaitPointerEvent() } }
    }) {
        TrisarHintergrund()
        Leinwand(inhaltHoehe = inhalt) { rahmen ->
            TrisarHintergrund(Modifier.size(402.dp, max(inhalt, rahmen).dp))

            ZurueckKnopf(Modifier.platz(20f, versatz + 40f), zurueck)

            FahrzeugBlock(angaben, raster, Modifier.platz(24.5f, versatz + blockOben, 353f, raster.hoehe), dreh)

            Column(
                Modifier.platz(24.5f, versatz + unterBlock, 353f).onSizeChanged { unterHoehe = with(dichte) { it.height.toDp().value } },
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (telemetrie.zeilen.isNotEmpty() && !FahrzeugTest.nurKennzeichen) TelemetrieBlock(telemetrie.zeilen, telemetrie.ereignisse, telemetrie.stand)
                SchadensBericht(daten.schaeden, dreh) { meldenOffen = true }
            }
        }
        FussleisteUnten()

        if (meldenOffen) {
            Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
                awaitPointerEventScope { while (true) { awaitPointerEvent() } }
            }) {
                SchadenMeldenSeite(satz = dreh, schliessen = { meldenOffen = false }) { stelle, beschreibung, fotos, genau ->
                    val ok = daten.melden(stelle, beschreibung, fotos, genau)
                    if (ok) meldenOffen = false
                    ok
                }
            }
        }
    }
}

/** Fahrzeugblock (353 breit, weiss), wie in der Fahrer-App. */
@Composable
private fun FahrzeugBlock(a: FahrzeugAngaben, r: FahrzeugAngaben.BlockRaster, modifier: Modifier, dreh: DrehSatz? = null) {
    val blass = Color(28, 28, 29).copy(alpha = 0.15f)
    Box(modifier.background(Color.White)) {
        SchrumpfText(a.kennzeichen.ifEmpty { a.modell.ifEmpty { "Kein Fahrzeug" } }, grotesk(30f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 353f,
            Modifier.platz(0f, 15.29f, 353f, 36.68f))
        val bild = a.bild
        r.bild?.let { o ->
            if (dreh != null) FahrzeugDrehung(dreh, Modifier.platz(16f, o, 321f, 122f))
            else if (bild != null) FahrzeugFoto(bild, Modifier.platz(51f, o, 250f, 122f))
        }
        r.vin?.let { VinZeile(a.vin, Modifier.platz(0f, it, 353f)) }
        r.modell?.let { SchrumpfText(a.modell, grotesk(20f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 353f,
            Modifier.platz(0f, it, 353f), minFaktor = 0.6f) }
        r.ausstattung?.let { Text(a.ausstattung, style = grotesk(13f, farbe = blass), textAlign = TextAlign.Center,
            modifier = Modifier.platz(0f, it, 353f)) }
        r.kacheln?.let { FahrzeugKacheln(a, Modifier.platz(0f, it, 353f)) }
    }
}

/** Fahrzeugdaten (FahrzeugTelemetrie.jsx), helle Variante wie in der Fahrer-App. */
@Composable
private fun TelemetrieBlock(zeilen: List<TelemetrieZeile>, ereignisse: List<TelemetrieEreignis>, stand: String) {
    val grundfarbe = Color(28, 28, 29)
    Column(Modifier.width(353.dp).background(Color.White).padding(29.dp)) {
        Text("Fahrzeugdaten (OBD)", style = grotesk(20f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)))
        Box(Modifier.padding(top = 12.dp, bottom = 14.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for (reihe in zeilen.chunked(3)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (z in reihe) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(z.titel, style = grotesk(11f, farbe = grundfarbe.copy(alpha = 0.5f)), maxLines = 1)
                            Text(z.wert, style = grotesk(18f, 700, farbe = if (z.warnung) hex(0xD9381E) else hex(0x1C1C1D)), maxLines = 1)
                            if (z.unter.isNotEmpty()) Text(z.unter, style = grotesk(11f, farbe = grundfarbe.copy(alpha = 0.5f)), maxLines = 1)
                        }
                    }
                    repeat(3 - reihe.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        if (ereignisse.isNotEmpty()) {
            Column(Modifier.padding(top = 14.dp)) {
                for (e in ereignisse) {
                    Box(Modifier.height(18.dp), contentAlignment = Alignment.CenterStart) {
                        Text("${e.zeit} · ${e.text}", style = grotesk(12f, farbe = grundfarbe.copy(alpha = 0.6f)), maxLines = 1)
                    }
                }
            }
        }
        if (stand.isNotEmpty()) {
            Text("Stand $stand", style = grotesk(11f, farbe = grundfarbe.copy(alpha = 0.35f)), modifier = Modifier.padding(top = 10.dp))
        }
    }
}

/** Schadensbericht mit Liste und „Schaden melden“, wie in der Fahrer-App, dazu „gemeldet von“. */
@Composable
private fun SchadensBericht(schaeden: List<DispoSchaden>, satz: DrehSatz? = null, melden: () -> Unit) {
    Column(Modifier.width(353.dp).background(Color.White).padding(29.dp)) {
        Text("Schadensbericht", style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0xDDDCDC)), modifier = Modifier.padding(bottom = 10.dp))
        Box(Modifier.padding(bottom = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        schaeden.forEachIndexed { i, s ->
            Column(Modifier.padding(bottom = 10.dp)) {
                Text(s.datum, style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0xDDDCDC)), modifier = Modifier.padding(bottom = 10.dp))
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(s.stelle, style = grotesk(10f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)), modifier = Modifier.padding(bottom = 5.dp))
                        Text(s.beschreibung, style = grotesk(14f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)))
                        if (s.gemeldetVon.isNotEmpty()) {
                            Text("gemeldet von ${s.gemeldetVon}", style = grotesk(11f, farbe = hex(0x1D1C1C, 0.45f)), modifier = Modifier.padding(top = 5.dp))
                        }
                    }
                    if (satz != null && s.genau != null && de.trisar.kern.stellePasst(s.genau, satz)) de.trisar.kern.StelleAnsicht(satz, s.genau)
                    else s.punkt?.let { de.trisar.kern.FahrzeugSkizzeAnsicht(it, 96f) }
                }
                if (s.bilder.isNotEmpty()) {
                    Row(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (url in s.bilder) {
                            val bild = remember(url) { FotoHilfe.bildAusDataURL(url) }
                            if (bild != null) {
                                androidx.compose.foundation.Image(bild.asImageBitmap(), null, Modifier.weight(1f).height(96.dp), contentScale = ContentScale.Crop)
                            } else {
                                FahrzeugBild(url, Modifier.weight(1f).height(96.dp), platzhalter = hex(0xF4F4F4), skalierung = ContentScale.Crop)
                            }
                        }
                    }
                }
                if (i < schaeden.size - 1) Box(Modifier.padding(bottom = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
            }
        }
        Row(
            Modifier.padding(top = 10.dp).fillMaxWidth().height(56.dp).background(hex(0xE3F654)).tippen(melden).padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Schaden melden", style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black))
            Spacer(Modifier.weight(1f))
            Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
        }
    }
}
