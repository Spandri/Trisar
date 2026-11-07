package de.trisar.dispo.karte

import android.graphics.PointF
import android.view.Gravity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.trisar.dispo.fahrten.FahrtPruefung
import de.trisar.dispo.fahrten.Hinweis
import de.trisar.dispo.fahrten.Rueckfrage
import de.trisar.dispo.fahrten.VorschlagListe
import de.trisar.dispo.fahrten.blockieren
import de.trisar.dispo.stamm.Eingabe
import de.trisar.dispo.stamm.Leinwand
import de.trisar.dispo.stamm.StammZeilenKnopf
import de.trisar.dispo.stamm.dbMeldung
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.EigeneOrte
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.Konfig
import de.trisar.kern.Ort
import de.trisar.kern.OrtIcons
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin

private val LIME = hex(0xE3F654)

/** "rein 50 m / raus 120 m" wie in der Liste und am Pin. */
internal fun radienText(rein: Int, raus: Int) = "rein $rein m / raus $raus m"

// MARK: - Daten (orte, orte_standard)

/** Schreiben der eigenen Orte und der Standard-Radien (nur Dispo darf das, RLS ist_dispo()). */
internal object OrteDienst {
    data class Standard(val rein: Int, val raus: Int)

    suspend fun standardLaden(): Standard? = runCatching {
        val z = Backend.client.from("orte_standard").select(Columns.raw("radius_rein_m, radius_raus_m")) { limit(1) }
            .decodeList<JsonObject>().firstOrNull() ?: return null
        Standard(jGanz(z, "radius_rein_m") ?: 50, jGanz(z, "radius_raus_m") ?: 100)
    }.getOrNull()

    /** Gibt eine Fehlermeldung zurueck oder null bei Erfolg. */
    suspend fun standardSpeichern(rein: Int, raus: Int): String? = try {
        Backend.client.from("orte_standard").update(buildJsonObject { put("radius_rein_m", rein); put("radius_raus_m", raus) }) {
            filter { eq("id", true) }
        }
        null
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        dbMeldung(e)
    }

    suspend fun speichern(id: String?, name: String, adresse: String, lat: Double, lng: Double, rein: Int, raus: Int, icon: String): String? = try {
        val zeile = buildJsonObject {
            put("name", name); put("adresse", adresse); put("lat", lat); put("lng", lng)
            put("radius_rein_m", rein); put("radius_raus_m", raus); put("icon", icon)
        }
        if (id == null) Backend.client.from("orte").insert(zeile)
        else Backend.client.from("orte").update(zeile) { filter { eq("id", id) } }
        EigeneOrte.laden()
        null
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        val m = dbMeldung(e)
        // Eindeutiger Name (orte_name_eindeutig) und Radien-Regel als verstaendlicher Hinweis.
        when {
            m.contains("orte_name_eindeutig") || m.contains("duplicate key") -> "Diesen Namen gibt es schon."
            m.contains("orte_raus_groesser_rein") -> "Der Rausfahr-Radius muss größer als der Reinfahr-Radius sein."
            else -> m
        }
    }

    suspend fun loeschen(id: String): String? = try {
        Backend.client.from("orte").delete { filter { eq("id", id) } }
        EigeneOrte.laden()
        null
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        dbMeldung(e)
    }

    private fun jGanz(o: JsonObject, k: String): Int? = jZahl(o[k])?.roundToInt()

    /** Pruefung vor dem Speichern (DB-Regeln 10..5000 / 11..10000, raus > rein). */
    fun radienFehler(rein: Int?, raus: Int?): String? = when {
        rein == null || raus == null -> "Bitte beide Radien in Metern eingeben."
        rein !in 10..5000 -> "Der Reinfahr-Radius muss zwischen 10 und 5000 m liegen."
        raus !in 11..10000 -> "Der Rausfahr-Radius muss zwischen 11 und 10000 m liegen."
        raus <= rein -> "Der Rausfahr-Radius muss größer als der Reinfahr-Radius sein."
        else -> null
    }
}

// MARK: - Kreise auf der Karte

