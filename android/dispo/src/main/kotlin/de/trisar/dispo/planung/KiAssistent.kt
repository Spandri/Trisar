package de.trisar.dispo.planung

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.FahrerMarkierung
import de.trisar.dispo.MarkierungsVermerk
import de.trisar.dispo.Navileiste
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.LocalTime
import io.github.jan.supabase.functions.functions
import io.ktor.client.plugins.timeout
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import androidx.activity.compose.BackHandler
import de.trisar.dispo.fahrten.FahrtEingabe
import de.trisar.dispo.fahrten.FahrtFormularSeite
import de.trisar.dispo.fahrten.FahrtFormularWerte
import de.trisar.dispo.fahrten.FahrtSpeichern
import de.trisar.dispo.fahrten.FahrtText
import de.trisar.dispo.fahrten.FahrtVorlage
import de.trisar.dispo.fahrten.GeladeneFahrt
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.JsonArray
import de.trisar.dispo.standby.DispoStandbySpeicher
import de.trisar.dispo.standby.StandbyNeuSeite
import de.trisar.dispo.standby.StandbyVorlage

// KI-Assistent (KiAssistentAnsicht.swift, KiAssistentDienst.swift, KiAssistentView.jsx): Chat mit dem Assistenten,
// Verlauf unter demselben Schluessel wie localStorage im Web, Kopieren/Bearbeiten an den Nachrichten,
// Buchungs-Vorschau und Neuplanungs-Link (beides kommt live derzeit nicht vor).

/** Fragt dispo-admin (aktion ki_frage), wie das Web. Das Modell laeuft auf dem Server-Weg im Tailnet. */
internal object KiAssistentDienst {
    class Antwort(
        val text: String, val buchungsVorschlag: KiBuchungsVorschlag? = null, val dienstVorschlag: KiDienstVorschlag? = null,
        /** Weitere Karten nach der ersten Fahrt: Fahrten und Standbys (aktionen neuer Server). */
        val karten: List<KiKarte> = emptyList(),
        /** Ort unsicher (18.11.): Auswahl zum Antippen statt Fahrtkarte (dispo-admin/ortWahl.ts). */
        val ortWahl: KiOrtWahl? = null,
    )

    /** Standby aus einer Karte direkt anlegen (standbyAnlegen im Web). Liefert die ID. */
    suspend fun standbyAnlegen(sb: StandbyVorlage): String {
        val eigener = sb.ortId.ifBlank { null }?.let { de.trisar.kern.EigeneOrte.einmalLaden(); de.trisar.kern.EigeneOrte.zuID(it) }
        val lat = sb.lat ?: eigener?.lat ?: throw IllegalStateException("Ort ohne Koordinaten")
        val lng = sb.lng ?: eigener?.lng ?: throw IllegalStateException("Ort ohne Koordinaten")
        val ort = DispoStandbySpeicher.OrtWahl(
            sb.ortId.ifBlank { null }, sb.ortName.ifBlank { eigener?.name ?: sb.adresse },
            sb.adresse.ifBlank { eigener?.adresse }?.ifBlank { null }, lat, lng, sb.radiusRein ?: 150, sb.radiusRaus ?: 300,
        )
        return DispoStandbySpeicher.anlegen(sb.datum, sb.von, sb.bis, ort, sb.notiz.trim(), sb.fahrerIds.distinct()).getOrThrow()
    }

    /** Dienststart oder Dienstende fuer markierte Fahrer senden (Vorschlag des Assistenten bestaetigt). Liefert die Anzahl. */
    suspend fun dienstSenden(v: KiDienstVorschlag): Int {
        val koerper = buildJsonObject {
            put("aktion", "dienst_senden")
            put("art", v.art)
            put("zeit", v.zeit)
            put("datum", v.datum)
            put("start", v.startWirksam?.let { JsonPrimitive(it) } ?: JsonNull)
            put("ende", v.endeWirksam?.let { JsonPrimitive(it) } ?: JsonNull)
            putJsonArray("pausen") { v.pausen.forEach { p -> addJsonObject { put("von", p.von); put("bis", p.bis) } } }
            putJsonArray("fahrerIds") { v.fahrer.forEach { add(JsonPrimitive(it.id)) } }
        }
        val text = Backend.client.functions.invoke("dispo-admin") {
            contentType(ContentType.Application.Json)
            setBody(koerper.toString())
        }.bodyAsText()
        val antwort = Backend.json.parseToJsonElement(text).jsonObject
        val ok = (antwort["ok"] as? JsonPrimitive)?.content == "true"
        if (!ok) throw IllegalStateException((antwort["error"] as? JsonPrimitive)?.content?.ifEmpty { null } ?: "Senden fehlgeschlagen")
        return (antwort["anzahl"] as? JsonPrimitive)?.content?.toIntOrNull() ?: v.fahrer.size
    }

    /** Karte "Neuer Fahrer" / "Neues Fahrzeug" bestaetigt (kiAnlegen im Web): der Server prueft und legt an (anlegen.ts). */
    suspend fun anlegen(art: String, daten: Map<String, String>): Pair<Boolean, String> {
        val koerper = buildJsonObject {
            put("aktion", "ki_anlegen")
            put("art", art)
            put("daten", buildJsonObject { daten.forEach { (k, w) -> if (k != "fehler") put(k, w) } })
        }
        val text = Backend.client.functions.invoke("dispo-admin") {
            contentType(ContentType.Application.Json)
            setBody(koerper.toString())
        }.bodyAsText()
        val antwort = Backend.json.parseToJsonElement(text).jsonObject
        val ok = (antwort["ok"] as? JsonPrimitive)?.content == "true"
        val meldung = (antwort["text"] as? JsonPrimitive)?.content?.ifEmpty { null }
            ?: (antwort["error"] as? JsonPrimitive)?.content?.ifEmpty { null }
            ?: if (ok) "" else "Nicht angelegt."
        return ok to meldung
    }

    /** Felder einer Anlegen-Karte als Text (Server liefert Strings, Zahlen werden tolerant uebernommen). */
    private fun anlegenDaten(e: JsonElement?): Map<String, String>? {
        val o = e as? JsonObject ?: return null
        return o.mapNotNull { (k, w) -> (w as? JsonPrimitive)?.takeUnless { it is JsonNull }?.let { k to it.content } }.toMap()
    }

    /** cachedSnapshotAt im Web. Live wird der Snapshot nie geladen, der Cache bleibt aber wie dort. */
    private var snapshotZeit: Long? = null

    fun cacheVerwerfen() { snapshotZeit = null }

