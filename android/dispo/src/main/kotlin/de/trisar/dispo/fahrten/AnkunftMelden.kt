package de.trisar.dispo.fahrten

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import de.trisar.dispo.EigenerStandort
import de.trisar.dispo.abstandM
import de.trisar.kern.Backend
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// "Ankuenfte bei mir" (17.11.2026, Kundenwunsch), Nachbau von admin/src/shared/ankunftMelden.js:
// Schalter im Fahrten Filter. Die Dispo bekommt Fahrzeuge zu ihrem Ort gemeldet (Push "in 5 min bei dir"
// und "angekommen"), und die Listen zeigen mit dem Schalter nur Fahrten zu diesem Ort:
// Ankuenfte = Ziel oder Abholung bei mir, Abfahrten = Abholung bei mir.
// Ort = einmal uebernommener Standort des Geraets oder ein eigener Ort (orte).
// Gespeichert auf dem Server (dispo_ankunft_melden, je Konto), weil der push-dienst die Meldungen
// auch bei geschlossener App schickt. Restzeiten rechnet der Server (rpc ankunft_bei_mir), gleich
// fuer Web, iOS und Android. Migration 20261117140000_ankunft_bei_mir.
// Stufe 2 (20261117160000): Ort automatisch (gespeicherter Ort, an dem ich bin, sonst mein Standort,
// laufend nachgefuehrt solange die App offen ist) und Melden "sobald unterwegs" (minuten = 0).

/** Einstellung der Dispo (eine Zeile in dispo_ankunft_melden). */
internal data class AnkunftStand(
    val geladen: Boolean = false,
    /** Tabelle da (Migration eingespielt), sonst bleibt der Schalter ausgeblendet. */
    val vorhanden: Boolean = false,
    val an: Boolean = false,
    /** Ort selbst waehlen und nachfuehren. Aus = fest gewaehlter Ort. */
    val automatisch: Boolean = true,
    val ortId: String? = null,
    val ortName: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    val umkreisM: Int = 300,
    val minuten: Int = 5,
    val beiAnkunft: Boolean = true,
    /** Speichern hat nicht geklappt. */
    val fehler: Boolean = false,
)

/** Eine Fahrt aus rpc ankunft_bei_mir. art 'ziel' oder 'abholung', restMin null = noch nicht zu mir unterwegs. */
internal data class AnkunftEintrag(val art: String, val restMin: Int?, val geschaetzt: Boolean, val angekommen: Boolean)

internal data class AnkunftOrt(val id: String, val name: String, val lat: Double, val lng: Double)

/** Ort fuer die Automatik: gespeicherter Ort (ortId) oder der eigene Standort (ortId null, Name leer). */
internal data class AutomatikZiel(val ortId: String?, val ortName: String, val lat: Double, val lng: Double)

internal object AnkunftMelden {
    /** 0 = sobald unterwegs */
    val MINUTEN_AUSWAHL = listOf(0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60)
    /** Automatik schreibt den eigenen Standort erst nach so viel Bewegung neu (ohne Ort). */
    private const val NACHFUEHREN_M = 100.0
    const val LISTE_TAKT_MS = 30_000L
    val NUR_ABHOLUNG = listOf("abholung")
    private val BEIDE = listOf("ziel", "abholung")

    // Texte wie TEXTE.de in ankunftMelden.js
    const val T_SCHALTER = "Ankünfte bei mir"
    const val T_ORT = "Ort"
    const val T_MELDEN = "Melden"
    const val T_VOR_ANKUNFT = "vor Ankunft"
    const val T_MEIN_STANDORT = "Mein Standort"
    const val T_AUTOMATISCH = "Automatisch"
    const val T_HIER = "hier"
    const val T_SOBALD_UNTERWEGS = "sobald unterwegs"
    const val T_STANDORT_LAEDT = "Standort wird geholt …"
    const val T_STANDORT_FEHLT = "Standort nicht verfügbar. Bitte einen Ort wählen."
    const val T_DA = "da"
    const val T_FEHLER = "Speichern hat nicht geklappt."

    /** Anzeige der Melden-Auswahl: "sobald unterwegs" oder "5 min". */
    fun minutenText(m: Int) = if (m == 0) T_SOBALD_UNTERWEGS else "$m min"

    var stand by mutableStateOf(AnkunftStand()); private set
    /** job_id (klein) -> Eintrag, getrennt nach art. */
    var ziel by mutableStateOf<Map<String, AnkunftEintrag>>(emptyMap()); private set
    var abholung by mutableStateOf<Map<String, AnkunftEintrag>>(emptyMap()); private set
    var orte by mutableStateOf<List<AnkunftOrt>>(emptyList()); private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ladeJob: Job? = null

