package de.trisar.kern

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Eigener Ort der Dispo (Tabelle orte) mit Reinfahr-/Rausfahr-Radius und Icon. */
@Serializable
data class Ort(
    val id: String,
    val name: String = "",
    val adresse: String = "",
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val radius_rein_m: Int = 50,
    val radius_raus_m: Int = 100,
    val icon: String = "pin",
) {
    val punkt get() = GeoPunkt(lat, lng)
}

/**
 * Ort-Icons: die sechs alten und die neuen aus werkzeuge/icons-neu. grau in Listen und bei der Fahrt,
 * Lime fuer ausgewaehlt, schwarz auf dem Lime-Kreis der Karte (Figma 2826-12363).
 */
object OrtIcons {
    /** Dateiname und Beschriftung der neuen Icons. */
    private val NEU = linkedMapOf(
        "hotel" to ("Hotel_Trisar_Icons_01" to "Hotel"),
        "hotel_fassade" to ("Hotel_Fassade_Trisar_Icons_01" to "Hotel Fassade"),
        "bett" to ("Bett_Trisar_Icons_01" to "Bett"),
        "flughafen_tower" to ("Flughafen_Tower_Trisar_Icons_01" to "Flughafen Tower"),
        "flughafen_tower_t1" to ("Flughafen_Tower_T1_Trisar_Icons_01" to "Flughafen Tower T1"),
        "flughafen_tower_t2" to ("Flughafen_Tower_T2_Trisar_Icons_01" to "Flughafen Tower T2"),
        "flughafen_tower_t3" to ("Flughafen_Tower_T3_Trisar_Icons_01" to "Flughafen Tower T3"),
        "flughafen_tower_t4" to ("Flughafen_Tower_T4_Trisar_Icons_01" to "Flughafen Tower T4"),
        "bahnhof_zug" to ("Bahnhof_Zug_Trisar_Icons_01" to "Bahnhof Zug"),
        "hauptbahnhof" to ("Hauptbahnhof_Trisar_Icons_01" to "Hauptbahnhof"),
        "hauptbahnhof_gebaeude" to ("Hauptbahnhof_Gebaeude_Trisar_Icons_01" to "Hauptbahnhof Gebäude"),
        "u_bahn" to ("U_Bahn_Trisar_Icons_01" to "U-Bahn"),
        "bus" to ("Bus_Trisar_Icons_01" to "Bus"),
        "taxi" to ("Taxi_Trisar_Icons_01" to "Taxi"),
        "auto" to ("Auto_Trisar_Icons_01" to "Auto"),
        "shuttle_van" to ("Shuttle_Van_Trisar_Icons_01" to "Shuttle Van"),
        "messe_halle" to ("Messe_Halle_Trisar_Icons_01" to "Messe Halle"),
        "restaurant" to ("Restaurant_Trisar_Icons_01" to "Restaurant"),
        "bar" to ("Bar_Trisar_Icons_01" to "Bar"),
        "kaffee" to ("Kaffee_Trisar_Icons_01" to "Kaffee"),
        "buero" to ("Buero_Trisar_Icons_01" to "Büro"),
        "zuhause" to ("Zuhause_Trisar_Icons_01" to "Zuhause"),
        "krankenhaus" to ("Krankenhaus_Trisar_Icons_01" to "Krankenhaus"),
        "parkplatz" to ("Parkplatz_Trisar_Icons_01" to "Parkplatz"),
        "tankstelle" to ("Tankstelle_Trisar_Icons_01" to "Tankstelle"),
        "einkaufen" to ("Einkaufen_Trisar_Icons_01" to "Einkaufen"),
        "berge" to ("Berge_Trisar_Icons_01" to "Berge"),
        "hafen_schiff" to ("Hafen_Schiff_Trisar_Icons_01" to "Hafen Schiff"),
        "flughafen_terminal" to ("Flughafen_Terminal_Trisar_Icons_01" to "Flughafen Terminal"),
        "bahnhof_gebaeude" to ("Bahnhof_Gebaeude_Trisar_Icons_01" to "Bahnhof Gebäude"),
        "kongress" to ("Kongress_Trisar_Icons_01" to "Kongress"),
        "stadion" to ("Stadion_Trisar_Icons_01" to "Stadion"),
        "museum_bank" to ("Museum_Bank_Trisar_Icons_01" to "Museum Bank"),
        "rathaus" to ("Rathaus_Trisar_Icons_01" to "Rathaus"),
        "kirche" to ("Kirche_Trisar_Icons_01" to "Kirche"),
        "burg_schloss" to ("Burg_Schloss_Trisar_Icons_01" to "Burg Schloss"),
        "universitaet" to ("Universitaet_Trisar_Icons_01" to "Universität"),
        "fabrik" to ("Fabrik_Trisar_Icons_01" to "Fabrik"),
        "lager" to ("Lager_Trisar_Icons_01" to "Lager"),
        "garage_werkstatt" to ("Garage_Werkstatt_Trisar_Icons_01" to "Garage Werkstatt"),
        "stadt_hochhaeuser" to ("Stadt_Hochhaeuser_Trisar_Icons_01" to "Stadt Hochhäuser"),
        "hochhaus" to ("Hochhaus_Trisar_Icons_01" to "Hochhaus"),
        "hochhaus_glas" to ("Hochhaus_Glas_Trisar_Icons_01" to "Hochhaus Glas"),
        "parkhaus" to ("Parkhaus_Trisar_Icons_01" to "Parkhaus"),
        "ladestation" to ("Ladestation_Trisar_Icons_01" to "Ladestation"),
        "geschaeft" to ("Geschaeft_Trisar_Icons_01" to "Geschäft"),
        "apotheke" to ("Apotheke_Trisar_Icons_01" to "Apotheke"),
        "sicherheit_polizei" to ("Sicherheit_Polizei_Trisar_Icons_01" to "Sicherheit Polizei"),
        "botschaft" to ("Botschaft_Trisar_Icons_01" to "Botschaft"),
        "festzelt" to ("Festzelt_Trisar_Icons_01" to "Festzelt"),
        "fernsehturm" to ("Fernsehturm_Trisar_Icons_01" to "Fernsehturm"),
        "bruecke" to ("Bruecke_Trisar_Icons_01" to "Brücke"),
        "fitness" to ("Fitness_Trisar_Icons_01" to "Fitness"),
        "kino" to ("Kino_Trisar_Icons_01" to "Kino"),
        "biergarten" to ("Biergarten_Trisar_Icons_01" to "Biergarten"),
        "uhr" to ("Uhr_Trisar_Icons_01" to "Uhr"),
        "kalender" to ("Kalender_Trisar_Icons_01" to "Kalender"),
        "tag_sonne" to ("Tag_Sonne_Trisar_Icons_01" to "Tag Sonne"),
        "nacht_mond" to ("Nacht_Mond_Trisar_Icons_01" to "Nacht Mond"),
        "regen_schirm" to ("Regen_Schirm_Trisar_Icons_01" to "Regen Schirm"),
        "ziel_flagge" to ("Ziel_Flagge_Trisar_Icons_01" to "Ziel Flagge"),
        "route" to ("Route_Trisar_Icons_01" to "Route"),
        "navigation" to ("Navigation_Trisar_Icons_01" to "Navigation"),
        "lenkrad_fahrer" to ("Lenkrad_Fahrer_Trisar_Icons_01" to "Lenkrad Fahrer"),
        "schluessel" to ("Schluessel_Trisar_Icons_01" to "Schlüssel"),
        "fahrrad" to ("Fahrrad_Trisar_Icons_01" to "Fahrrad"),
        "rollkoffer" to ("Rollkoffer_Trisar_Icons_01" to "Rollkoffer"),
        "ticket" to ("Ticket_Trisar_Icons_01" to "Ticket"),
        "vip_krone" to ("Vip_Krone_Trisar_Icons_01" to "VIP Krone"),
        "musik_band" to ("Musik_Band_Trisar_Icons_01" to "Musik Band"),
        "mikrofon_kongress" to ("Mikrofon_Kongress_Trisar_Icons_01" to "Mikrofon Kongress"),
        "international" to ("International_Trisar_Icons_01" to "International"),
        "kreditkarte" to ("Kreditkarte_Trisar_Icons_01" to "Kreditkarte"),
        "dokument" to ("Dokument_Trisar_Icons_01" to "Dokument"),
        "glocke" to ("Glocke_Trisar_Icons_01" to "Glocke"),
        "schloss" to ("Schloss_Trisar_Icons_01" to "Schloss"),
        "info" to ("Info_Trisar_Icons_01" to "Info"),
        "warnung" to ("Warnung_Trisar_Icons_01" to "Warnung"),
        "check" to ("Check_Trisar_Icons_01" to "Check"),
        "schliessen" to ("Schliessen_Trisar_Icons_01" to "Schließen"),
        "plus" to ("Plus_Trisar_Icons_01" to "Plus"),
    )
    val SCHLUESSEL = listOf("pin", "haus", "flughafen_abflug", "flughafen_landung", "fahrzeug", "stern") + NEU.keys