    /** onCreateRide(payload, { aiBooked: true }) */
    suspend fun buchen(v: KiBuchungsVorschlag): String? {
        // Eigener Ort im Vorschlag: Adresse kommt beim Speichern aus EigeneOrte.
        if (v.startOrtId.isNotBlank() || v.zielOrtId.isNotBlank()) de.trisar.kern.EigeneOrte.einmalLaden()
        val fahrtID = v.fahrtId
        if (fahrtID != null) {
            val g = FahrtSpeichern.laden(fahrtID)
            val neu = v.aenderung(g)
            val w = neu.werte.let { it.copy(anonymeGaeste = it.anonymeGaeste.ifEmpty { "0" }) }
            val e = FahrtSpeichern.aendern(
                FahrtEingabe(
                    w, FahrtText.gaesteTeilen(neu.fahrgaeste).joinToString("; "),
                    neu.fahrerNamen.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }, "", "", neu.notiz, g.zwischenstopps,
                    flugOhnePruefung = v.flugUnbestaetigt,
                ),
                g,
            )
            if (!e.ok) throw IllegalStateException(e.fehler ?: "Unbekannter Fehler")
            return fahrtID
        }
        val w = v.vorlage.werte.let { it.copy(anonymeGaeste = it.anonymeGaeste.ifEmpty { "0" }) }
        val e = FahrtSpeichern.anlegen(
            FahrtEingabe(w, FahrtText.gaesteTeilen(v.fahrgaeste).joinToString("; "), v.fahrerNamen, "", "", v.notes, aiBooked = true,
                flugOhnePruefung = v.flugUnbestaetigt),
        )
        if (!e.ok) throw IllegalStateException(e.fehler ?: "Unbekannter Fehler")
        return e.id
    }

    /** Letzte Fahrer und Fahrten des Gespraechs, fuer Rueckfragen. */
    private var kontext: JsonElement? = null

    suspend fun fragen(
        prompt: String, verlauf: List<Pair<String, String>>,
        offenerVorschlag: KiBuchungsVorschlag? = null, letzteFahrtId: String? = null,
        /** Auf der Karte markierte Fahrer: "schick die alle in Feierabend" meint sie. */
        markierteFahrer: List<FahrerMarkierung.Eintrag> = emptyList(),
    ): Antwort {
        val frage = prompt.trim()
        if (frage.isEmpty()) return Antwort("Bitte stelle eine Frage.")
        val koerper = buildJsonObject {
            put("aktion", "ki_frage")
            put("frage", frage)
            putJsonArray("verlauf") {
                verlauf.forEach { (rolle, text) -> addJsonObject { put("role", rolle); put("text", text) } }
            }
            kontext?.let { put("kontext", it) }
            offenerVorschlag?.let { put("offenerVorschlag", Backend.json.encodeToJsonElement(KiBuchungsVorschlag.serializer(), it)) }
            letzteFahrtId?.let { put("letzteFahrtId", it) }
            putJsonArray("markierteFahrer") { markierteFahrer.forEach { f -> addJsonObject { put("id", f.id); put("name", f.name) } } }
            // Mehrere Vorschlaege als Karten (aktionen), wie das Web.
            put("karten", true)
            // Diese App speichert den Start Zeitraum eines Vorschlags (startZeitBis) an der Fahrt.
            put("zeitraum", true)
            // Umschalter Regeln/Frei: bei "frei" beantwortet das Modell reine Fragen selbst.
            put("modus", KiModus.modus)
        }
        // Eigene Zeitgrenze: das Modell braucht bis zu 52 s, Standard im Client sind 10 s.
        val text = Backend.client.functions.invoke("dispo-admin") {
            contentType(ContentType.Application.Json)
            setBody(koerper.toString())
            timeout { requestTimeoutMillis = 60_000; socketTimeoutMillis = 60_000 }
        }.bodyAsText()
        val antwort = Backend.json.parseToJsonElement(text).jsonObject
        antwort["kontext"]?.takeUnless { it is JsonNull }?.let { kontext = it }
        val aktion = antwort["action"] as? JsonObject
        // Neue Server liefern alle Vorschlaege als aktionen (Karten-Liste), aeltere nur action.
        val aktionen = (antwort["aktionen"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: listOfNotNull(aktion)
        fun art(a: JsonObject) = (a["type"] as? JsonPrimitive)?.content
        val ersteBuchung = aktionen.indexOfFirst { art(it) == "booking_proposal" }
        val vorschlag = aktionen.getOrNull(ersteBuchung)?.get("proposal")?.let { Backend.json.decodeFromJsonElement(KiBuchungsVorschlag.serializer(), it) }
        // Weitere Karten: zusaetzliche Fahrten und Standbys, jede einzeln bearbeiten und bestaetigen.
        val ms = System.currentTimeMillis()
        val karten = aktionen.mapIndexedNotNull { i, a ->
            runCatching {
                when {
                    art(a) == "booking_proposal" && i != ersteBuchung -> a["proposal"]?.let {
                        KiKarte("karte-$ms-$i", "fahrt", proposal = Backend.json.decodeFromJsonElement(KiBuchungsVorschlag.serializer(), it))
                    }
                    art(a) == "standby_proposal" -> a["standby"]?.let {
                        KiKarte("karte-$ms-$i", "standby", standby = Backend.json.decodeFromJsonElement(StandbyVorlage.serializer(), it))
                    }
                    art(a) == "fahrer_proposal" -> anlegenDaten(a["fahrer"])?.let { KiKarte("karte-$ms-$i", "fahrer", daten = it) }
                    art(a) == "fahrzeug_proposal" -> anlegenDaten(a["fahrzeug"])?.let { KiKarte("karte-$ms-$i", "fahrzeug", daten = it) }
                    else -> null
                }
            }.getOrNull()
        }
        val dienst = if ((aktion?.get("type") as? JsonPrimitive)?.content == "dienst_vorschlag") {
            aktion["vorschlag"]?.let { runCatching { Backend.json.decodeFromJsonElement(KiDienstVorschlag.serializer(), it) }.getOrNull() }
        } else null
        val ortWahl = aktionen.firstOrNull { art(it) == "ort_auswahl" }?.let {
            runCatching { Backend.json.decodeFromJsonElement(KiOrtWahl.serializer(), it) }.getOrNull()
        }
        return Antwort((antwort["answer"] as? JsonPrimitive)?.content.orEmpty(), vorschlag, dienst, karten, ortWahl)
    }
}

/** Ein Ort zur Auswahl: wert geht als Nachricht an den Server, titel und zeile stehen auf der Kachel. */
@Serializable
internal data class KiOrtOption(val wert: String = "", val titel: String = "", val zeile: String = "")

/** Ortsauswahl: "Welchen Start meinst du?" mit bis zu 3 Orten, ohne Orte heisst nicht gefunden. */
@Serializable
internal data class KiOrtWahl(val feld: String = "", val frage: String = "", val optionen: List<KiOrtOption> = emptyList())

/** Dienststart/Dienstende fuer markierte Fahrer (action dienst_vorschlag von dispo-admin). */
@Serializable
internal data class KiDienstVorschlag(
    /** start, ende oder dienst */
    val art: String = "ende", val zeit: String = "", val datum: String = "",
    val start: String? = null, val ende: String? = null,
    val pausen: List<KiDienstPause> = emptyList(),
    val fahrer: List<KiDienstFahrer> = emptyList(),
    /** Mit Ausnahme ("alle außer Tim") zaehlt im Voice-Modus nur der Knopf (15.11.). */
    val nurKnopf: Boolean = false,
) {
    /** Ohne start/ende vom Server: aus art und zeit (aeltere Antworten). */
    val startWirksam: String? get() = start?.ifEmpty { null } ?: zeit.takeIf { art == "start" && it.isNotEmpty() }
    val endeWirksam: String? get() = ende?.ifEmpty { null } ?: zeit.takeIf { art == "ende" && it.isNotEmpty() }

    /** dienstKnopfText im Web. */
    val knopfText: String get() {
        val s = startWirksam; val e = endeWirksam; val p = pausen.isNotEmpty()
        return when {
            e != null && s == null && !p -> "Dienstende senden"
            s != null && e == null && !p -> "Dienststart senden"
            s == null && e == null && p -> "Pause senden"
            else -> "Dienst senden"
        }
    }
}

@Serializable
internal data class KiDienstPause(val von: String = "", val bis: String = "")

@Serializable
internal data class KiDienstFahrer(val id: String = "", val name: String = "")

/** Buchungs-Vorschau (toCreateRidePayload in KiAssistentView.jsx). */
@Serializable
internal data class KiBuchungsVorschlag(
    val datum: String = "", val startZeit: String = "", val start: String = "", val ziel: String = "",
    val fahrgaeste: String = "", val anonymeGaeste: String = "0", val fahrerNamen: List<String> = emptyList(),
    val konvoi: String = "", val flugnummer: String = "", val notes: String = "",
    /** Nur bei Aenderung einer bestehenden Fahrt: welche Fahrt und welche Felder. */
    val fahrtId: String? = null, val geaendert: List<String> = emptyList(),
    /** Flug vom Server nicht bestaetigt (dispo-admin/flugKi.ts): buchen speichert trotzdem. */
    val flugUnbestaetigt: Boolean = false,
    /** Eigener Ort, vom Server erkannt (dispo-admin/ortSuche.ts): gespeichert wie bei Auswahl im Formular. */
    val startOrtId: String = "", val startAdresse: String = "", val zielOrtId: String = "", val zielAdresse: String = "",
    /** Start Zeitraum ("zwischen 15 und 16 Uhr"): Ende des Zeitraums, wird als etd_bis gespeichert. */
    val startZeitBis: String = "",
) {
    /** Nur die geaenderten Felder uebernehmen, alles andere bleibt wie an der Fahrt. */
    fun aenderung(g: GeladeneFahrt): FahrtVorlage {
        var w = g.werte
        if ("datum" in geaendert) w = w.copy(datum = datum)
        if ("startZeit" in geaendert) w = w.copy(startZeit = startZeit)
        if ("start" in geaendert) w = w.copy(start = start, startOrtID = startOrtId)
        if ("ziel" in geaendert) w = w.copy(ziel = ziel, zielOrtID = zielOrtId)
        return FahrtVorlage(
            w, if ("fahrerNamen" in geaendert) fahrerNamen else g.fahrerNamen,
            if ("fahrgaeste" in geaendert) fahrgaeste else g.fahrgaeste, g.notiz,
        )
    }

    /** Startwerte fuer das Fahrtformular (toCreateRidePayload). */
    val vorlage: FahrtVorlage get() = FahrtVorlage(
        FahrtFormularWerte(
            datum = datum, startZeit = startZeit, startZeitBis = startZeitBis, start = start, ziel = ziel, startOrtID = startOrtId, zielOrtID = zielOrtId,
            flugnummer = flugnummer, konvoi = konvoi,
            anonymeGaeste = if (anonymeGaeste == "0") "" else anonymeGaeste, aktuellerStatus = "offen",
        ),
        fahrerNamen, fahrgaeste, notes,
    )

    /** hasMinimumBookingData */
    val hatPflichtfelder: Boolean get() = start.isNotBlank() && ziel.isNotBlank() && startZeit.isNotBlank()
}

/** Weitere Karte einer Antwort (karten im Web): Fahrt oder Standby mit eigenem Status pending, saving, booked, cancelled. */
@Serializable
internal data class KiKarte(
    val id: String,
    /** fahrt, standby, fahrer oder fahrzeug */
    val art: String,
    val proposal: KiBuchungsVorschlag? = null,
    val standby: StandbyVorlage? = null,
    val status: String = "pending",
    val rideId: String? = null,
    /** Felder von Neuer Fahrer / Neues Fahrzeug (dispo-admin/anlegen.ts), dazu fehler. */
    val daten: Map<String, String>? = null,
    /** Felder zum Bearbeiten aufgeklappt. */
    val offen: Boolean = false,
)

/** ANLEGEN_FELDER im Web: Feld und Beschriftung der Anlegen-Karten. */
private val anlegenFelder = mapOf(
    "fahrer" to listOf("vor" to "Vorname", "nach" to "Nachname", "benutzername" to "Benutzername", "nummer" to "Fahrernummer", "telefon" to "Telefon", "email" to "E-Mail"),
    "fahrzeug" to listOf("modell" to "Marke und Modell", "kennzeichen" to "Kennzeichen", "sitze" to "Sitze", "farbe" to "Farbe", "kraftstoff" to "Kraftstoff", "ausstattung" to "Art"),
)

/** Fahrt- oder Standby-Formular, das gerade aus einer Nachricht (und ggf. einer weiteren Karte) offen ist. */
private data class KiFormular(val nachricht: String, val vorschlag: KiBuchungsVorschlag? = null, val standby: StandbyVorlage? = null, val karteId: String? = null)

/** Eine Chat-Nachricht mit denselben Feldnamen wie im Web (JSON in localStorage). */
@Serializable
internal data class KiNachricht(
    val id: String,
    val role: String,
    val text: String,
    val time: String,
    val pending: Boolean? = null,
    val bookingProposal: KiBuchungsVorschlag? = null,
    val bookingStatus: String? = null,
    val bookingRideId: String? = null,
    val stoerungTag: String? = null,
    val dienstVorschlag: KiDienstVorschlag? = null,
    /** offen, sendet, gesendet, verworfen */
    val dienstStatus: String? = null,
    val dienstAnzahl: Int? = null,
    val dienstFehler: String? = null,
    val karten: List<KiKarte> = emptyList(),
    /** Ortsauswahl (18.11.): offen, bis eine neuere Antwort kommt, dann erledigt. */
    val ortWahl: KiOrtWahl? = null,
    val ortWahlStatus: String? = null,
) {
    companion object {
        fun uhrzeit(): String = LocalTime.now().let { zwei(it.hour) + ":" + zwei(it.minute) }
    }
}

/** CHAT_STORAGE_KEY + restoreStoredMessages (ohne den Demo-Abgleich mit demoStore.jobs). */
internal object KiVerlaufSpeicher {
    private const val SCHLUESSEL = "koordinator_ki_chat_messages_v2"
    private val alteSchluessel = listOf("koordinator_ki_chat_messages_v1")
    private val serializer = ListSerializer(KiNachricht.serializer())

    val standard get() = listOf(KiNachricht("init", "assistant", "Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?", "17:13"))

    fun laden(): List<KiNachricht> {
        alteSchluessel.forEach { PlanAblage.entfernen(it) }
        val liste = PlanAblage.text(SCHLUESSEL)?.let { runCatching { planJson.decodeFromString(serializer, it) }.getOrNull() }
        if (liste.isNullOrEmpty()) return standard
        val bereinigt = liste.filter { it.pending != true && !it.text.contains("Online-Demo deaktiviert", ignoreCase = true) }
            .map { if (it.bookingStatus == "saving") it.copy(bookingStatus = "pending") else it }
            .map { if (it.dienstStatus == "sendet") it.copy(dienstStatus = "offen") else it }
            .map { n -> if (n.karten.any { it.status == "saving" }) n.copy(karten = n.karten.map { if (it.status == "saving") it.copy(status = "pending") else it }) else n }
        if (bereinigt.isEmpty() || (bereinigt.size == 1 && bereinigt[0].id == "init")) return standard
        return bereinigt
    }

    fun sichern(liste: List<KiNachricht>) = PlanAblage.setzen(SCHLUESSEL, planJson.encodeToString(serializer, liste))
}

/** Realtime-Kanal aus KiAssistentView.jsx: jede Aenderung an den neun Tabellen verwirft den Cache. */
internal class KiAssistentLive {
    private var kanal: RealtimeChannel? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tabellen = listOf("jobs", "profiles", "vehicles", "guests", "job_guests", "job_notes", "convoy_assignments", "convoys", "driver_live_locations")

    fun starten() {
        if (kanal != null) return
        val k = Backend.client.channel("admin-ki-live-${System.currentTimeMillis()}")
        kanal = k
        val stroeme = tabellen.map { t -> k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t } }
        stroeme.forEach { s -> scope.launch { s.collect { KiAssistentDienst.cacheVerwerfen() } } }
        scope.launch { runCatching { k.subscribe() } }
    }

    fun beenden() {
        scope.cancel()
        val k = kanal ?: return
        kanal = null
        planLauf.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }
}

