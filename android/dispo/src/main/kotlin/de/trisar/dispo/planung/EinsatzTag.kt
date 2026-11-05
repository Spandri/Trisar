package de.trisar.dispo.planung

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlin.math.max
import kotlin.math.min

/**
 * Einsatzplanung Schritt 2: Bedarf pruefen und per Hand anpassen (EinsatzBedarfAnsicht.swift).
 * Die Diagramme aller gewaehlten Tage stehen untereinander, getrennt durch die Datumszeile;
 * der Bedarf laesst sich je Stunde ziehen. Erst der Pfeil unten plant.
 */
@Composable
internal fun EinsatzBedarfAnsicht(modell: EinsatzPlanungModell) {
    val stunden = (6 until 26).toList()
    val ersterTrenner = 118f
    val block = 76f + 261f + 106f
    fun top(i: Int) = ersterTrenner + i * block

    val tage = modell.planTage
    val letzteUhrzeit = top(max(0, tage.size - 1)) + 76f + 261f
    val hinweisY = letzteUhrzeit + 56f
    val fussY = hinweisY + 48f
    val hoehe = fussY + 14f + 180f
    val angepasst = modell.bedarfAnpassung.values.any { it.isNotEmpty() }
    val angebot = modell.angebotAlle
    val gebucht = modell.gebuchtAlle
    val basis = modell.bedarfAlle
    val lime = EinsatzFarbe.lime

    Box(Modifier.fillMaxSize()) {
        EinsatzHintergrund()
        PlanLeinwand(inhaltHoehe = hoehe, basisHoehe = 873f) {
            ZurueckKnopf(Modifier.platz(20f, 60f)) { modell.ablauf = EinsatzPlanungModell.Ablauf.KALENDER }

            tage.forEachIndexed { position, iso ->
                key(iso) {
                    val y = top(position)
                    val start = EinsatzUhr.tagNr(iso, modell.heute) * 24
                    fun wert(reihe: List<Int>, h: Int) = if (start + h >= 0 && start + h < reihe.size) max(0, reihe[start + h]) else 0
                    val bedarfBasis = stunden.map { wert(basis, it) }
                    val eigene = modell.bedarfAnpassung[iso] ?: emptyMap()
                    val bedarf = stunden.mapIndexed { i, h -> eigene[h]?.let { max(0, it) } ?: bedarfBasis[i] }

                    Row(Modifier.platz(20f, y, 362f, 32f), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(44.dp, 2.dp).background(EinsatzFarbe.trenner))
                        Spacer(Modifier.weight(1f))
                        // Datumszeile wie in der Fahrer-App: "Mittwoch 04.11."
                        PText(EinsatzUhr.format(iso, "EEEE dd.MM."), 26f, 700, EinsatzFarbe.trenner, -0.5f)
                        Spacer(Modifier.weight(1f))
                        Box(Modifier.size(44.dp, 2.dp).background(EinsatzFarbe.trenner))
                    }

                    EinsatzDiagramm(
                        oben = y + 76f, bedarf = bedarf, gebucht = stunden.map { wert(gebucht, it) },
                        fahrer = stunden.map { wert(angebot, it) }, bedarfBasis = bedarfBasis, ziehbar = true,
                    ) { i, w -> modell.bedarfAnpassen(iso, stunden[i], w) }
                }
            }

            Box(Modifier.platz(20f, hinweisY - 20f, 362f, 40f), contentAlignment = Alignment.Center) {
                PAbsatz(
                    "Bedarf per Hand anpassen: Punkte im Diagramm nach oben oder unten ziehen.", 12f, 500, 16f,
                    lime.copy(alpha = 0.5f), 0.5f, ausrichtung = TextAlign.Center,
                )
            }
            RahmenText(
                "Zurücksetzen", 14f, 500, lime.copy(alpha = 0.5f),
                Modifier.mittig(201f, fussY - 12f, 160f, 24f).alpha(if (angepasst) 1f else 0.4f)
                    .tippen { if (angepasst) modell.bedarfAnpassung = emptyMap() },
            )
            GrosserPfeil(modifier = Modifier.platz(309f, fussY - 24f, 65f, 48f).tippen { modell.bedarfWeiter() })
        }
    }
}