/** Innen Reinfahr-Radius (gefuellt, transparent), aussen Rausfahr-Radius (nur Rand, gestrichelt). */
internal object OrtKreise {
    private fun ring(lat: Double, lng: Double, meter: Int): String {
        val n = 72
        val dLat = meter / 110_540.0
        val dLng = meter / (111_320.0 * cos(lat * PI / 180))
        return (0..n).joinToString(",") { i ->
            val w = 2 * PI * i / n
            "[${lng + dLng * cos(w)},${lat + dLat * sin(w)}]"
        }
    }

    private val LEER = "{\"type\":\"FeatureCollection\",\"features\":[]}"

    fun setzen(stil: Style, praefix: String, lat: Double?, lng: Double?, rein: Int, raus: Int, faktor: Float = 1f) {
        if (!stil.isFullyLoaded) return
        val da = lat != null && lng != null
        val innen = if (da) "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[${ring(lat!!, lng!!, rein)}]]}}" else LEER
        val aussen = if (da) "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"LineString\",\"coordinates\":[${ring(lat!!, lng!!, raus)}]}}" else LEER
        val lime = LIME.toArgb()
        quelle(stil, "$praefix-rein", innen) { id ->
            stil.addLayer(FillLayer(id, id).withProperties(PropertyFactory.fillColor(lime), PropertyFactory.fillOpacity(0.18f)))
            stil.addLayer(LineLayer("$id-rand", id).withProperties(
                PropertyFactory.lineColor(lime), PropertyFactory.lineWidth(1.5f * faktor), PropertyFactory.lineOpacity(0.9f),
            ))
        }
        quelle(stil, "$praefix-raus", aussen) { id ->
            stil.addLayer(LineLayer(id, id).withProperties(
                PropertyFactory.lineColor(lime), PropertyFactory.lineWidth(2f * faktor), PropertyFactory.lineOpacity(0.9f),
                PropertyFactory.lineDasharray(arrayOf(2f, 2f)),
            ))
        }
    }

    private fun quelle(stil: Style, id: String, json: String, ebenen: (String) -> Unit) {
        val q = stil.getSourceAs<GeoJsonSource>(id)
        if (q != null) { q.setGeoJson(json); return }
        stil.addSource(GeoJsonSource(id, json))
        ebenen(id)
    }

    /** Zoom, bei dem der Rausfahr-Kreis gut in eine Flaeche von `breiteDp` passt. */
    fun zoom(lat: Double, raus: Int, breiteDp: Float): Double {
        val meterJeDp = (raus * 2.8) / breiteDp
        val z = ln(156_543.03 * cos(lat * PI / 180) / meterJeDp) / ln(2.0)
        return z.coerceIn(11.0, 18.5)
    }
}

/** Ort-Marke: Icon im dunklen Kreis, ausgewaehlt Lime mit Lime-Rand. */
@Composable
internal fun OrtMarke(icon: String, aktiv: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier.size(34.dp).background(Color.Black.copy(alpha = 0.85f), CircleShape)
            .border(2.dp, if (aktiv) LIME else hex(0x5A5A5A), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(if (aktiv) OrtIcons.lime(icon) else OrtIcons.grau(icon), Modifier.size(18.dp))
    }
}