private val kiLime = hex(0xE3F654)

/** mitKlickbarenNummern: Telefonnummern werden zu tel:-Links (Lime, unterstrichen). */
private fun mitTelefonLinks(roh: String): AnnotatedString = buildAnnotatedString {
    var pos = 0
    for (t in Regex("""(\+?\d[\d ()/-]{6,}\d)""").findAll(roh)) {
        if (t.range.first > pos) append(roh.substring(pos, t.range.first))
        val ziffern = t.value.filter { it.isDigit() || it == '+' }
        pushStringAnnotation("tel", ziffern)
        withStyle(SpanStyle(color = kiLime, textDecoration = TextDecoration.Underline)) { append(t.value) }
        pop()
        pos = t.range.last + 1
    }
    if (pos < roh.length) append(roh.substring(pos))
}

/** Nachbau von KiAssistentView.jsx (view 'kiAssistent'). */
@Composable
internal fun KiAssistentAnsicht(
    zeigen: (DispoZiel) -> Unit,
    oeffneFahrt: (String) -> Unit,
    zurueck: (() -> Unit)? = null,
    oeffneNeuplanung: (String) -> Unit = {},
    /** onCreateRide(payload, { aiBooked: true }): liefert die ID der neuen Fahrt. null = nicht verbunden (wie iOS). */
    fahrtBuchen: (suspend (KiBuchungsVorschlag) -> String?)? = KiAssistentDienst::buchen,
) {
    var nachrichten by remember { mutableStateOf(KiVerlaufSpeicher.laden()) }
    var eingabe by remember { mutableStateOf("") }
    var bearbeiteteID by remember { mutableStateOf<String?>(null) }
    var kopierteID by remember { mutableStateOf<String?>(null) }
    var sendet by remember { mutableStateOf(false) }
    /** Sofortige Sperre, damit nie zwei Anfragen gleichzeitig laufen (sendetRef im Web). */
    val sperre = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    /** Vorschlag, der gerade im Fahrtformular angepasst wird (Nachricht und Vorschlag). */
    var formular by remember { mutableStateOf<KiFormular?>(null) }
    var fokussiert by remember { mutableStateOf(false) }
    var sprachModus by remember { mutableStateOf(false) }
    // Abbrechen-Knopf beim Bearbeiten: waehrend er aus dem Senden-Knopf heraus- oder in ihn
    // zurueckwaechst (860 ms), bleibt der Senden-Knopf stehen statt des Sprechen-Knopfs.
    var imWandel by remember { mutableStateOf(false) }
    var bearbeitetVorher by remember { mutableStateOf(false) }
    val fokus = remember { FocusRequester() }
    val fokusVerwalter = LocalFocusManager.current
    val ablage = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val live = remember { KiAssistentLive() }
    val liste = rememberLazyListState()
    val ctx = LocalContext.current

    DisposableEffect(Unit) {
        live.starten()
        onDispose { live.beenden() }
    }
    LaunchedEffect(nachrichten) { KiVerlaufSpeicher.sichern(nachrichten) }
    val bearbeitetJetzt = bearbeiteteID != null
    LaunchedEffect(bearbeitetJetzt) {
        if (bearbeitetJetzt == bearbeitetVorher) return@LaunchedEffect
        bearbeitetVorher = bearbeitetJetzt
        imWandel = true
        delay(860)
        imWandel = false
    }
    val letzte = nachrichten.lastOrNull()
    val signatur = letzte?.let { "${nachrichten.size}|${it.id}|${it.pending == true}|${it.text}|${it.bookingStatus ?: ""}|${it.karten.size}" } ?: ""
    LaunchedEffect(signatur, fokussiert) { if (nachrichten.isNotEmpty()) liste.animateScrollToItem(nachrichten.size) }

    fun aendern(id: String, f: (KiNachricht) -> KiNachricht) { nachrichten = nachrichten.map { if (it.id == id) f(it) else it } }
    fun hinweis(text: String, praefix: String) {
        nachrichten = nachrichten + KiNachricht("$praefix-${System.currentTimeMillis()}", "assistant", text, KiNachricht.uhrzeit())
    }

    /** vorgabe: Text aus dem Voice-Modus, sonst das Eingabefeld. Liefert die fertige Antwort (handleSend im Web). */
    fun senden(vorgabe: String? = null, stimme: Boolean = false): CompletableDeferred<KiNachricht?> {
        val fertig = CompletableDeferred<KiNachricht?>()
        val text = (vorgabe ?: eingabe).trim()
        if (text.isEmpty() || sendet || !sperre.compareAndSet(false, true)) { fertig.complete(null); return fertig }
        val jetzt = KiNachricht.uhrzeit()
        val ms = System.currentTimeMillis()
        var quelle = nachrichten
        // Bearbeitet: die alte Frage und die direkt folgende Antwort fallen weg.
        val eid = bearbeiteteID
        val idx = eid?.let { i -> quelle.indexOfFirst { it.id == i } } ?: -1
        if (eid != null && idx >= 0) {
            val weg = mutableSetOf(eid)
            if (idx + 1 < quelle.size && quelle[idx + 1].role == "assistant") weg += quelle[idx + 1].id
            quelle = quelle.filter { it.id !in weg }
        }
        val verlauf = quelle.map { it.role to it.text }
        val offen = quelle.lastOrNull { it.bookingStatus == "pending" }?.bookingProposal
        val letzteFahrtID = quelle.lastOrNull { it.bookingRideId != null }?.bookingRideId
        val wartendID = "msg-ai-pending-${ms + 1}"
        nachrichten = quelle + listOf(
            KiNachricht("msg-user-$ms", "user", text, jetzt),
            KiNachricht(wartendID, "assistant", "", jetzt, pending = true),
        )
        bearbeiteteID = null
        eingabe = ""
        sendet = true
        scope.launch {
            val beginn = System.currentTimeMillis()
            val markierte = if (FahrerMarkierung.wirkt) FahrerMarkierung.fahrer else emptyList()
            val ergebnis = runCatching { KiAssistentDienst.fragen(text, verlauf, offen, letzteFahrtID, markierte) }
            // DENKZEIT_MS: so lange denkt der Assistent mindestens nach. Im Voice-Modus zaehlt jede Sekunde, dort ohne.
            val rest = 3000 - (System.currentTimeMillis() - beginn)
            if (rest > 0 && !stimme) delay(rest)
            if (nachrichten.none { it.id == wartendID }) { sendet = false; sperre.set(false); fertig.complete(null); return@launch }
            // Ein neuer Vorschlag loest den alten ab, damit nur einer bestaetigt werden kann.
            if (ergebnis.getOrNull()?.buchungsVorschlag != null) {
                nachrichten = nachrichten.map { if (it.id != wartendID && it.bookingStatus == "pending") it.copy(bookingStatus = "cancelled") else it }
            }
            // Jede neue Antwort beendet eine offene Ortsauswahl, angetippt wird nur die juengste.
            nachrichten = nachrichten.map { if (it.id != wartendID && it.ortWahlStatus == "offen") it.copy(ortWahlStatus = "erledigt") else it }
            aendern(wartendID) { n ->
                ergebnis.fold(
                    onSuccess = { a ->
                        n.copy(
                            text = a.text.ifEmpty { "Ich konnte dazu keine Antwort erzeugen." },
                            bookingProposal = a.buchungsVorschlag, bookingStatus = if (a.buchungsVorschlag == null) null else "pending",
                            karten = a.karten,
                            dienstVorschlag = a.dienstVorschlag, dienstStatus = if (a.dienstVorschlag == null) null else "offen",
                            ortWahl = a.ortWahl, ortWahlStatus = if (a.ortWahl == null) null else "offen",
                        )
                    },
                    onFailure = { f -> n.copy(text = "Fehler: ${f.message?.ifEmpty { null } ?: "Unbekannter KI-Fehler"}") },
                ).copy(pending = null, time = KiNachricht.uhrzeit())
            }
            sendet = false
            sperre.set(false)
            fertig.complete(nachrichten.firstOrNull { it.id == wartendID })
        }
        return fertig
    }

    fun kopieren(n: KiNachricht) {
        val wert = n.text.trim()
        if (wert.isEmpty()) return
        ablage.setText(AnnotatedString(wert))
        kopierteID = n.id
        scope.launch { delay(1200); if (kopierteID == n.id) kopierteID = null }
    }

    // Dienststart/Dienstende fuer markierte Fahrer: erst der Knopf schickt ab.
    // Liefert den Text fuer den Voice-Modus (handleDienstSenden im Web).
    suspend fun dienstSendenWarten(id: String, v: KiDienstVorschlag): String {
        aendern(id) { it.copy(dienstStatus = "sendet", dienstFehler = null) }
        return try {
            val anzahl = KiAssistentDienst.dienstSenden(v)
            aendern(id) { it.copy(dienstStatus = "gesendet", dienstAnzahl = anzahl) }
            "Gesendet."
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            val f = e.message?.ifEmpty { null } ?: "Senden fehlgeschlagen"
            aendern(id) { it.copy(dienstStatus = "offen", dienstFehler = f) }
            "Das hat nicht geklappt. $f"
        }
    }

    fun dienstSenden(id: String, v: KiDienstVorschlag) {
        scope.launch { dienstSendenWarten(id, v) }
    }

    // Weitere Karten (Fahrten und Standbys) einer Nachricht.
    fun karteSetzen(id: String, karteId: String, f: (KiKarte) -> KiKarte) {
        aendern(id) { n -> n.copy(karten = n.karten.map { if (it.id == karteId) f(it) else it }) }
    }

    // Liefert erst zurueck, wenn die Karte gespeichert ist (handleKarteBuchen im Web, fuer das „ja“ im Voice-Modus).
    suspend fun karteBuchenWarten(id: String, k: KiKarte) {
        if (k.art == "fahrer" || k.art == "fahrzeug") {
            val daten = k.daten ?: emptyMap()
            karteSetzen(id, k.id) { it.copy(status = "saving", offen = false) }
            try {
                val (ok, text) = KiAssistentDienst.anlegen(k.art, daten)
                if (!ok) {
                    karteSetzen(id, k.id) { it.copy(status = "pending", daten = daten + ("fehler" to text.ifEmpty { "Nicht angelegt." })) }
                    return
                }
                karteSetzen(id, k.id) { it.copy(status = "booked") }
                if (text.isNotBlank()) hinweis(text, "msg-ai-karte")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                karteSetzen(id, k.id) { it.copy(status = "pending", daten = daten + ("fehler" to (e.message?.ifEmpty { null } ?: "Nicht angelegt."))) }
            }
            return
        }
        val sb = k.standby
        if (k.art == "standby" && sb != null) {
            // Fehlt etwas (oder Ort/Fahrer ohne Daten), erst ins Formular.
            val ohneOrt = (sb.lat == null || sb.lng == null) && sb.ortId.isBlank()
            if (sb.fehlt.isNotEmpty() || ohneOrt || sb.fahrerIds.isEmpty()) { formular = KiFormular(id, standby = sb, karteId = k.id); return }
            karteSetzen(id, k.id) { it.copy(status = "saving") }
            try {
                KiAssistentDienst.standbyAnlegen(sb)
                karteSetzen(id, k.id) { it.copy(status = "booked") }
                hinweis("Standby angelegt: ${sb.ortName}, ${sb.von}–${sb.bis}. Die Fahrer bekommen die Anfrage.", "msg-ai-karte")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                karteSetzen(id, k.id) { it.copy(status = "pending") }
                hinweis("Standby nicht angelegt: ${e.message?.ifEmpty { null } ?: "unbekannter Fehler"}", "msg-ai-karte")
            }
            return
        }
        val v = k.proposal ?: return
        if (!v.hatPflichtfelder) { formular = KiFormular(id, vorschlag = v, karteId = k.id); return }
        karteSetzen(id, k.id) { it.copy(status = "saving") }
        try {
            val buchen = fahrtBuchen ?: throw IllegalStateException("Buchungsfunktion ist nicht verbunden.")
            val fahrtID = buchen(v)
            karteSetzen(id, k.id) { it.copy(status = "booked", rideId = fahrtID?.trim()?.ifEmpty { null }) }
            hinweis(if (v.fahrtId != null) "Änderung gespeichert." else "Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert.", "msg-ai-karte")
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            karteSetzen(id, k.id) { it.copy(status = "pending") }
            hinweis("Buchung fehlgeschlagen: ${e.message?.ifEmpty { null } ?: "Unbekannter Fehler"}", "msg-ai-karte")
        }
    }

    fun karteBuchen(id: String, k: KiKarte) {
        scope.launch { karteBuchenWarten(id, k) }
    }

    fun formularGebucht(id: String, fahrtID: String?, aenderung: Boolean, text: String? = null) {
        val karteId = formular?.karteId
        formular = null
        val meldung = text ?: if (aenderung) "Änderung gespeichert." else "Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert."
        if (karteId != null) {
            karteSetzen(id, karteId) { it.copy(status = "booked", rideId = fahrtID?.trim()?.ifEmpty { null }) }
            hinweis(meldung, "msg-ai-karte")
            return
        }
        aendern(id) { it.copy(bookingStatus = "booked", bookingRideId = fahrtID?.trim()?.ifEmpty { null }) }
        hinweis(if (aenderung) "Änderung gespeichert." else "Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert.", "msg-ai-booked")
    }

    // Liefert den Text fuer den Voice-Modus (handleBookingConfirm im Web).
    suspend fun buchenWarten(id: String, v: KiBuchungsVorschlag): String {
        if (!v.hatPflichtfelder) {
            val t = "Für diese Buchung fehlen noch Pflichtfelder (Start, Ziel oder Zeit)."
            hinweis(t, "msg-ai-booking-error")
            return t
        }
        aendern(id) { it.copy(bookingStatus = "saving") }
        return try {
            val buchen = fahrtBuchen ?: throw IllegalStateException("Buchungsfunktion ist nicht verbunden.")
            val fahrtID = buchen(v)
            aendern(id) { it.copy(bookingStatus = "booked", bookingRideId = fahrtID?.trim()?.ifEmpty { null }) }
            val t = if (v.fahrtId != null) "Änderung gespeichert." else "Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert."
            hinweis(t, "msg-ai-booked")
            t
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            aendern(id) { it.copy(bookingStatus = "pending") }
            val t = "Buchung fehlgeschlagen: ${e.message?.ifEmpty { null } ?: "Unbekannter Fehler"}"
            hinweis(t, "msg-ai-booking-failed")
            t
        }
    }

    fun buchen(id: String, v: KiBuchungsVorschlag) {
        scope.launch { buchenWarten(id, v) }
    }

    // --- Voice-Modus (13.11.) ----------------------------------------------
    // Die Sprache laeuft durch denselben Chat wie getippte Nachrichten, alles bleibt im Verlauf.

    fun offeneKarten(n: KiNachricht?): List<KiKarte> = n?.karten.orEmpty().filter { it.status == "pending" }
    fun istOffen(n: KiNachricht?): Boolean = n != null && ((n.bookingStatus == "pending" && n.bookingProposal != null) ||
        (n.dienstStatus == "offen" && n.dienstVorschlag != null) || offeneKarten(n).isNotEmpty())

    // Was wartet nach dieser Antwort auf ein „ja“? Vorschlaege bestaetigt die App selbst (lokal), sie stehen im
    // Voice-Modus wie im Chat mit ihren Knoepfen. Rueckfragen des Servers („Mit „ja“ sende ich sie.“) gehen als Text an den Server.
    fun fuerStimme(n: KiNachricht?): SprachAntwort {
        if (n == null) return SprachAntwort("Das hat nicht geklappt. Sag es bitte noch einmal.")
        var text = n.text
        var offen: SprachOffen? = null
        if (istOffen(n)) {
            // Ganzer Antworttext auf der Karte, nicht nur die ersten 80 Zeichen.
            offen = SprachOffen(lokal = true, titel = n.text.trim(), id = n.id)
            val frage = if (n.dienstStatus == "offen") "Soll ich das senden?" else "Soll ich das so machen?"
            if (!Regex("""\?\s*$""").containsMatchIn(text)) text = "$text $frage"
        } else if (Regex("""(?i)„ja“|"ja"|\bmit ja\b""").containsMatchIn(text) || Regex("""\?\s*$""").containsMatchIn(text)) {
            // Ja/Nein-Knoepfe nur bei einer Ja/Nein-Frage (19.11.): „Um wie viel Uhr?“ beantwortet man nicht mit ja.
            val hinweisJa = Regex("""(?i)„ja“|"ja"|\bmit ja\b""").containsMatchIn(text)
            offen = SprachOffen(lokal = false, titel = text.trim(), jaNein = hinweisJa || !kiWFrage(text))
        }
        return SprachAntwort(text, offen)
    }


    fun letzteOffene(): KiNachricht? = nachrichten.lastOrNull { istOffen(it) }

    val sprachRufe = SprachRufe(
        senden = { satz ->
            // Laeuft noch eine Anfrage, warten statt sie zu verwerfen (bis 60 s).
            var i = 0
            while (i < 600 && sperre.get()) { delay(100); i += 1 }
            fuerStimme(senden(satz, stimme = true).await())
        },
        // Laeuft im Chat-Scope: oeffnet eine Karte das Formular, verschwindet der Voice-Modus,
        // die uebrigen Karten werden trotzdem fertig gebucht.
        ja = { scope.async {
            val m = letzteOffene()
            if (m == null) SprachAntwort("Da wartet nichts mehr.")
            else if (m.dienstStatus == "offen" && m.dienstVorschlag?.nurKnopf == true) SprachAntwort("Hier ist jemand ausgenommen. Prüf bitte die Fahrer und tipp auf Senden.")
            else {
                val texte = mutableListOf<String>()
                val dv = m.dienstVorschlag
                val bp = m.bookingProposal
                if (m.dienstStatus == "offen" && dv != null) texte += dienstSendenWarten(m.id, dv)
                if (m.bookingStatus == "pending" && bp != null) texte += buchenWarten(m.id, bp)
                val karten = offeneKarten(m)
                for (k in karten) karteBuchenWarten(m.id, k)
                SprachAntwort(texte.filter { it.isNotBlank() }.joinToString(" ").ifEmpty { "Erledigt." })
            }
        }.await() },
        nein = {
            val m = letzteOffene()
            if (m != null) aendern(m.id) { x ->
                x.copy(
                    bookingStatus = if (x.bookingStatus == "pending") "cancelled" else x.bookingStatus,
                    dienstStatus = if (x.dienstStatus == "offen") "verworfen" else x.dienstStatus,
                    karten = x.karten.map { if (it.status == "pending") it.copy(status = "cancelled", offen = false) else it },
                )
            }
            SprachAntwort("Okay, verworfen.")
        },
    )

    // Vorschlaege einer Antwort mit ihren Knoepfen, im Chat und im Voice-Modus gleich (vorschlaegeVon im Web).
    // Antippen einer Karte oeffnet das Formular, auch im Voice-Modus (18.11.), der tritt so lange zur Seite.
    @Composable
    fun Vorschlaege(n: KiNachricht, imSprachModus: Boolean) {
        n.ortWahl?.takeIf { n.ortWahlStatus == "offen" && it.optionen.isNotEmpty() }?.let { w ->
            OrtWahlKacheln(w, sendet) { senden(it) }
        }
        n.dienstVorschlag?.let { v -> DienstVorschlagKnoepfe(n, v, { dienstSenden(n.id, v) }) { aendern(n.id) { it.copy(dienstStatus = "verworfen") } } }
        n.bookingProposal?.let { v ->
            Buchung(
                n, v,
                { formular = KiFormular(n.id, vorschlag = v) },
                { buchen(n.id, v) }, { aendern(n.id) { it.copy(bookingStatus = "cancelled") } }, oeffneFahrt,
            )
        }
        n.karten.forEach { k ->
            WeitereKarte(
                k,
                oeffnen = { formular = KiFormular(n.id, vorschlag = k.proposal, standby = k.standby, karteId = k.id) },
                buchen = { karteBuchen(n.id, k) },
                verwerfen = { karteSetzen(n.id, k.id) { it.copy(status = "cancelled", offen = false) } },
                oeffneFahrt = oeffneFahrt,
                umschalten = { karteSetzen(n.id, k.id) { if (it.status == "pending") it.copy(offen = !it.offen) else it } },
                aendern = { daten -> karteSetzen(n.id, k.id) { it.copy(daten = daten) } },
            )
        }
    }

    // Juengste Antwort mit Vorschlaegen fuer den Voice-Modus (auch nach dem Bestaetigen, damit man das Ergebnis sieht).
    val sprachVorschlag = nachrichten.lastOrNull {
        it.role == "assistant" && it.pending != true && (it.bookingProposal != null || it.dienstVorschlag != null || it.karten.isNotEmpty()
            || it.ortWahlStatus == "offen")
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        DispoHintergrund()
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val breite = minOf(402f, maxWidth.value)
            Box(Modifier.width(breite.dp).fillMaxSize().align(Alignment.TopCenter)) {
                Column(Modifier.fillMaxSize().imePadding()) {
                    // CHAT_TOP = 60 + 50 + 30, dazu der Umschalter Regeln/Frei (28).
                    Spacer(Modifier.height(168.dp))
                    val bearbeitetIndex = bearbeiteteID?.let { i -> nachrichten.indexOfFirst { it.id == i } }?.takeIf { it >= 0 }
                    LazyColumn(
                        Modifier.weight(1f).fillMaxWidth(), state = liste,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
                    ) {
                        itemsIndexed(nachrichten, key = { _, n -> n.id }) { index, n ->
                            // Spaetere Nachrichten treten beim Bearbeiten zurueck.
                            val zurueckgetreten = bearbeitetIndex != null && index > bearbeitetIndex
                            val deckung by animateFloatAsState(if (zurueckgetreten) 0.35f else 1f, tween(420, easing = CubicBezierEasing(0.37f, 0f, 0.18f, 1f)), label = "zurueck")
                            Box(Modifier.fillMaxWidth().alpha(deckung)) {
                                when {
                                    n.role == "user" -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                                        NutzerBlase(n, kopierteID == n.id, bearbeiteteID == n.id, { kopieren(n) }) {
                                            bearbeiteteID = n.id
                                            eingabe = n.text
                                            runCatching { fokus.requestFocus() }
                                        }
                                    }
                                    n.pending == true -> Box(Modifier.padding(4.dp)) { KiDenktSymbol() }
                                    else -> Column {
                                        AssistentBlase(n, kopierteID == n.id, { kopieren(n) }) { nummer ->
                                            runCatching { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$nummer"))) }
                                        }
                                        n.stoerungTag?.let { tag ->
                                            // Demo-Stoerung: Link in den Planer. Live entstehen solche Nachrichten derzeit nicht.
                                            Box(
                                                Modifier.padding(top = 20.dp).fillMaxWidth().height(51.dp).background(kiLime).tippen { oeffneNeuplanung(tag) },
                                                contentAlignment = Alignment.Center,
                                            ) { PText("Neuplanung im Planer ansehen", 20f, 700, Color.Black, -0.5f) }
                                        }
                                        Vorschlaege(n, imSprachModus = false)
                                    }
                                }
                            }
                        }
                        item { Spacer(Modifier.height(1.dp)) }
                    }
                    Spacer(Modifier.height(12.dp)) // COMPOSER_GAP
                    // Vermerk "3 Fahrer markiert" sitzt ueber der Eingabe, der Verlauf endet darueber.
                    if (FahrerMarkierung.wirkt) {
                        MarkierungsVermerk(Modifier.width(362.dp).align(Alignment.CenterHorizontally))
                        Spacer(Modifier.height(8.dp))
                    }
                    Row(
                        Modifier.width(362.dp).align(Alignment.CenterHorizontally).background(Color.Black.copy(alpha = 0.6f)),
                        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier.weight(1f).heightIn(min = 48.dp).background(hex(0x242425), RoundedCornerShape(20.dp))
                                .border(1.dp, hex(0x3F3F46), RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (eingabe.isEmpty()) PText("Nachricht schreiben...", 16f, 400, hex(0x868786))
                            BasicTextField(
                                eingabe,
                                // Enter macht eine neue Zeile wie im Web, gesendet wird mit dem Pfeil.
                                { neu -> eingabe = neu },
                                textStyle = grotesk(16f, zeilenHoehe = 24f, farbe = Color.White),
                                cursorBrush = SolidColor(Color.White),
                                maxLines = 5,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Default),
                                modifier = Modifier.fillMaxWidth().focusRequester(fokus).onFocusChanged { fokussiert = it.isFocused },
                            )
                        }
                        if (eingabe.isBlank() && bearbeiteteID == null && !imWandel) {
                            SprechenKnopf { fokusVerwalter.clearFocus(); sprachModus = true }
                        } else {
                            KiAktionen(
                                bearbeitet = bearbeiteteID != null, sendenAktiv = eingabe.isNotBlank() && !sendet,
                                abbrechen = { bearbeiteteID = null; eingabe = "" }, senden = { senden() },
                            )
                        }
                    }
                    // Ohne Tastatur 175 ueber dem Rand, mit Tastatur 8 darueber.
                    Spacer(Modifier.height(if (fokussiert) 8.dp else 175.dp))
                }
                // Kopf
                Box(Modifier.padding(top = 60.dp).fillMaxWidth().height(50.dp)) {
                    ZurueckKnopf(Modifier.padding(start = 20.dp)) {
                        fokusVerwalter.clearFocus()
                        if (zurueck != null) zurueck() else zeigen(DispoZiel.START)
                    }
                    Box(Modifier.align(Alignment.Center)) { KiMarke() }
                    Box(Modifier.align(Alignment.BottomCenter).offset(y = 32.dp)) { KiModusSchalter() }
                }
            }
        }
        if (!fokussiert && !sprachModus) Navileiste(DispoZiel.KI_ASSISTENT, zeigen)
        formular?.let { f ->
            BackHandler { formular = null }
            val sb = f.standby
            if (sb != null) {
                StandbyNeuSeite(
                    zurueck = { formular = null }, zurFahrt = {},
                    gesendet = { formularGebucht(f.nachricht, null, false, "Standby angelegt. Die Fahrer bekommen die Anfrage.") },
                    zeigen = zeigen, vorlage = sb,
                )
                return@let
            }
            val nachricht = f.nachricht
            val vorschlag = f.vorschlag ?: return@let
            FahrtFormularSeite(
                fahrtID = vorschlag.fahrtId, zurueck = { formular = null }, zeigen = null,
                vorlage = if (vorschlag.fahrtId == null) vorschlag.vorlage else null,
                nachAnlegen = { fahrtID -> formularGebucht(nachricht, fahrtID, vorschlag.fahrtId != null) },
                anpassen = if (vorschlag.fahrtId == null) null else { g -> vorschlag.aenderung(g) },
            )
        }
        // Waehrend das Formular offen ist, ist der Voice-Modus ganz weg (hoert und spricht nicht).
        // Geht es zu und der Voice-Modus war an, kommt er wieder und hoert frisch zu (wie im Web).
        if (sprachModus && formular == null) {
            val sv = sprachVorschlag
            SprachModusAnsicht(
                sprachRufe,
                vorschlag = sv?.let { n -> { Vorschlaege(n, imSprachModus = true) } },
                vorschlagId = sv?.id,
                vorschlagOffen = istOffen(sv),
            ) { sprachModus = false }
        }
    }
}