    private fun nutzerId(): String? = Backend.client.auth.currentUserOrNull()?.id

    private fun zahl(o: JsonObject, k: String): Double? = W.zahl(o[k])

    private fun ausZeile(z: JsonObject): AnkunftStand = AnkunftStand(
        an = W.bool(z["an"]),
        automatisch = (z["automatisch"] as? JsonPrimitive)?.booleanOrNull != false,
        ortId = W.t(z["ort_id"]).ifEmpty { null },
        ortName = W.t(z["ort_name"]),
        lat = zahl(z, "lat"),
        lng = zahl(z, "lng"),
        umkreisM = zahl(z, "umkreis_m")?.toInt()?.takeIf { it > 0 } ?: 300,
        // 0 = sobald unterwegs, nicht durch 5 ersetzen
        minuten = zahl(z, "minuten")?.toInt()?.takeIf { it >= 0 } ?: 5,
        beiAnkunft = (z["bei_ankunft"] as? JsonPrimitive)?.booleanOrNull != false,
    )

    /** Einmal laden (ankunftLaden). Fehlt die Tabelle, wird es beim naechsten Aufruf noch einmal versucht. */
    fun laden() {
        if (ladeJob?.isActive == true) return
        if (stand.geladen && stand.vorhanden) return
        ladeJob = scope.launch {
            val uid = nutzerId() ?: return@launch
            val (zeile, ortListe) = coroutineScope {
                val z = async {
                    runCatching {
                        Backend.client.from("dispo_ankunft_melden").select { filter { eq("user_id", uid) }; limit(1) }
                            .decodeList<JsonObject>().firstOrNull()
                    }
                }
                val o = async {
                    runCatching {
                        Backend.client.from("orte").select(Columns.raw("id, name, lat, lng")) { order("name", Order.ASCENDING) }
                            .decodeList<JsonObject>()
                    }.getOrDefault(emptyList())
                }
                z.await() to o.await()
            }
            orte = ortListe.mapNotNull { o ->
                val lat = zahl(o, "lat") ?: return@mapNotNull null
                val lng = zahl(o, "lng") ?: return@mapNotNull null
                AnkunftOrt(W.t(o["id"]), W.t(o["name"]), lat, lng)
            }
            stand = zeile.fold(
                onSuccess = { z -> (if (z != null) ausZeile(z) else AnkunftStand()).copy(geladen = true, vorhanden = true) },
                // Migration fehlt noch: Schalter ausblenden statt Fehler zeigen.
                onFailure = { e -> if (e is CancellationException) throw e; AnkunftStand(geladen = true, vorhanden = false) },
            )
            automatikPruefen()
            if (stand.an) listeLaden()
        }
    }

    /** Stand neu vom Server holen, z. B. wenn ein anderes Geraet den Schalter umgestellt hat. */
    private fun neuLaden() {
        stand = stand.copy(geladen = false)
        laden()
    }

    /** Abmelden: Automatik aus und alles vergessen, das naechste Konto laedt neu. */
    fun abmelden() {
        ladeJob?.cancel()
        ladeJob = null
        stand = AnkunftStand()
        automatikPruefen()
        ziel = emptyMap()
        abholung = emptyMap()
        orte = emptyList()
    }

    /** Sofort lokal setzen und speichern (ankunftSetzen). Bei Fehler zurueck auf den alten Stand. */
    fun setzen(aenderung: (AnkunftStand) -> AnkunftStand) {
        val vorher = stand
        stand = aenderung(stand).copy(fehler = false)
        if (!stand.an) { ziel = emptyMap(); abholung = emptyMap() }
        automatikPruefen()
        val s = stand
        scope.launch {
            val uid = nutzerId() ?: return@launch
            val zeile = buildJsonObject {
                put("user_id", uid)
                put("an", s.an)
                put("automatisch", s.automatisch)
                put("ort_id", s.ortId)
                put("ort_name", s.ortName.ifEmpty { null })
                put("lat", s.lat)
                put("lng", s.lng)
                put("umkreis_m", s.umkreisM)
                put("minuten", s.minuten)
                put("bei_ankunft", s.beiAnkunft)
            }
            val ok = try {
                Backend.client.from("dispo_ankunft_melden").upsert(listOf(zeile)) { onConflict = "user_id" }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                false
            }
            if (!ok) {
                stand = vorher.copy(fehler = true)
                automatikPruefen()
                return@launch
            }
            if (stand.an) listeLaden()
        }
    }