    private fun basis(k: String): String = when (k) {
        "haus" -> "House_Nav_Trisar_01"
        "flughafen_abflug" -> "Plain_Abflug_Trisar_Icons_01"
        "flughafen_landung" -> "Plain_Landen_Trisar_Icons_01"
        "fahrzeug" -> "Vehicle_Nav_Trisar_01"
        "stern" -> "Stern_Trisar_Icon_01"
        else -> NEU[k]?.first ?: "Pin_Nav_Trisar_Icons_01"
    }

    fun grau(k: String) = basis(k) + "_grau"
    fun lime(k: String) = basis(k) + "_Lime"
    fun schwarz(k: String) = when (k) {
        "fahrzeug" -> "vehicle-car-small"
        "stern" -> "Stern_Trisar_Icon_01_schwarz"
        else -> basis(k)
    }
    fun titel(k: String) = NEU[k]?.second ?: k
}

/**
 * Eigene Orte, einmal geladen und per id nachgeschlagen (Fahrer-App) bzw. per Realtime aktuell
 * gehalten (Dispo). Fehlt die Tabelle noch, bleibt die Liste leer und `verfuegbar` false.
 */
object EigeneOrte {
    var liste by mutableStateOf<List<Ort>>(emptyList())
        private set
    /** true, sobald die Tabelle einmal gelesen werden konnte (Migration ist da). */
    var verfuegbar by mutableStateOf(false)
        private set

    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()
    private var nutzer = 0