/** KI-Symbol (14 x 13) + "KI-Assistent" in Lime, 10 px fett. */
@Composable
private fun KiMarke() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon("KI_Trisar_Icons_01_Lime", Modifier.size(14.dp, 13.dp), skalierung = ContentScale.FillBounds)
        Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText("KI-Assistent", 10f, 700, kiLime) }
    }
}

/** Wartende Antwort: pulsierendes KI-Symbol (animate-pulse). */
@Composable
private fun KiDenktSymbol() {
    val t = rememberInfiniteTransition(label = "denkt")
    val hell by t.animateFloat(1f, 0.5f, infiniteRepeatable(tween(1000, easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)), RepeatMode.Reverse), label = "puls")
    Icon("KI_Trisar_Icons_01_Lime", Modifier.size(20.dp, 19.dp).alpha(hell), skalierung = ContentScale.FillBounds)
}

@Composable
private fun SymbolKnopf(aktiv: Boolean, farbe: Color, aktion: () -> Unit, symbol: @Composable (Color) -> Unit) {
    val groesse by animateFloatAsState(if (aktiv) 1.25f else 1f, spring(dampingRatio = 0.55f, stiffness = 500f), label = "symbol")
    Box(Modifier.size(28.dp).tippen(aktion), contentAlignment = Alignment.Center) {
        Box(Modifier.size(16.dp).scale(groesse)) { symbol(farbe) }
    }
}