    /** Ort fuer die Automatik: gespeicherter Ort im Umkreis (der naechste), sonst der eigene Standort. */
    fun automatikZiel(lat: Double, lng: Double, umkreisM: Int = stand.umkreisM): AutomatikZiel {
        val bester = orte.map { it to abstandM(lat, lng, it.lat, it.lng) }
            .filter { it.second <= umkreisM }
            .minByOrNull { it.second }?.first
        return if (bester != null) AutomatikZiel(bester.id, bester.name, bester.lat, bester.lng)
        else AutomatikZiel(null, "", lat, lng)
    }

    /** "Mein Standort" in Alle Fahrten (ortHier, 17.11.): Name des gespeicherten Orts, in dem ich gerade
     *  stehe (Umkreis wie Automatik), sonst null. Orte vorher laden. */
    suspend fun ortHier(ctx: Context): String? {
        laden()
        ladeJob?.join()
        val pos = EigenerStandort.stand?.let { it.latitude to it.longitude } ?: ankunftStandortHolen(ctx) ?: return null
        val z = automatikZiel(pos.first, pos.second)
        return if (z.ortId != null) z.ortName else null
    }

    /** Neuer eigener Standort: Ort nachfuehren, nur bei Ortswechsel oder mehr als 100 m Bewegung speichern. */
    private fun positionNeu(lat: Double, lng: Double) {
        val s = stand
        if (!s.vorhanden || !s.an || !s.automatisch) return
        val z = automatikZiel(lat, lng)
        val gleicherOrt = z.ortId != null && z.ortId == s.ortId
        val kaumBewegt = z.ortId == null && s.ortId == null && s.lat != null && s.lng != null &&
            abstandM(z.lat, z.lng, s.lat, s.lng) < NACHFUEHREN_M
        if (gleicherOrt || kaumBewegt) return
        ortNachfuehren(z)
    }

    /** Nur die Orts-Felder schreiben und nur, wenn auf dem Server Schalter und Automatik noch an sind.
     *  Sonst wuerde ein Geraet mit altem Stand eine Aenderung von einem anderen Geraet ueberschreiben (17.11.). */
    private fun ortNachfuehren(z: AutomatikZiel) {
        scope.launch {
            val uid = nutzerId() ?: return@launch
            val patch = buildJsonObject {
                put("ort_id", z.ortId)
                put("ort_name", z.ortName.ifEmpty { null })
                put("lat", z.lat)
                put("lng", z.lng)
            }
            val treffer = try {
                Backend.client.from("dispo_ankunft_melden").update(patch) {
                    select(Columns.list("user_id"))
                    filter {
                        eq("user_id", uid)
                        eq("an", true)
                        eq("automatisch", true)
                    }
                }.decodeList<JsonObject>()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch
            }
            if (treffer.isEmpty()) {
                // Woanders aus- oder umgestellt: Stand neu vom Server holen.
                neuLaden()
                return@launch
            }
            stand = stand.copy(ortId = z.ortId, ortName = z.ortName, lat = z.lat, lng = z.lng)
            if (stand.an) listeLaden()
        }
    }

    // Solange Schalter an und Automatik gewaehlt: eigenen Standort verfolgen (laeuft app-weit, nicht nur im Filter).
    private var automatikAbo: (() -> Unit)? = null
    private fun automatikPruefen() {
        val soll = stand.vorhanden && stand.an && stand.automatisch
        if (soll && automatikAbo == null) {
            automatikAbo = EigenerStandort.abonnieren { positionNeu(it.latitude, it.longitude) }
        }
        if (!soll && automatikAbo != null) {
            automatikAbo?.invoke()
            automatikAbo = null
        }
    }

    /** rpc ankunft_bei_mir: Fahrten zu meinem Ort mit Restzeit. Bei Fehler bleibt die alte Liste. */
    suspend fun listeLaden() {
        if (!stand.an) return
        val zeilen = try {
            Backend.client.postgrest.rpc("ankunft_bei_mir").decodeList<JsonObject>()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return
        }
        val neuZiel = mutableMapOf<String, AnkunftEintrag>()
        val neuAbholung = mutableMapOf<String, AnkunftEintrag>()
        for (z in zeilen) {
            val art = if (W.t(z["art"]) == "abholung") "abholung" else "ziel"
            val e = AnkunftEintrag(
                art = art,
                restMin = W.zahl(z["rest_min"])?.toInt(),
                geschaetzt = W.bool(z["geschaetzt"]),
                angekommen = W.bool(z["angekommen"]),
            )
            (if (art == "abholung") neuAbholung else neuZiel)[W.t(z["job_id"]).lowercase()] = e
        }
        ziel = neuZiel
        abholung = neuAbholung
    }