/** Name und Radien am gewaehlten Ort. */
@Composable
internal fun OrtSchild(ort: Ort, modifier: Modifier = Modifier) {
    Column(
        modifier.background(Color.Black.copy(alpha = 0.85f), RoundedCornerShape(8.dp))
            .border(1.dp, hex(0x3A3B2A), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(ort.name, style = grotesk(13f, 700, farbe = Color.White), maxLines = 1)
        Text(radienText(ort.radius_rein_m, ort.radius_raus_m), style = grotesk(12f, 500, farbe = LIME), maxLines = 1)
    }
}

// MARK: - Abschnitt "Orte" im Karten Filter

/** Hoehe des Abschnitts im Raster (fuer das Verschieben der Knoepfe darunter). */
internal fun orteAbschnittHoehe(anzahl: Int, fehler: Boolean): Float =
    32f + 28f + 56f + (if (fehler) 28f else 12f) + anzahl * 68f + 56f + 24f

/**
 * Standard-Radien (orte_standard) und die Liste der eigenen Orte. Antippen = bearbeiten,
 * "Ort hinzufuegen" legt einen neuen an. Die Standard-Radien speichern kurz nach der Eingabe.
 */
@Composable
internal fun OrteAbschnitt(top: Float, standardFehler: String?, standard: StandardEingabe, oeffnen: (Ort?) -> Unit) {
    Text("Orte", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
        modifier = Modifier.platz(20f, top, 362f, 24f), maxLines = 1)
    Text("Standard für alle anderen Adressen", style = grotesk(14f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
        modifier = Modifier.platz(20f, top + 32f, 362f, 20f), maxLines = 1)
    RadiusFeld("Rein", standard.rein, { standard.rein = it.filter(Char::isDigit).take(5); standard.geaendert() }, Modifier.platz(20f, top + 60f, 175f, 56f))
    RadiusFeld("Raus", standard.raus, { standard.raus = it.filter(Char::isDigit).take(5); standard.geaendert() }, Modifier.platz(207f, top + 60f, 175f, 56f))
    var y = top + 60f + 56f + 12f
    if (standardFehler != null) {
        Text(standardFehler, style = grotesk(13f, 500, farbe = hex(0xFF6B6B)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.platz(20f, y - 4f, 362f, 20f))
        y += 16f
    }
    for (o in EigeneOrte.liste) {
        Row(
            Modifier.platz(20f, y, 362f, 56f).border(2.dp, LIME).tippen { oeffnen(o) }.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(OrtIcons.grau(o.icon), Modifier.size(24.dp))
            Text(o.name, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f))
            Text(radienText(o.radius_rein_m, o.radius_raus_m), style = grotesk(13f, 500, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        }
        y += 68f
    }
    StammZeilenKnopf("Ort hinzufügen", "Pin_Nav_Trisar_Icons_01", Modifier.platz(20f, y, 362f, 56f),
        iconBreite = 22f, iconHoehe = 22f, innen = 12f) { oeffnen(null) }
}

/** Eingabe der Standard-Radien, speichert 800 ms nach der letzten Aenderung, wenn gueltig. */
internal class StandardEingabe(private val speichern: (Int, Int) -> Unit) {
    var rein by mutableStateOf("")
    var raus by mutableStateOf("")
    var zaehler by mutableIntStateOf(0)
        private set

    fun geaendert() { zaehler++ }

    fun ausloesen() {
        val r = rein.toIntOrNull() ?: return
        val a = raus.toIntOrNull() ?: return
        speichern(r, a)
    }
}

/** Zeile mit Lime-Rand: Beschriftung, Zahl, "m". */
@Composable
private fun RadiusFeld(titel: String, wert: String, aendern: (String) -> Unit, modifier: Modifier) {
    Row(modifier.border(2.dp, LIME).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(titel, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Eingabe(wert, aendern, "", grotesk(16f, 500, abstand = 0.5f, farbe = LIME), Color.Transparent, Modifier.weight(1f),
            tastatur = KeyboardType.Number, gross = KeyboardCapitalization.None)
        Text("m", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)))
    }
}

// MARK: - Ort bearbeiten

/**
 * Ort anlegen oder bearbeiten: Name, Adresse suchen (wie beim Fahrt erstellen), Pin auf der Karte
 * verschieben (Einfahrt), Radien, Icon. Loeschen mit Rueckfrage.
 */
@Composable
internal fun OrtBearbeitenSeite(ort: Ort?, zurueck: () -> Unit) {
    BackHandler(onBack = zurueck)
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    var name by remember { mutableStateOf(ort?.name ?: "") }
    var adresse by remember { mutableStateOf(ort?.adresse ?: "") }
    /** Adresse, zu der der Pin gehoert (gesucht und ausgewaehlt). */
    var gewaehlteAdresse by remember { mutableStateOf(ort?.adresse ?: "") }
    var punkt by remember { mutableStateOf(ort?.let { KartenPunkt(it.lat, it.lng) }) }
    var rein by remember { mutableStateOf((ort?.radius_rein_m ?: 50).toString()) }
    var raus by remember { mutableStateOf((ort?.radius_raus_m ?: 100).toString()) }
    var icon by remember { mutableStateOf(ort?.icon ?: "pin") }
    var vorschlaege by remember { mutableStateOf(emptyList<String>()) }
    var adressFokus by remember { mutableStateOf(false) }
    var lauf by remember { mutableStateOf<Job?>(null) }
    var zentrieren by remember { mutableIntStateOf(0) }
    var meldung by remember { mutableStateOf<String?>(null) }
    var loeschFrage by remember { mutableStateOf(false) }
    var speichert by remember { mutableStateOf(false) }

    fun adresseTippen(text: String) {
        adresse = text
        lauf?.cancel()
        val suche = text.trim()
        if (suche.isEmpty()) { vorschlaege = emptyList(); return }
        // fetchAddressPredictions: 250 ms warten, nur das juengste Ergebnis zaehlt.
        lauf = scope.launch {
            delay(250)
            vorschlaege = FahrtPruefung.ortsVorschlaege(suche)
        }
    }

    fun adresseWaehlen(wert: String) {
        adresse = wert
        vorschlaege = emptyList()
        fokusManager.clearFocus()
        scope.launch {
            val p = DispoRouten.punkt(wert)
            if (p == null) { meldung = "Adresse nicht gefunden."; return@launch }
            gewaehlteAdresse = wert
            punkt = p
            zentrieren++
        }
    }

    fun speichern() {
        if (speichert) return
        val n = name.trim()
        val a = adresse.trim()
        if (n.isEmpty()) { meldung = "Bitte einen Namen eingeben."; return }
        if (a.isEmpty()) { meldung = "Bitte eine Adresse suchen."; return }
        val r = rein.toIntOrNull(); val o = raus.toIntOrNull()
        OrteDienst.radienFehler(r, o)?.let { meldung = it; return }
        if (EigeneOrte.liste.any { it.id != ort?.id && it.name.trim().equals(n, ignoreCase = true) }) {
            meldung = "Diesen Namen gibt es schon."; return
        }
        speichert = true
        scope.launch {
            // Getippt, aber nicht aus der Liste gewaehlt: Adresse jetzt suchen.
            var p = punkt
            if (p == null || a != gewaehlteAdresse.trim()) {
                val neu = DispoRouten.punkt(a)
                if (neu == null && p == null) { speichert = false; meldung = "Adresse nicht gefunden."; return@launch }
                if (neu != null && a != gewaehlteAdresse.trim()) p = neu
            }
            val ziel = p!!
            val fehler = OrteDienst.speichern(ort?.id, n, a, ziel.lat, ziel.lng, r!!, o!!, icon)
            speichert = false
            if (fehler != null) meldung = fehler else zurueck()
        }
    }

    val reinZahl = rein.toIntOrNull() ?: 0
    val rausZahl = raus.toIntOrNull() ?: 0
    val kartenTop = 342f
    val kartenHoehe = 280f
    val radienTop = kartenTop + kartenHoehe + 40f
    val iconTop = radienTop + 136f
    val knopfTop = iconTop + 32f + 52f + 32f
    val inhaltHoehe = knopfTop + (if (ort != null) 68f else 0f) + 56f + 140f

    Box(Modifier.fillMaxSize().background(Color.Black).blockieren()) {
        DispoHintergrund()
        Leinwand(874f, inhaltHoehe) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Text(if (ort == null) "Ort hinzufügen" else "Ort bearbeiten", style = grotesk(42f, 700, 42f, farbe = LIME),
                modifier = Modifier.platz(20f, 140f, null, 42f), maxLines = 1)

            TextFeld("Name", name, { name = it }, Modifier.platz(20f, 206f, 362f, 56f))
            TextFeld("Adresse", adresse, { adresseTippen(it) }, Modifier.platz(20f, 274f, 362f, 56f), fokus = { adressFokus = it })

            OrtKarte(
                punkt, reinZahl, rausZahl, icon, zentrieren, Modifier.platz(20f, kartenTop, 362f, kartenHoehe),
            ) { p -> punkt = p }
            Text(
                if (punkt == null) "Adresse suchen, dann den Pin auf die Einfahrt setzen."
                else "Pin ziehen oder auf die Karte tippen, um die Einfahrt zu setzen.",
                style = grotesk(13f, 500, farbe = LIME.copy(alpha = 0.6f)), maxLines = 2,
                modifier = Modifier.platz(20f, kartenTop + kartenHoehe + 8f, 362f, 32f),
            )

            RadiusFeld("Reinfahr-Radius", rein, { rein = it.filter(Char::isDigit).take(5) }, Modifier.platz(20f, radienTop, 362f, 56f))
            RadiusFeld("Rausfahr-Radius", raus, { raus = it.filter(Char::isDigit).take(5) }, Modifier.platz(20f, radienTop + 68f, 362f, 56f))

            Text("Icon", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
                modifier = Modifier.platz(20f, iconTop, 362f, 24f), maxLines = 1)
            OrtIcons.SCHLUESSEL.forEachIndexed { i, k ->
                val an = k == icon
                Box(
                    Modifier.platz(20f + i * 62f, iconTop + 32f, 52f, 52f)
                        .background(hex(0x242525), RoundedCornerShape(12.dp))
                        .border(2.dp, if (an) LIME else Color.Transparent, RoundedCornerShape(12.dp))
                        .tippen { icon = k },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (an) OrtIcons.lime(k) else OrtIcons.grau(k), Modifier.size(26.dp))
                }
            }

            StammZeilenKnopf(if (speichert) "Wird gespeichert..." else "Ort speichern", "Arrow_Trisar_Icons_01", Modifier.platz(20f, knopfTop, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, innen = 12f) { speichern() }
            if (ort != null) {
                StammZeilenKnopf("Ort löschen", "Arrow_Nav_Trisar_Icons_01", Modifier.platz(20f, knopfTop + 68f, 362f, 56f),
                    iconBreite = 34f, iconHoehe = 20f, hintergrund = 0xFF6B6B, innen = 12f) { loeschFrage = true }
            }

            // Vorschlaege ueber der Karte, wie beim Fahrt erstellen.
            if (adressFokus && vorschlaege.isNotEmpty()) {
                VorschlagListe(vorschlaege, Modifier.platz(20f, 274f + 56f + 4f)) { adresseWaehlen(vorschlaege[it]) }
            }
        }
        FussleisteUnten()

        meldung?.let { Hinweis(it, null) { meldung = null } }
        if (loeschFrage && ort != null) {
            Rueckfrage("Ort „${ort.name}“ löschen?", {
                loeschFrage = false
                scope.launch {
                    val f = OrteDienst.loeschen(ort.id)
                    if (f != null) meldung = f else zurueck()
                }
            }, { loeschFrage = false })
        }
    }
}

/** Textzeile mit Lime-Rand: Beschriftung links, Eingabe dahinter. */
@Composable
private fun TextFeld(titel: String, wert: String, aendern: (String) -> Unit, modifier: Modifier, fokus: ((Boolean) -> Unit)? = null) {
    Row(modifier.border(2.dp, LIME).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(titel, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Eingabe(wert, aendern, "", grotesk(16f, 500, abstand = 0.5f, farbe = LIME), Color.Transparent, Modifier.weight(1f),
            fokusGeaendert = fokus)
        if (wert.isNotEmpty()) Icon("clear-field-green", Modifier.size(20.dp).tippen { aendern("") })
    }
}

/**
 * Kleine Karte beim Bearbeiten: Pin des Orts (ziehbar, Tipp auf die Karte setzt ihn), dazu
 * Reinfahr- und Rausfahr-Kreis, die mit den Eingaben live mitgehen.
 */
@Composable
private fun OrtKarte(
    punkt: KartenPunkt?, rein: Int, raus: Int, icon: String, zentrierSignal: Int,
    modifier: Modifier, setzen: (KartenPunkt) -> Unit,
) {
    val ctx = LocalContext.current
    val dichte = LocalDensity.current.density
    val ansicht = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply { onCreate(null) }
    }
    var karte by remember { mutableStateOf<MapLibreMap?>(null) }
    var stil by remember { mutableStateOf<Style?>(null) }
    val takt = remember { mutableIntStateOf(0) }
    val setzenAktuell by rememberUpdatedState(setzen)
    val punktAktuell by rememberUpdatedState(punkt)

    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lebenszyklus) {
        var gestartet = false
        var aktiv = false
        val beobachter = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> { ansicht.onStart(); gestartet = true }
                Lifecycle.Event.ON_RESUME -> { ansicht.onResume(); aktiv = true }
                Lifecycle.Event.ON_PAUSE -> { ansicht.onPause(); aktiv = false }
                Lifecycle.Event.ON_STOP -> { ansicht.onStop(); gestartet = false }
                else -> {}
            }
        }
        lebenszyklus.addObserver(beobachter)
        onDispose {
            lebenszyklus.removeObserver(beobachter)
            if (aktiv) ansicht.onPause()
            if (gestartet) ansicht.onStop()
            ansicht.onDestroy()
        }
    }

    LaunchedEffect(ansicht) {
        ansicht.getMapAsync { m ->
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.attributionGravity = Gravity.BOTTOM or Gravity.END
            m.uiSettings.setAttributionTintColor(Color(0xCC999999).toArgb())
            val p = punktAktuell
            val start = if (p != null) LatLng(p.lat, p.lng) else LatLng(48.137154, 11.576124)
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(start, if (p != null) OrtKreise.zoom(p.lat, raus.coerceAtLeast(30), 362f) else 11.0))
            m.addOnCameraMoveListener { takt.intValue++ }
            m.addOnCameraIdleListener { takt.intValue++ }
            m.addOnMapClickListener { ll -> setzenAktuell(KartenPunkt(ll.latitude, ll.longitude)); true }
            m.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) { s -> stil = s; takt.intValue++ }
            karte = m
        }
    }

    LaunchedEffect(stil, punkt, rein, raus) {
        val s = stil ?: return@LaunchedEffect
        val ok = OrteDienst.radienFehler(rein, raus) == null
        // Ungueltige Eingabe (z. B. leer beim Tippen): Kreise mit dem, was da ist, aber nie negativ.
        OrtKreise.setzen(s, "ob", punkt?.lat, punkt?.lng, rein.coerceAtLeast(1), if (ok) raus else raus.coerceAtLeast(rein + 1))
    }
    LaunchedEffect(karte, zentrierSignal) {
        val m = karte ?: return@LaunchedEffect
        val p = punktAktuell ?: return@LaunchedEffect
        if (zentrierSignal == 0) return@LaunchedEffect
        m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lng), OrtKreise.zoom(p.lat, raus.coerceAtLeast(30), 362f)), 400)
    }

    Box(modifier.clipToBounds().background(hex(0x0E0E0E)).border(2.dp, LIME)) {
        AndroidView(factory = { ansicht }, modifier = Modifier.fillMaxSize())
        val m = karte
        val p = punkt
        if (m != null && stil != null && p != null) {
            @Suppress("UNUSED_VARIABLE") val t = takt.intValue
            val s = m.projection.toScreenLocation(LatLng(p.lat, p.lng))
            val halb = 17f * dichte
            OrtMarke(icon, true, Modifier
                .offset { IntOffset((s.x - halb).roundToInt(), (s.y - halb).roundToInt()) }
                .pointerInput(m) {
                    var start = PointF()
                    var weg = Offset.Zero
                    detectDragGestures(
                        onDragStart = {
                            val q = punktAktuell ?: return@detectDragGestures
                            start = m.projection.toScreenLocation(LatLng(q.lat, q.lng))
                            weg = Offset.Zero
                        },
                    ) { aenderung, schritt ->
                        aenderung.consume()
                        weg += schritt
                        val neu = m.projection.fromScreenLocation(PointF(start.x + weg.x, start.y + weg.y))
                        setzenAktuell(KartenPunkt(neu.latitude, neu.longitude))
                    }
                })
        }
    }
}