@Composable
private fun NutzerBlase(n: KiNachricht, kopiert: Boolean, bearbeitet: Boolean, kopieren: () -> Unit, bearbeiten: () -> Unit) {
    val form = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 6.dp, bottomStart = 16.dp)
    Column(Modifier.width(314.dp).background(kiLime, form).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp)) {
        SelectionContainer { Text(n.text, style = grotesk(16f, 500, farbe = Color.Black), modifier = Modifier.fillMaxWidth()) }
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText(n.time, 10f, 400, Color.Black.copy(alpha = 0.6f)) }
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SymbolKnopf(kopiert, Color.Black.copy(alpha = 0.9f), kopieren) { if (kopiert) SymbolHaken(it) else SymbolKopieren(it) }
                SymbolKnopf(bearbeitet, Color.Black.copy(alpha = 0.9f), bearbeiten) { SymbolStift(bearbeitet, it) }
            }
        }
    }
}

@Composable
private fun AssistentBlase(n: KiNachricht, kopiert: Boolean, kopieren: () -> Unit, anrufen: (String) -> Unit) {
    val form = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 6.dp)
    Column(Modifier.width(314.dp).background(hex(0x242525), form).border(1.dp, hex(0x3A3A3A), form).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp)) {
        Box(Modifier.padding(bottom = 12.dp)) { KiMarke() }
        val text = mitTelefonLinks(n.ortWahl?.frage ?: n.text)
        SelectionContainer {
            @Suppress("DEPRECATION")
            ClickableText(text, style = grotesk(16f, farbe = Color.White), modifier = Modifier.fillMaxWidth()) { pos ->
                text.getStringAnnotations("tel", pos, pos).firstOrNull()?.let { anrufen(it.item) }
            }
        }
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText(n.time, 10f, 400, Color.White.copy(alpha = 0.4f)) }
            Spacer(Modifier.weight(1f))
            SymbolKnopf(kopiert, Color.White.copy(alpha = 0.9f), kopieren) { if (kopiert) SymbolHaken(kiLime) else SymbolKopieren(it) }
        }
    }
}