    /** Eintrag einer Fahrt. arten: welche Listen zaehlen (Ankuenfte beide, Abfahrten nur Abholung). */
    fun eintrag(id: String, arten: List<String> = BEIDE): AnkunftEintrag? {
        val schluessel = id.trim().lowercase()
        for (art in arten) {
            val e = (if (art == "abholung") abholung else ziel)[schluessel]
            if (e != null) return e
        }
        return null
    }

    /** Reihenfolge mit Schalter: erst unterwegs nach Restzeit, dann geplante, zuletzt angekommene. */
    fun rang(e: AnkunftEintrag?): Int = when {
        e == null -> 3
        e.angekommen -> 2
        e.restMin == null -> 1
        else -> 0
    }

    /** Anzeige der Restzeit: "da", "5 min", "ca. 5 min" oder leer. */
    fun restText(e: AnkunftEintrag?): String {
        if (e == null) return ""
        if (e.angekommen) return T_DA
        val rest = e.restMin ?: return ""
        return "${if (e.geschaetzt) "ca. " else ""}${maxOf(1, rest)} min"
    }
}

/** Standort des Geraets einmal holen (standortHolen). null ohne Erlaubnis oder ohne Position. */
@SuppressLint("MissingPermission")
internal suspend fun ankunftStandortHolen(ctx: Context): Pair<Double, Double>? {
    if (!standortErlaubt(ctx)) return null
    return try {
        val dienst = LocationServices.getFusedLocationProviderClient(ctx)
        val anfrage = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(60_000)
            .setDurationMillis(15_000)
            .build()
        val pos = withTimeoutOrNull(16_000) { dienst.getCurrentLocation(anfrage, null).await() }
            ?: dienst.lastLocation.await()?.takeIf { System.currentTimeMillis() - it.time <= 60_000 }
        pos?.let { it.latitude to it.longitude }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}

private fun standortErlaubt(ctx: Context) = EigenerStandort.erlaubt(ctx)

// MARK: - Fahrten Filter (AnkunftAbschnitt in FahrtenFilter.jsx)

/**
 * Schalter, darunter Ort und Melden, nur wenn eingeschaltet. Liegt absolut im Filter-Raster ab [oben].
 * Ort zuerst "Automatisch" (gespeicherter Ort, an dem ich bin, sonst mein Standort), sonst ein fester Ort.
 * Gespeichert sofort auf dem Server, unabhaengig von "Filter speichern".
 * Keine Hinweiszeile, ein Fehler steht rot im Ort-Feld.
 */
@Composable
internal fun AnkunftAbschnitt(oben: Float, schritt: Float, schalter: @Composable (String, Boolean, Modifier, () -> Unit) -> Unit) {
    val a = AnkunftMelden.stand
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var hole by remember { mutableStateOf(false) }
    var ohneStandort by remember { mutableStateOf(false) }

    // automatikStarten: Standort einmal holen, Ort danach waehlen. Ohne Standort trotzdem an und automatisch.
    suspend fun nachErlaubnis() {
        EigenerStandort.pruefen()
        val pos = ankunftStandortHolen(ctx)
        hole = false
        if (pos == null) {
            ohneStandort = true
            AnkunftMelden.setzen { it.copy(an = true, automatisch = true) }
            return
        }
        val z = AnkunftMelden.automatikZiel(pos.first, pos.second)
        AnkunftMelden.setzen {
            it.copy(an = true, automatisch = true, ortId = z.ortId, ortName = z.ortName, lat = z.lat, lng = z.lng)
        }
    }
    val erlaubnis = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        scope.launch { nachErlaubnis() }
    }
    fun automatikStarten() {
        hole = true
        ohneStandort = false
        if (standortErlaubt(ctx)) scope.launch { nachErlaubnis() }
        else erlaubnis.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    fun schalten() {
        when {
            a.an -> AnkunftMelden.setzen { it.copy(an = false) }
            a.automatisch || a.lat == null || a.lng == null -> automatikStarten()
            else -> AnkunftMelden.setzen { it.copy(an = true) }
        }
    }
    fun ortWaehlen(wert: String) {
        if (wert == "__auto") { automatikStarten(); return }
        val ort = AnkunftMelden.orte.firstOrNull { it.id == wert } ?: return
        ohneStandort = false
        AnkunftMelden.setzen { it.copy(automatisch = false, ortId = ort.id, ortName = ort.name, lat = ort.lat, lng = ort.lng) }
    }

    schalter(AnkunftMelden.T_SCHALTER, a.an, Modifier.platz(20f, oben, 362f, 56f)) { schalten() }
    if (!a.an) return

    val fehler = when {
        a.fehler -> AnkunftMelden.T_FEHLER
        ohneStandort -> AnkunftMelden.T_STANDORT_FEHLT
        else -> ""
    }
    val ortWert = if (hole) AnkunftMelden.T_STANDORT_LAEDT
    else a.ortName.ifEmpty { if (a.lat != null) AnkunftMelden.T_MEIN_STANDORT else "–" }
    val ortNach = if (!hole && a.automatisch && a.ortId != null) "(${AnkunftMelden.T_HIER})" else null
    AuswahlZeile(
        AnkunftMelden.T_ORT, fehler.ifEmpty { ortWert }, if (fehler.isEmpty()) ortNach else null, "Pin_Nav_Trisar_Icons_01_Lime",
        listOf("__auto" to AnkunftMelden.T_AUTOMATISCH) + AnkunftMelden.orte.map { it.id to it.name },
        ::ortWaehlen, Modifier.platz(20f, oben + schritt, 362f, 56f), rot = fehler.isNotEmpty(),
    )
    AuswahlZeile(
        AnkunftMelden.T_MELDEN, AnkunftMelden.minutenText(a.minuten), if (a.minuten == 0) null else AnkunftMelden.T_VOR_ANKUNFT,
        "clock-green",
        AnkunftMelden.MINUTEN_AUSWAHL.map { it.toString() to AnkunftMelden.minutenText(it) },
        { wert -> wert.toIntOrNull()?.let { m -> AnkunftMelden.setzen { it.copy(minuten = m) } } },
        Modifier.platz(20f, oben + schritt * 2, 362f, 56f),
    )
}

/** Hoehe des Abschnitts (ankunftHoehe): Schalter allein oder mit Ort und Melden. 24 px Abstand davor. */
internal fun ankunftHoehe(vorhanden: Boolean, an: Boolean, schritt: Float): Float {
    if (!vorhanden) return 0f
    return 12f + (if (an) schritt * 3 else schritt)
}

/** Auswahlfeld im Look der Eingabezeilen: Label blass, Wert hell, Icon rechts. Tippen oeffnet die Auswahl. */
@Composable
private fun AuswahlZeile(
    titel: String, wert: String, nach: String?, icon: String,
    optionen: List<Pair<String, String>>, waehlen: (String) -> Unit, modifier: Modifier, rot: Boolean = false,
) {
    var offen by remember { mutableStateOf(false) }
    Box(modifier.border(2.dp, LIME).tippen { offen = true }) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(titel, style = css(16f, 500, 24f, 0.5f, LIME.copy(alpha = 0.5f)), maxLines = 1)
            Text(
                buildAnnotatedString {
                    append(wert)
                    if (nach != null) withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append(" $nach") }
                },
                style = css(16f, 500, 24f, 0.5f, if (rot) hex(0xFF6F63) else LIME), maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(icon, Modifier.size(20.dp))
        }
        DropdownMenu(offen, { offen = false }, Modifier.background(hex(0x1E1E1E))) {
            for ((schluessel, text) in optionen) {
                DropdownMenuItem(
                    text = { Text(text, style = grotesk(16f, farbe = Color.White)) },
                    onClick = { offen = false; waehlen(schluessel) },
                )
            }
        }
    }
}

// MARK: - Listen (AnkunftPlakette.jsx, "Nur zu mir"-Zeile)

/** Restzeit an der Fahrtkarte, z. B. "5 min", "ca. 5 min" oder "da". Bei Abholung zusaetzlich "holt ab". */
@Composable
internal fun AnkunftPlakette(eintrag: AnkunftEintrag?, textFarbe: Color) {
    val text = AnkunftMelden.restText(eintrag)
    if (text.isEmpty()) return
    Column(Modifier.padding(top = 4.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text, style = css(13f, 700, 20f, farbe = LIME), maxLines = 1, softWrap = false,
            modifier = Modifier.background(Color.Black).padding(horizontal = 6.dp, vertical = 1.dp),
        )
        if (eintrag?.art == "abholung") {
            Text("holt ab", style = css(11f, 500, 16f, farbe = textFarbe.copy(alpha = 0.6f)))
        }
    }
}