    suspend fun laden(): Boolean {
        val zeilen = runCatching {
            Backend.client.from("orte")
                .select(Columns.raw("id, name, adresse, lat, lng, radius_rein_m, radius_raus_m, icon"))
                .decodeList<Ort>()
        }.getOrNull() ?: return false
        liste = zeilen.sortedBy { it.name.lowercase() }
        verfuegbar = true
        return true
    }

    /** Nur laden, wenn noch nichts da ist (Fahrer-App: einmal laden). */
    suspend fun einmalLaden() {
        if (!verfuegbar) laden()
    }

    fun zuID(id: String?): Ort? {
        if (id.isNullOrBlank()) return null
        return liste.firstOrNull { it.id.equals(id, ignoreCase = true) }
    }

    /** Graues Icon des Orts der Fahrt, null ohne Ort (dann gilt das Textmuster). */
    fun iconGrau(id: String?): String? = zuID(id)?.let { OrtIcons.grau(it.icon) }

    /**
     * Vorschlaege fuer Start/Ziel: erst Namen, die mit dem Getippten beginnen, dann Namen mit
     * einem Wort, das so beginnt. Ohne Gross/klein, ab einem Buchstaben.
     */
    fun vorschlaege(eingabe: String): List<Ort> {
        val s = eingabe.trim().lowercase()
        if (s.isEmpty()) return emptyList()
        val anfang = liste.filter { it.name.trim().lowercase().startsWith(s) }
        val wort = liste.filter { o ->
            o !in anfang && o.name.lowercase().split(Regex("[\\s,./()-]+")).drop(1).any { it.startsWith(s) }
        }
        return anfang + wort
    }

    /** Realtime auf orte, solange mindestens eine Ansicht sie braucht. */
    fun beobachten() {
        nutzer += 1
        if (nutzer > 1) return
        auftraege += bereich.launch {
            laden()
            val k = Backend.client.channel("orte-${System.currentTimeMillis()}")
            val strom = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "orte" }
            kanal = k
            auftraege += bereich.launch { strom.collect { laden() } }
            runCatching { k.subscribe() }
        }
    }

    fun nichtMehrBeobachten() {
        nutzer = maxOf(0, nutzer - 1)
        if (nutzer > 0) return
        auftraege.forEach { it.cancel() }
        auftraege.clear()
        val k = kanal ?: return
        kanal = null
        bereich.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }

    /** Nach eigenem Speichern sofort uebernehmen, ohne auf Realtime zu warten. */
    fun setzen(neu: List<Ort>) {
        liste = neu.sortedBy { it.name.lowercase() }
        verfuegbar = true
    }
}