/** Knopfpaar unter einem Dienst-Vorschlag: gruen senden, rot umrandet "Nein", danach Rueckmeldung. */
@Composable
private fun DienstVorschlagKnoepfe(n: KiNachricht, v: KiDienstVorschlag, senden: () -> Unit, verwerfen: () -> Unit) {
    val knopf = v.knopfText
    Column(Modifier.padding(top = 12.dp).fillMaxWidth().widthIn(max = 362.dp)) {
        when (n.dienstStatus) {
            "offen" -> {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.weight(1f).height(51.dp).background(hex(0x59BE80)).tippen(senden), contentAlignment = Alignment.Center) {
                        PText(knopf, 20f, 700, hex(0x202020), -0.5f)
                    }
                    Box(Modifier.width(110.dp).height(51.dp).border(2.dp, hex(0xFF6F63), RectangleShape).tippen(verwerfen), contentAlignment = Alignment.Center) {
                        PText("Nein", 20f, 700, hex(0xFF6F63), -0.5f)
                    }
                }
                n.dienstFehler?.let { Text(it, style = grotesk(11f, 500, farbe = hex(0xFF8E8E)), modifier = Modifier.padding(top = 8.dp)) }
            }
            "sendet" -> PText("Wird gesendet …", 11f, 500, kiLime)
            "gesendet" -> PText("${knopf.removeSuffix(" senden")} an ${n.dienstAnzahl ?: v.fahrer.size} Fahrer gesendet.", 11f, 500, hex(0x59BE80))
            "verworfen" -> PText("Nicht gesendet.", 11f, 500, Color.White.copy(alpha = 0.7f))
            else -> {}
        }
    }
}

@Composable
private fun Buchung(n: KiNachricht, v: KiBuchungsVorschlag, oeffnen: (() -> Unit)?, buchen: () -> Unit, verwerfen: () -> Unit, oeffneFahrt: (String) -> Unit) {
    Column(Modifier.padding(top = 12.dp).fillMaxWidth().widthIn(max = 362.dp)) {
        KiBuchungsKarte(v, if (n.bookingStatus == "pending") oeffnen else null)
        when (n.bookingStatus) {
            "pending" -> Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f).height(51.dp).background(hex(0xE3F754)).tippen(buchen), contentAlignment = Alignment.Center) {
                    PText("buchen", 24f, 700, Color.Black, -0.5f)
                }
                Box(Modifier.weight(1f).height(51.dp).border(2.dp, hex(0xFF6F63), RectangleShape).tippen(verwerfen), contentAlignment = Alignment.Center) {
                    PText("nicht buchen", 24f, 700, hex(0xFF6F63), -0.5f)
                }
            }
            "saving" -> PText("Buchung wird gespeichert...", 11f, 500, kiLime, modifier = Modifier.padding(top = 12.dp))
            "booked" -> Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PText("Gebucht", 11f, 500, hex(0x59BE80))
                Box(
                    Modifier.fillMaxWidth().height(44.dp).background(kiLime).tippen {
                        val id = (n.bookingRideId ?: "").trim()
                        if (id.isNotEmpty()) oeffneFahrt(id)
                    },
                    contentAlignment = Alignment.Center,
                ) { PText("Fahrt bearbeiten", 14f, 700, Color.Black) }
            }
            "cancelled" -> PText("Buchung verworfen", 11f, 500, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(top = 12.dp))
            else -> {}
        }
    }
}