/**
 * Einsatzplanung: ein Tag des Zeitraums (EinsatzTagAnsicht.swift, Figma 2588:12036).
 * Punkte oben, Diagramm des Tages, Optionen Standard/Sicher, Vorschlaege (offen gross mit Fahrten,
 * uebernommen kompakt), Wallet-Karte, accept fuer den ganzen Tag, Pfeile zum Blaettern.
 * Der Engine-Block zeigt im Betrieb nichts (nur Demo-Daten), darum steht hier nichts dazwischen.
 */
@Composable
internal fun EinsatzTagAnsicht(
    modell: EinsatzPlanungModell,
    /** Tipp auf eine Karte: Fahrt-Simulation (Vorschlag, Position ab 1, rideDurationMinutes). */
    oeffneSimulation: (EinsatzVorschlag, Int, Int) -> Unit,
) {
    val kartenOben = 574f
    val knopfHoehe = 51f
    val maxZeilen = 5
    val reiterX = floatArrayOf(120f, 282f)
    val reiterY = 502.5f

    data class Karte(val v: EinsatzVorschlag, val position: Int, val erledigt: Boolean, val top: Float, val hoehe: Float, val knopfTop: Float)

    val tage = modell.planTage
    val index = min(modell.planTagIndex, max(0, tage.size - 1))
    val tagIso = if (tage.isEmpty()) modell.heute else tage[index]
    val eintrag = modell.geplant[tagIso]
    val vorschlaege = (eintrag?.suggestions ?: emptyList()).filter { it.id !in modell.abgelehnt }
    val offene = vorschlaege.filter { it.id !in modell.uebernommen }
    val erledigte = vorschlaege.filter { it.id in modell.uebernommen }

    var y = kartenOben
    val karten = (offene + erledigte).mapIndexed { position, v ->
        if (v.id in modell.uebernommen) {
            val k = Karte(v, position, true, y, 117f, y + 117f + 16f)
            y += 117f + 16f + knopfHoehe + 17f
            k
        } else {
            val zeilen = if (v.rides.size > maxZeilen) maxZeilen + 1 else max(1, v.rides.size)
            val h = 171f + (zeilen - 1) * 40f
            val k = Karte(v, position, false, y, h, y + h + 17f)
            y += h + 17f + knopfHoehe + 8f
            k
        }
    }
    val kartenEnde = karten.lastOrNull()?.let { it.knopfTop + knopfHoehe } ?: (kartenOben + 60f)
    val walletTop = kartenEnde + 160f
    val hoehe = walletTop + 769f
    val laeuft = modell.tagLaeuft
    val strategieKey = eintrag?.strategyKey ?: modell.strategieKey
    val tagFertig = vorschlaege.isNotEmpty() && offene.isEmpty()
    val titel = EinsatzUhr.tagKurz(tagIso)
    val lime = EinsatzFarbe.lime

    // Diagramm des Tages: mit Plan hoechstens gleichzeitig belegte Fahrzeuge je Stunde, ohne Plan die Schaetzung.
    val stunden = (6 until 26).toList()
    val basisNr = EinsatzUhr.tagNr(tagIso, modell.heute) * 24
    fun wert(r: List<Int>, h: Int) = if (basisNr + h >= 0 && basisNr + h < r.size) max(0, r[basisNr + h]) else 0
    val belegt = vorschlaege.map { v -> v.rides.mapNotNull { r -> EinsatzUhr.minuten(r.etd)?.let { it to it + (r.durationMinutes ?: 0.0).toInt() } } }
    val bedarfAlle = modell.bedarfAngepasst
    val dBedarf = if (vorschlaege.isEmpty()) stunden.map { wert(bedarfAlle, it) } else stunden.map { h ->
        var spitze = 0
        var m = h * 60
        while (m < (h + 1) * 60) {
            spitze = max(spitze, belegt.count { fz -> fz.any { it.first <= m && it.second > m } })
            m += 5
        }
        spitze
    }
    val angebot = modell.angebotAlle
    val dFahrer = if (vorschlaege.isEmpty()) stunden.map { wert(angebot, it) } else stunden.map { h ->
        vorschlaege.count { it.startMinutes < (h + 1) * 60 && max(it.endMinutes, it.startMinutes) > h * 60 }
    }
    val dGebucht = modell.gebuchtAlle.let { g -> stunden.map { wert(g, it) } }

    val kartenDeckung by animateFloatAsState(if (laeuft) 0.3f else 1f, tween(300, easing = FastOutSlowInEasing), label = "karten")

    Box(Modifier.fillMaxSize()) {
        EinsatzHintergrund()
        // Beim Blaettern oben beginnen.
        key(index) {
            PlanLeinwand(inhaltHoehe = hoehe, basisHoehe = 873f) {
                ZurueckKnopf(Modifier.platz(20f, 60f)) { modell.tagZurueck() }
                val punkteBreite = (max(1, tage.size) - 1) * 17f + 7f
                EinsatzPunkte(tage.size, index, Modifier.mittig(201f, 81f, punkteBreite, 7f))
                RahmenText(titel, 24f, 700, lime, Modifier.mittig(201f, 122f, 380f, 24f))

                EinsatzDiagramm(oben = 194f, bedarf = dBedarf, gebucht = dGebucht, fahrer = dFahrer)

                EinsatzStrategie.alle.forEachIndexed { i, s ->
                    val aktiv = s.key == strategieKey
                    Box(Modifier.mittig(reiterX[i], reiterY - 20f, 124f, 40f).tippen { if (!laeuft) modell.tagesStrategie(s.key) }) {
                        RahmenText(s.titel, 16f, 500, lime.copy(alpha = if (aktiv) 1f else 0.5f), Modifier.size(124.dp, 40.dp))
                        if (aktiv) {
                            Box(Modifier.platz(3.5f, 8.5f, 2f, 23f).background(lime))
                            Box(Modifier.platz(118.5f, 8.5f, 2f, 23f).background(lime))
                        }
                    }
                }

                if (modell.fehler.isNotEmpty()) {
                    PAbsatz(modell.fehler, 12f, 500, 16f, EinsatzFarbe.rot, 0.5f, Modifier.platz(20f, kartenOben - 34f, 362f))
                }
                if (laeuft) {
                    Box(Modifier.platz(20f, kartenOben - 38f, 362f, 16f), contentAlignment = Alignment.Center) {
                        Text(
                            modell.planLog.ifEmpty { "Plane Einsatz…" }, style = grotesk(12f, 500, abstand = 0.5f, farbe = lime),
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (!laeuft && karten.isEmpty()) {
                    PAbsatz(
                        "Für diesen Tag gibt es keine Vorschläge.", 16f, 500, 20f, lime.copy(alpha = 0.6f), 0.5f,
                        Modifier.platz(20f, kartenOben + 20f, 362f), TextAlign.Center,
                    )
                }

                for (k in karten) {
                    key(k.v.id) {
                        VorschlagKarte(
                            v = k.v, position = k.position, erledigt = k.erledigt, top = k.top, hoehe = k.hoehe, knopfTop = k.knopfTop,
                            maxZeilen = maxZeilen, deckung = kartenDeckung, gesperrt = laeuft,
                            oeffnen = { oeffneSimulation(k.v, k.position + 1, modell.fahrtDauerRegel) },
                            zuruecknehmen = { modell.zuruecknehmen(k.v) },
                            ablehnen = { modell.ablehnen(k.v.id) },
                            annehmen = { modell.annehmen(k.v) },
                        )
                    }
                }

                TagesWalletKarte(titel, EinsatzWallet.werte(vorschlaege), Modifier.platz(20f, walletTop))

                RahmenText(EinsatzStrategie.finden(strategieKey).titel, 26f, 500, lime, Modifier.mittig(201f, walletTop + 461f, 300f, 24f))

                TagPfeil(vor = false, aktiv = index > 0, Modifier.platz(10f, walletTop + 509f, 65f, 48f)) { modell.tagWechseln(index - 1) }
                TagKnopf(tagFertig, offene.size, laeuft, Modifier.platz(112f, walletTop + 507f, 178f, 51f)) {
                    if (!tagFertig && !laeuft && offene.isNotEmpty()) modell.tagAnnehmen(tagIso)
                }
                TagPfeil(vor = true, aktiv = index < tage.size - 1, Modifier.platz(327f, walletTop + 509f, 65f, 48f)) { modell.tagWechseln(index + 1) }

                val status = modell.tagesStatus
                StatusPunkte(status, Modifier.mittig(201f, walletTop + 579.5f, (max(1, tage.size) - 1) * 22f + 12f, 12f))
            }
        }
    }
}

@Composable
private fun VorschlagKarte(
    v: EinsatzVorschlag, position: Int, erledigt: Boolean, top: Float, hoehe: Float, knopfTop: Float, maxZeilen: Int,
    deckung: Float, gesperrt: Boolean,
    oeffnen: () -> Unit, zuruecknehmen: () -> Unit, ablehnen: () -> Unit, annehmen: () -> Unit,
) {
    val dunkel = hex(0x1D1C1D, 0.8f)
    val wenn: (() -> Unit) -> () -> Unit = { a -> { if (!gesperrt) a() } }
    Box(Modifier.platz(20f, top, 362f, hoehe).alpha(deckung).clipToBounds().background(hex(0xFEFFFE)).tippen(wenn(oeffnen))) {
        Text(
            "#${position + 1} ${v.name}", style = grotesk(30f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)),
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.platz(18f, 18f, 262f, 38f),
        )
        Column(Modifier.platz(0f, 24f, 343f, 40f), horizontalAlignment = Alignment.End) {
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(v.start, 15f, 700, Color.Black) }
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText("– ${v.end}", 15f, 700, Color.Black) }
        }
        RahmenText("${v.hours}h", 15f, 700, EinsatzFarbe.gruen, Modifier.platz(0f, 67f, 343f, 20f), abstand = 0f, ausrichtung = Alignment.CenterEnd)

        if (!erledigt) {
            val sichtbar = v.rides.take(maxZeilen)
            if (sichtbar.isEmpty()) {
                Box(Modifier.platz(18f, 87f - 16f, 285f, 32f), contentAlignment = Alignment.CenterStart) {
                    PText("Bereitschaft & Kurzfahrten im Stadtgebiet", 12f, 400, dunkel, 0.5f)
                }
            } else {
                sichtbar.forEachIndexed { i, f ->
                    Box(Modifier.platz(18f, 87f + i * 40f - 20f, 285f, 40f), contentAlignment = Alignment.CenterStart) { FahrtZeile(f) }
                }
            }
            if (v.rides.size > maxZeilen) {
                Box(Modifier.platz(18f, 87f + maxZeilen * 40f - 8f, 285f, 16f), contentAlignment = Alignment.CenterStart) {
                    PText("+ ${v.rides.size - maxZeilen} weitere Fahrten", 12f, 700, dunkel, 0.5f)
                }
            }
            Box(Modifier.platz(17.5f, hoehe - 52f, 324f, 1f).background(hex(0x7E817F)))
        }

        val unten = hoehe - (if (erledigt) 18f else 27f)
        Box(Modifier.platz(18f, unten - 8f, 226f, 16f), contentAlignment = Alignment.CenterStart) {
            Text(
                if (v.vehicleLabel.isEmpty()) "Fahrzeug offen" else "${if (v.vehicleIsEv) "EV – " else ""}${v.vehicleLabel}",
                style = grotesk(12f, 700, farbe = Color.Black.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        RahmenText(v.shiftKm?.let { "$it km" } ?: "", 12f, 700, Color.Black.copy(alpha = 0.5f), Modifier.platz(0f, unten - 8f, 344f, 16f), 0f, Alignment.CenterEnd)
    }

    if (erledigt) {
        Icon("x_knopf", Modifier.platz(20f, knopfTop, 54f, 50.29f).alpha(deckung).tippen(wenn(zuruecknehmen)), skalierung = ContentScale.FillBounds)
        Row(
            Modifier.platz(82f, knopfTop, 300f, 51f).alpha(deckung).background(EinsatzFarbe.lime),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            PText("Übernommen", 24f, 700, Color.Black, -0.5f)
            Spacer(Modifier.width(10.dp))
            Icon("haken", Modifier.size(24.66.dp, 29.04.dp), skalierung = ContentScale.FillBounds)
        }
    } else {
        RahmenText(
            "Ablehnen", 24f, 700, EinsatzFarbe.rot,
            Modifier.platz(20f, knopfTop, 178f, 51f).alpha(deckung).border(2.dp, EinsatzFarbe.rot, RectangleShape).tippen(wenn(ablehnen)),
            abstand = -0.5f,
        )
        RahmenText(
            "Annehmen", 24f, 700, Color.Black,
            Modifier.platz(204f, knopfTop, 178f, 51f).alpha(deckung).background(EinsatzFarbe.lime).tippen(wenn(annehmen)),
            abstand = -0.5f,
        )
    }
}

/** Adresse wie in Figma: "Strasse Nr, PLZ" (ohne Ort). */
internal fun kurzeAdresse(text: String): String {
    val teile = text.split(",").map { it.trim() }.filter { it.isNotEmpty() }
    val i = teile.indexOfFirst { Regex("""^\d{5}\b""").containsMatchIn(it) }
    if (i > 0) return "${teile[i - 1]}, ${teile[i].take(5)}"
    return teile.firstOrNull() ?: ""
}

@Composable
private fun FahrtZeile(f: EinsatzFahrt) {
    val ab = kurzeAdresse(f.adresseAb).ifEmpty { f.pickup }
    val ziel = kurzeAdresse(f.adresseZiel).ifEmpty { f.dropoff }
    val blau = hex(0x2D6CFF)
    val t = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight(700), letterSpacing = 0.5.sp)) { append("${f.etd} ") }
        withStyle(SpanStyle(letterSpacing = 0.5.sp)) { append("– ") }
        withStyle(SpanStyle(letterSpacing = 1.sp)) { append("$ab – $ziel") }
        withStyle(SpanStyle(letterSpacing = 0.5.sp)) { append(" – ") }
        withStyle(SpanStyle(fontWeight = FontWeight(700), letterSpacing = 0.5.sp)) { append(f.ankunft) }
        if (f.sammel) withStyle(SpanStyle(fontWeight = FontWeight(700), color = blau)) { append(" · Sammelfahrt") }
        if (f.route == "FTO") withStyle(SpanStyle(fontWeight = FontWeight(700), color = blau)) { append(" · über Flughafentangente Ost") }
    }
    Text(t, style = grotesk(12f, 400, 15f, farbe = hex(0x1D1C1D, 0.8f)), maxLines = 2, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun TagPfeil(vor: Boolean, aktiv: Boolean, modifier: Modifier, aktion: () -> Unit) {
    GrosserPfeil(if (aktiv) "weiter_gross" else "zurueck_gross", vor, modifier.tippen { if (aktiv) aktion() })
}

/** accept fuellt sich von links, sobald der Tag uebernommen ist. */
@Composable
private fun TagKnopf(fertig: Boolean, offen: Int, laeuft: Boolean, modifier: Modifier, aktion: () -> Unit) {
    val gesperrt = laeuft || (!fertig && offen == 0)
    val breite by animateFloatAsState(if (fertig) 178f else 0f, tween(560, easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)), label = "accept")
    val farbe by animateColorAsState(if (fertig) Color.Black else EinsatzFarbe.lime, tween(260, delayMillis = 220), label = "acceptText")
    Box(
        modifier.alpha(if (gesperrt) 0.5f else 1f).clipToBounds().border(2.dp, EinsatzFarbe.lime, RectangleShape)
            .tippen { if (!gesperrt) aktion() },
    ) {
        Box(Modifier.width(breite.dp).fillMaxHeight().background(EinsatzFarbe.lime))
        RahmenText("accept", 24f, 700, farbe, Modifier.size(178.dp, 51.dp), abstand = -0.5f)
    }
}

/** Status der Tage: 12er Punkte im 22er Abstand, gruen = bestaetigt, grau = offen, weisser Rand. */
@Composable
private fun StatusPunkte(status: List<Boolean>, modifier: Modifier) {
    Box(modifier) {
        status.forEachIndexed { i, ok ->
            val farbe by animateColorAsState(if (ok) EinsatzFarbe.gruen else hex(0x888989), tween(400), label = "status$i")
            Box(Modifier.platz(i * 22f, 0f, 12f, 12f).background(farbe, CircleShape).border(1.dp, Color.White, CircleShape))
        }
    }
}