/** BookingPreviewCard */
/** Ortsauswahl: weisse Kacheln wie die Fahrtkarte, Antippen schickt den Ort als Nachricht. */
@Composable
private fun OrtWahlKacheln(w: KiOrtWahl, sendet: Boolean, waehlen: (String) -> Unit) {
    Column(Modifier.padding(top = 12.dp).widthIn(max = 362.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        w.optionen.forEach { o ->
            Column(
                Modifier.fillMaxWidth().background(Color.White).let { if (sendet) it else it.tippen { waehlen(o.wert) } }
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                PAbsatz(o.titel, 18f, 700, 22f, Color.Black)
                if (o.zeile.isNotEmpty()) PAbsatz(o.zeile, 12f, 500, 16f, Color.Black.copy(alpha = 0.8f))
            }
        }
        Box(
            Modifier.fillMaxWidth().border(1.dp, Color.White.copy(alpha = 0.3f)).let { if (sendet) it else it.tippen { waehlen("Keiner davon") } }
                .padding(horizontal = 18.dp, vertical = 12.dp),
        ) { PAbsatz("Keiner davon", 16f, 500, 20f, Color.White) }
    }
}

@Composable
private fun KiBuchungsKarte(v: KiBuchungsVorschlag, oeffnen: (() -> Unit)? = null) {
    val r = v.datum.trim()
    val datum = if (Regex("""^\d{4}-\d{2}-\d{2}$""").matches(r)) "${r.substring(8, 10)}.${r.substring(5, 7)}" else "--.--"
    // Gemeinsame Regel: nur anonyme Gaeste als "N Anonyme Gäste", sonst Namen plus "+ N".
    val gastTeile = de.trisar.kern.GaesteAnzeige.teile(v.fahrgaeste.split(","), v.anonymeGaeste.trim().toIntOrNull() ?: 0)
    val gast = if (gastTeile.namen.isEmpty() && gastTeile.anonym == 0) "Noch keine Gäste angegeben"
        else de.trisar.kern.GaesteAnzeige.text(gastTeile.namen, gastTeile.anonym)
    val fahrer = if (v.fahrerNamen.isEmpty()) "Fahrer fehlt" else v.fahrerNamen.joinToString(", ")
    Box(Modifier.fillMaxWidth().heightIn(min = 144.dp).background(Color.White).let { if (oeffnen != null) it.tippen(oeffnen) else it }) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            PAbsatz(gast, 24f, 700, 26f, Color.Black, modifier = Modifier.padding(end = 86.dp))
            PAbsatz("${v.start} - ${v.ziel}", 12f, 500, 16f, Color.Black.copy(alpha = 0.8f), modifier = Modifier.padding(end = 86.dp))
            PAbsatz(fahrer, 16f, 700, 24f, Color.Black)
            if (v.flugUnbestaetigt) {
                PAbsatz("Flug ${v.flugnummer} nicht bestätigt", 11f, 700, 16f, Color(0xFFD23A2E), modifier = Modifier.padding(end = 60.dp))
            }
        }
        Column(Modifier.align(Alignment.TopEnd).padding(top = 18.dp, end = 16.dp), horizontalAlignment = Alignment.End) {
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(datum, 16f, 700, Color.Black) }
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(if (v.startZeit.isEmpty()) "--:--" else if (v.startZeitBis.isEmpty()) v.startZeit else "${v.startZeit}–${v.startZeitBis}", 16f, 400, Color.Black) }
        }
        Icon("Arrow_Trisar_Icons_01", Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 18.dp).size(34.dp, 21.dp).scale(1.2f), skalierung = ContentScale.FillBounds)
    }
}

/** Weitere Karte unter der ersten Fahrt (karten im Web): Fahrt oder Standby, eigene Knoepfe und eigener Status. */
@Composable
private fun WeitereKarte(
    k: KiKarte, oeffnen: (() -> Unit)?, buchen: () -> Unit, verwerfen: () -> Unit, oeffneFahrt: (String) -> Unit,
    umschalten: () -> Unit = {}, aendern: (Map<String, String>) -> Unit = {},
) {
    val offen = k.status == "pending"
    Column(Modifier.padding(top = 12.dp).fillMaxWidth().widthIn(max = 362.dp)) {
        val sb = k.standby
        val v = k.proposal
        val anlegen = k.art == "fahrer" || k.art == "fahrzeug"
        when {
            anlegen -> KiAnlegenKarte(k.art, k.daten ?: emptyMap(), k.offen && offen, umschalten, aendern)
            k.art == "standby" && sb != null -> KiStandbyKarte(sb, if (offen) oeffnen else null)
            v != null -> KiBuchungsKarte(v, if (offen) oeffnen else null)
            else -> return@Column
        }
        when (k.status) {
            "pending" -> Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f).height(51.dp).background(hex(0xE3F754)).tippen(buchen), contentAlignment = Alignment.Center) {
                    PText("buchen", 24f, 700, Color.Black, -0.5f)
                }
                Box(Modifier.weight(1f).height(51.dp).border(2.dp, hex(0xFF6F63), RectangleShape).tippen(verwerfen), contentAlignment = Alignment.Center) {
                    PText("nicht buchen", 24f, 700, hex(0xFF6F63), -0.5f)
                }
            }
            "saving" -> PText(
                when (k.art) { "standby" -> "Standby wird gespeichert..."; "fahrer" -> "Fahrer wird angelegt..."; "fahrzeug" -> "Fahrzeug wird angelegt..."; else -> "Buchung wird gespeichert..." },
                11f, 500, kiLime, modifier = Modifier.padding(top = 12.dp),
            )
            "booked" -> if (k.art == "standby" || anlegen) {
                val text = when (k.art) { "fahrer" -> "Fahrer angelegt"; "fahrzeug" -> "Fahrzeug angelegt"; else -> "Standby angelegt" }
                PText(text, 11f, 500, hex(0x59BE80), modifier = Modifier.padding(top = 12.dp))
            } else {
                Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PText("Gebucht", 11f, 500, hex(0x59BE80))
                    val id = (k.rideId ?: "").trim()
                    if (id.isNotEmpty()) {
                        Box(Modifier.fillMaxWidth().height(44.dp).background(kiLime).tippen { oeffneFahrt(id) }, contentAlignment = Alignment.Center) {
                            PText("Fahrt bearbeiten", 14f, 700, Color.Black)
                        }
                    }
                }
            }
            "cancelled" -> PText("Buchung verworfen", 11f, 500, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(top = 12.dp))
            else -> {}
        }
    }
}

/** AnlegenPreviewCard: Neuer Fahrer / Neues Fahrzeug. Antippen klappt die Felder zum Bearbeiten auf. */
@Composable
private fun KiAnlegenKarte(art: String, d: Map<String, String>, offen: Boolean, umschalten: () -> Unit, aendern: (Map<String, String>) -> Unit) {
    fun f(k: String) = d[k].orEmpty().trim()
    val titel = if (art == "fahrer") "${f("vor")} ${f("nach")}".trim().ifEmpty { "Neuer Fahrer" } else f("modell").ifEmpty { "Neues Fahrzeug" }
    val zeile = if (art == "fahrer") {
        listOf(f("benutzername").ifEmpty { null }?.let { "Benutzername $it" }, f("nummer").ifEmpty { null }?.let { "Nr. $it" }, f("telefon").ifEmpty { null })
    } else {
        listOf(f("kennzeichen").ifEmpty { "ohne Kennzeichen" }, f("sitze").ifEmpty { null }?.let { "$it Sitze" }, f("farbe").ifEmpty { null }, f("kraftstoff").ifEmpty { null })
    }.filterNotNull().joinToString(" · ")
    Column(Modifier.fillMaxWidth().background(Color.White)) {
        Box(Modifier.fillMaxWidth().tippen(umschalten)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                PAbsatz(titel, 24f, 700, 26f, Color.Black, modifier = Modifier.padding(end = 86.dp))
                if (zeile.isNotEmpty()) PAbsatz(zeile, 12f, 500, 16f, Color.Black.copy(alpha = 0.8f), modifier = Modifier.padding(end = 86.dp))
                PAbsatz(
                    if (art == "fahrer") "Neuer Fahrer" else f("fahrerName").ifEmpty { null }?.let { "Neues Fahrzeug für $it" } ?: "Neues Fahrzeug",
                    16f, 700, 24f, Color.Black,
                )
                val fehler = f("fehler")
                if (fehler.isNotEmpty()) PAbsatz(fehler, 11f, 700, 16f, hex(0xD23A2E))
            }
            PText(if (offen) "Fertig" else "Bearbeiten", 11f, 700, Color.Black.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.TopEnd).padding(top = 18.dp, end = 16.dp))
        }
        if (offen) {
            Column(Modifier.padding(start = 18.dp, end = 18.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (anlegenFelder[art] ?: emptyList()).forEach { (feld, label) ->
                    Column {
                        PText(label, 11f, 700, Color.Black.copy(alpha = 0.8f))
                        BasicTextField(
                            d[feld].orEmpty(),
                            { neu -> aendern(d + (feld to neu) + ("fehler" to "")) },
                            singleLine = true,
                            textStyle = grotesk(14f, 500, farbe = Color.Black),
                            cursorBrush = SolidColor(Color.Black),
                            keyboardOptions = KeyboardOptions(
                                capitalization = if (feld in setOf("benutzername", "email", "kennzeichen")) KeyboardCapitalization.None else KeyboardCapitalization.Words,
                                keyboardType = when (feld) {
                                    "telefon" -> androidx.compose.ui.text.input.KeyboardType.Phone
                                    "email" -> androidx.compose.ui.text.input.KeyboardType.Email
                                    "sitze", "nummer" -> androidx.compose.ui.text.input.KeyboardType.Number
                                    else -> androidx.compose.ui.text.input.KeyboardType.Text
                                },
                                imeAction = ImeAction.Next,
                            ),
                            modifier = Modifier.padding(top = 4.dp).fillMaxWidth().height(36.dp)
                                .border(1.dp, Color.Black.copy(alpha = 0.2f), RectangleShape).padding(horizontal = 8.dp, vertical = 8.dp),
                        )
                    }
                }
                // Fahrzeug je Fahrer: Zuordnung beim Bestaetigen, hier abwaehlbar.
                if (art == "fahrzeug" && f("fahrerId").isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        PText("Fahrer: ${f("fahrerName")}", 11f, 700, Color.Black.copy(alpha = 0.8f), modifier = Modifier.weight(1f))
                        Box(
                            Modifier.height(32.dp).border(1.dp, Color.Black.copy(alpha = 0.3f), RectangleShape)
                                .tippen { aendern(d + ("fahrerId" to "") + ("fahrerName" to "") + ("fehler" to "")) }
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) { PText("Ohne Fahrer", 11f, 700, Color.Black) }
                    }
                }
            }
        }
    }
}

private val standbyFehltText = mapOf("von" to "Startzeit", "bis" to "Endzeit", "zeiten" to "Endzeit nach Start", "ort" to "Ort", "fahrer" to "Fahrer")

/** StandbyPreviewCard: Titel Standby, Ort, Fahrer, rechts oben Datum und von–bis. */
@Composable
private fun KiStandbyKarte(sb: StandbyVorlage, oeffnen: (() -> Unit)? = null) {
    val r = sb.datum.trim()
    val datum = if (Regex("""^\d{4}-\d{2}-\d{2}$""").matches(r)) "${r.substring(8, 10)}.${r.substring(5, 7)}" else "--.--"
    val fahrer = if (sb.fahrerNamen.isEmpty()) "Fahrer fehlt" else sb.fahrerNamen.joinToString(", ")
    val fehlt = sb.fehlt.map { standbyFehltText[it] ?: it }
    Box(Modifier.fillMaxWidth().heightIn(min = 144.dp).background(Color.White).let { if (oeffnen != null) it.tippen(oeffnen) else it }) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            PAbsatz("Standby", 24f, 700, 26f, Color.Black, modifier = Modifier.padding(end = 86.dp))
            PAbsatz(sb.ortName.ifBlank { sb.adresse }.ifBlank { "Ort offen" }, 12f, 500, 16f, Color.Black.copy(alpha = 0.8f), modifier = Modifier.padding(end = 86.dp))
            PAbsatz(fahrer, 16f, 700, 24f, Color.Black)
            if (fehlt.isNotEmpty()) {
                PAbsatz("Fehlt: ${fehlt.joinToString(", ")}", 11f, 700, 16f, hex(0xD23A2E), modifier = Modifier.padding(end = 60.dp))
            }
        }
        Column(Modifier.align(Alignment.TopEnd).padding(top = 18.dp, end = 16.dp), horizontalAlignment = Alignment.End) {
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(datum, 16f, 700, Color.Black) }
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) {
                PText("${sb.von.ifBlank { "--:--" }}–${sb.bis.ifBlank { "--:--" }}", 16f, 400, Color.Black)
            }
        }
        Icon("Arrow_Trisar_Icons_01", Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 18.dp).size(34.dp, 21.dp).scale(1.2f), skalierung = ContentScale.FillBounds)
    }
}

/** Senden-Knopf und beim Bearbeiten der rote Abbrechen-Knopf links daneben (.ki-aktionen). */
@Composable
private fun KiAktionen(bearbeitet: Boolean, sendenAktiv: Boolean, abbrechen: () -> Unit, senden: () -> Unit) {
    val weich = tween<Float>(860, easing = CubicBezierEasing(0.37f, 0f, 0.18f, 1f))
    val breite by animateFloatAsState(if (bearbeitet) 108f else 48f, weich, label = "breite")
    val anteil by animateFloatAsState(if (bearbeitet) 1f else 0f, weich, label = "abbrechen")
    Box(Modifier.size(breite.dp, 48.dp), contentAlignment = Alignment.CenterEnd) {
        Box(
            Modifier.offset(x = (-60f * anteil).dp).size(48.dp).scale(0.45f + 0.55f * anteil).alpha(anteil)
                .then(if (bearbeitet) Modifier.tippen(abbrechen) else Modifier)
        ) { Icon("Abbrechen_Rund_Trisar_01", Modifier.size(48.dp), skalierung = ContentScale.FillBounds) }
        Box(
            Modifier.size(48.dp).alpha(if (sendenAktiv) 1f else 0.5f).background(hex(if (sendenAktiv) 0xE3F754 else 0xE3F654), CircleShape)
                .tippen { if (sendenAktiv) senden() },
            contentAlignment = Alignment.Center,
        ) { Icon("Arrow_Trisar_Icons_01", Modifier.size(20.dp), skalierung = ContentScale.FillBounds) }
    }
}

// MARK: - Symbole (SVG aus KiAssistentView.jsx, viewBox 24)

@Composable
private fun SymbolKopieren(farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        drawRect(farbe, Offset(9 * s, 9 * s), androidx.compose.ui.geometry.Size(10 * s, 10 * s), style = Stroke(2 * s))
        val p = Path().apply { moveTo(5 * s, 15 * s); lineTo(5 * s, 5 * s); lineTo(15 * s, 5 * s) }
        drawPath(p, farbe, style = Stroke(2 * s))
    }
}

@Composable
private fun SymbolHaken(farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        val p = Path().apply { moveTo(5 * s, 12.5f * s); lineTo(9.5f * s, 17 * s); lineTo(19 * s, 7.5f * s) }
        drawPath(p, farbe, style = Stroke(2.4f * s, cap = StrokeCap.Square))
    }
}

@Composable
private fun SymbolStift(gefuellt: Boolean, farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        val p = Path().apply {
            moveTo(4 * s, 20 * s); lineTo(8.2f * s, 19 * s); lineTo(17.8f * s, 9.4f * s)
            quadraticTo(18.6f * s, 8.3f * s, 17.8f * s, 7.2f * s)
            lineTo(16.8f * s, 6.2f * s)
            quadraticTo(15.7f * s, 5.4f * s, 14.6f * s, 6.2f * s)
            lineTo(5 * s, 15.8f * s); close()
        }
        if (gefuellt) {
            drawPath(p, farbe, style = Fill)
            drawPath(p, farbe, style = Stroke(2 * s, join = StrokeJoin.Round))
        } else {
            drawPath(p, farbe, style = Stroke(2 * s))
            drawLine(farbe, Offset(13 * s, 7 * s), Offset(17 * s, 11 * s), 2 * s)
        }
    }
}


/**
 * Umschalter Regeln/Frei im KI-Assistenten (13.11.), wie shared/kiModus.js im Web. Pro Geraet gemerkt
 * (SharedPreferences "trisar_ki"), beim ersten Anzeigen geladen.
 */
internal object KiModus {
    // Standard ist "frei" (Wunsch 13.11.), "regeln" nur wenn ausdruecklich gewaehlt.
    var modus by androidx.compose.runtime.mutableStateOf("frei")
        private set
    private var ablage: android.content.SharedPreferences? = null

    fun laden(ctx: android.content.Context) {
        if (ablage != null) return
        ablage = ctx.applicationContext.getSharedPreferences("trisar_ki", android.content.Context.MODE_PRIVATE)
        modus = if (ablage?.getString("modus", null) == "regeln") "regeln" else "frei"
    }

    fun setzen(neu: String) {
        modus = if (neu == "regeln") "regeln" else "frei"
        ablage?.edit()?.putString("modus", modus)?.apply()
    }
}

/** Zwei Felder "Regeln | Frei", Lime-Rahmen, aktives Feld gefuellt (Entwurf 13.11.). */
@Composable
internal fun KiModusSchalter(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    androidx.compose.runtime.LaunchedEffect(Unit) { KiModus.laden(ctx) }
    Row(modifier.border(2.dp, kiLime)) {
        for ((wert, text) in listOf("regeln" to "Regeln", "frei" to "Frei")) {
            val an = KiModus.modus == wert
            Box(
                Modifier.height(24.dp).background(if (an) kiLime else Color.Transparent).tippen { KiModus.setzen(wert) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) { PText(text, 12f, 500, if (an) hex(0x0E1008) else kiLime) }
        }
    }
}

/** Letzte Frage im Text ist eine W-Frage („…: Um wie viel Uhr?“, „Welches Ziel meinst du?“). */
private fun kiWFrage(text: String): Boolean {
    val letzte = text.trim().split(Regex("""[.!:\n]""")).lastOrNull()?.trim().orEmpty()
    if (!letzte.endsWith("?")) return false
    return Regex("""(?i)^(um\s+wie\s+viel|wie|was|wann|wo|wohin|woher|welche[rsmn]?|wer|wen|wem|wessen|warum|wieso|weshalb|an\s+wen|f(ü|ue)r\s+wen|mit\s+wem|bis\s+wann|ab\s+wann|von\s+wo)\b""").containsMatchIn(letzte)
}
