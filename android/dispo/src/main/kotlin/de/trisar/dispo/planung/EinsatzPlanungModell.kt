package de.trisar.dispo.planung

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.text.Collator
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * Zustand und Ablauf der Einsatzplanung wie EinsatzPlanungModell.swift (KiPlanerDemoView.jsx,
 * Live-Zweig) mit den Daten, die AlleFahrer.jsx dem Planer uebergibt (sichtbare Fahrer,
 * Fahrten heute bis uebermorgen, Fahrer- und Fahrtenkurven ueber 72 h).
 */
internal class EinsatzPlanungModell {
    enum class Ablauf { UEBERSICHT, KALENDER, BEDARF, TAG }

    companion object {
        const val HORIZONT_TAGE = 3
        val TAGES_STUNDEN = (6..23).toList()   // DAY_HOURS: Bedarfsprofil 06–23 Uhr
        const val RUHEZEIT_STANDARD = 11.0
        private val DISPO = setOf("dispo", "dispatcher", "admin", "koordinator", "coordinator")
    }

    private val speicher = EinsatzSpeicher
    private val fahrerDienst = PlanFahrerDienst()
    val heute: String = EinsatzUhr.heute()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // Ablauf
    var ablauf by mutableStateOf(if (speicher.einsatz?.tage?.isNotEmpty() == true) Ablauf.UEBERSICHT else Ablauf.KALENDER)
    var einsatz by mutableStateOf(speicher.einsatz)
    var uebersichtIndex by mutableIntStateOf(0)
    var tagAusUebersicht by mutableStateOf(false)
    var tagesKarte by mutableStateOf(false)
    var tagesKarteSignal by mutableIntStateOf(0)
    /** Per Hand angepasster Bedarf: iso -> (stunde -> wert) */
    var bedarfAnpassung by mutableStateOf<Map<String, Map<Int, Int>>>(emptyMap())
    var kalenderAuswahl by mutableStateOf(speicher.einsatz?.auswahl)
    var planTage by mutableStateOf(speicher.einsatz?.tage ?: emptyList())
    var planTagIndex by mutableIntStateOf(0)
    var planungTag by mutableStateOf<String?>(null)
    var laeuft by mutableStateOf(false)
    var abgelehnt by mutableStateOf(speicher.abgelehnt.toSet())
    var uebernommen by mutableStateOf(speicher.uebernommen.toSet())
    var geplant by mutableStateOf(speicher.geplant.toMap())
    var angenommen by mutableStateOf(speicher.angenommen.toMap())
    var planLog by mutableStateOf("")
    var fehler by mutableStateOf("")
    var strategieKey by mutableStateOf("standard")

    // Daten
    var fahrerListe by mutableStateOf<List<PlanFahrer>>(emptyList()); private set
    var alleFahrerAnzahl by mutableIntStateOf(0); private set
    var fahrten by mutableStateOf<List<PlanerZeile>>(emptyList()); private set
    private var fahrzeuge: List<PlanerZeile> = emptyList()
    private var laufNr = 0
    private var beobachter: Job? = null
    private var jobsAbfrage: Job? = null

    // MARK: Laden

    fun starten() {
        beobachter = scope.launch {
            var erstes = true
            fahrerDienst.fahrer.collect { liste ->
                if (liste == null) return@collect
                fahrerUebernehmen(liste)
                if (erstes) {
                    erstes = false
                    fahrtenLaden()
                    fahrzeugeLaden()
                } else {
                    fahrtenNeuLaden()
                }
            }
        }
        fahrerDienst.starten()
    }

    fun stoppen() {
        beobachter?.cancel()
        jobsAbfrage?.cancel()
        fahrerDienst.stoppen()
        scope.cancel()
    }

    /** visibleDrivers: Dispo-Rollen raus, nach Nachname und Vorname sortiert. */
    private fun fahrerUebernehmen(liste: List<PlanFahrer>) {
        alleFahrerAnzahl = liste.size
        val c = Collator.getInstance(Locale.GERMAN).apply { strength = Collator.PRIMARY }
        fahrerListe = liste.filter { (it.role ?: "").trim().lowercase() !in DISPO }
            .sortedWith { a, b ->
                val n = c.compare(a.lastName, b.lastName)
                if (n != 0) n else c.compare(a.firstName, b.firstName)
            }
    }

    private fun fahrtenNeuLaden() {
        jobsAbfrage?.cancel()
        jobsAbfrage = scope.launch { fahrtenLaden() }
    }

    /** Planungshorizont heute bis uebermorgen, gleiche Spalten wie AlleFahrer.jsx. */
    private suspend fun fahrtenLaden() {
        val ende = EinsatzUhr.plusTage(heute, HORIZONT_TAGE - 1)
        fahrten = try {
            Backend.client.from("jobs")
                .select(Columns.raw("id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins")) {
                    filter { gte("ride_date", heute); lte("ride_date", ende) }
                }.decodeList<JsonObject>()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            emptyList()
        }
    }

    /** Fahrzeugpool fuer Stage 2 der Planung (Fahrzeugzuteilung im Backend). */
    private suspend fun fahrzeugeLaden() {
        runCatching { Backend.client.from("vehicles").select().decodeList<JsonObject>() }.getOrNull()?.let { fahrzeuge = it }
    }

    // MARK: Kurven (72 h ab heute 00:00)

    val angebotAlle: List<Int> get() = PlanKurven.angebot(fahrerListe)

    val gebuchtAlle: List<Int>
        get() {
            val z = IntArray(HORIZONT_TAGE * 24)
            val muster = Regex("""^(\d{1,2}):(\d{2})""")
            for (r in fahrten) {
                if (r.text("status").lowercase() in PlanKurven.ausgeschlossen) continue
                val tag = PlanDienstzeit.tagAbstand(r.text("ride_date")) ?: continue
                if (tag < 0 || tag >= HORIZONT_TAGE) continue
                val m = muster.find(r.text("etd")) ?: continue
                val h = m.groupValues[1].toInt()
                if (h !in 0..23) continue
                z[tag * 24 + h] += 1
            }
            return z.toList()
        }

    /** computeDemandCurve ueber den ganzen Horizont. */
    val bedarfAlle: List<Int> get() = PlanKurven.bedarf(gebuchtAlle)

    /** Bedarf inklusive der Anpassungen aus der Bedarfsuebersicht. */
    val bedarfAngepasst: List<Int>
        get() {
            val reihe = bedarfAlle.toMutableList()
            for ((iso, stunden) in bedarfAnpassung) {
                val nr = EinsatzUhr.tagNr(iso, heute)
                for ((stunde, wert) in stunden) {
                    val i = nr * 24 + stunde
                    if (i >= 0 && i < reihe.size) reihe[i] = max(0, wert)
                }
            }
            return reihe
        }

    /** Tage mit gebuchten Fahrten im Horizont: nur sie sind im Kalender waehlbar. */
    val tageMitFahrten: Set<String>
        get() = fahrten.filter { it.text("status").lowercase() !in PlanKurven.ausgeschlossen }
            .map { it.text("ride_date") }
            .filter { val i = EinsatzUhr.tagNr(it, heute); i >= 0 && i < HORIZONT_TAGE }
            .toSet()

    // MARK: Ableitungen

    val aktuellerTag: String? get() = if (planTage.isEmpty()) null else planTage[min(planTagIndex, planTage.size - 1)]

    fun sichtbar(iso: String): List<EinsatzVorschlag> = (geplant[iso]?.suggestions ?: emptyList()).filter { it.id !in abgelehnt }

    /** Je Tag des Zeitraums: true = alle nicht abgelehnten Vorschlaege uebernommen. */
    val tagesStatus: List<Boolean>
        get() = planTage.map { iso ->
            val offen = sichtbar(iso)
            offen.isNotEmpty() && offen.all { it.id in uebernommen }
        }

    val alleTageFertig: Boolean get() = tagesStatus.let { s -> s.isNotEmpty() && s.all { it } }

    /** Gesperrt ist nur der Tag, der gerade gerechnet wird. */
    fun tagGesperrt(iso: String) = laeuft && (planungTag == null || planungTag == iso)

    /** laeuft fuer die Tagesansicht: rechnet dieser Tag oder fehlt er noch. */
    val tagLaeuft: Boolean
        get() {
            val iso = aktuellerTag ?: return false
            return laeuft && (planungTag == null || planungTag == iso || geplant[iso] == null)
        }

    // MARK: Ablauf

    /** Kalender -> Bedarfsuebersicht des Zeitraums (nur Tage mit Fahrten). */
    fun zeitraumPlanen(auswahl: EinsatzZeitraum) {
        val tage = mutableListOf<String>()
        val mitFahrten = tageMitFahrten
        var iso = auswahl.von
        while (iso <= auswahl.bis) {
            if (iso in mitFahrten) tage += iso
            iso = EinsatzUhr.plusTage(iso, 1)
        }
        if (tage.isEmpty()) return
        kalenderAuswahl = auswahl
        planTage = tage
        planTagIndex = 0
        tagAusUebersicht = false
        ablauf = Ablauf.BEDARF
    }

    fun bedarfAnpassen(iso: String, stunde: Int, wert: Int) {
        val tag = (bedarfAnpassung[iso] ?: emptyMap()) + (stunde to wert)
        bedarfAnpassung = bedarfAnpassung + (iso to tag)
    }

    /** Bedarfsuebersicht -> Tagesplanung: jetzt wird der Zeitraum geplant. */
    fun bedarfWeiter() {
        if (planTage.isEmpty()) return
        planTagIndex = 0
        ablauf = Ablauf.TAG
        val tage = planTage
        val fenster = kalenderAuswahl
        planLauf.launch { planen(tage, fenster) }
    }

    fun tagWechseln(index: Int) { planTagIndex = index }

    /** Uebersicht -> Tagesplanung des gewaehlten Tages. */
    fun einsatzTagOeffnen(index: Int) {
        val e = einsatz ?: return
        if (index >= e.tage.size) return
        planTage = e.tage
        kalenderAuswahl = e.auswahl
        planTagIndex = index
        uebersichtIndex = index
        tagAusUebersicht = true
        ablauf = Ablauf.TAG
    }

    fun tagZurueck() {
        if (tagAusUebersicht) {
            uebersichtIndex = min(planTagIndex, planTage.size - 1)
            ablauf = Ablauf.UEBERSICHT
        } else {
            ablauf = Ablauf.BEDARF
        }
    }

    /** Ist jeder Tag geplant, geht es nach einem Moment in die Uebersicht des Einsatzes. */
    suspend fun vielleichtZurUebersicht() {
        if (ablauf != Ablauf.TAG || tagAusUebersicht || !alleTageFertig || laeuft) return
        delay(1200)
        if (ablauf != Ablauf.TAG || tagAusUebersicht || !alleTageFertig || laeuft) return
        val fertig = EinsatzFertig(planTage, kalenderAuswahl)
        speicher.einsatz = fertig
        speicher.sichern()
        einsatz = fertig
        uebersichtIndex = 0
        ablauf = Ablauf.UEBERSICHT
    }

    /** Strategie in der Tagesplanung: nur diesen Tag mit dem Preset neu planen. */
    fun tagesStrategie(key: String) {
        if (laeuft) return
        val iso = aktuellerTag ?: return
        val preset = EinsatzStrategie.finden(key)
        strategieKey = key
        PlanerRegeln.schreiben(JsonObject(PlanerRegeln.lesen() + preset.regeln))
        val fenster = kalenderAuswahl
        planLauf.launch { planen(listOf(iso), fenster, preset) }
    }

    // MARK: Planen

    private class Ruhe(var frueh: Int? = null, var spaet: Int? = null)
    private data class Schicht(val fahrer: String, val start: String, val ende: String)

    /** Ruhezeitfenster (§ 5 ArbZG) aus Vortag und Folgetag. */
    private fun ruhefenster(iso: String, schichten: Map<String, List<Schicht>>, ruhe: Double): Map<String, Ruhe> {
        val fenster = mutableMapOf<String, Ruhe>()
        val r = (ruhe * 60).toInt()
        for (s in schichten[EinsatzUhr.plusTage(iso, -1)] ?: emptyList()) {
            val e = EinsatzUhr.minuten(s.ende) ?: continue
            val kandidat = e - 1440 + r
            val f = fenster.getOrPut(s.fahrer) { Ruhe() }
            f.frueh = max(f.frueh ?: kandidat, kandidat)
        }
        for (s in schichten[EinsatzUhr.plusTage(iso, 1)] ?: emptyList()) {
            val st = EinsatzUhr.minuten(s.start) ?: continue
            val kandidat = st + 1440 - r
            val f = fenster.getOrPut(s.fahrer) { Ruhe() }
            f.spaet = min(f.spaet ?: kandidat, kandidat)
        }
        return fenster
    }

    /** Fahrerzeile wie visibleDriversWithState, plus Ruhezeitfenster. */
    private fun fahrerZeile(f: PlanFahrer, ruhe: Ruhe?): PlanerZeile {
        val n = (f.driverActivityState ?: "").trim().lowercase()
        val zustand = when (n) {
            "aktiv", "active", "in_progress", "unterwegs" -> "aktiv"
            "inaktiv", "inactive" -> "inaktiv"
            else -> "frei"
        }
        val z = linkedMapOf<String, JsonElement>(
            "id" to js(f.id), "name" to js(f.name), "firstName" to js(f.firstName), "lastName" to js(f.lastName),
            "email" to js(f.email), "vehicle" to js(f.vehicle), "role" to (f.role?.let { js(it) } ?: JsonNull),
            "driverNumber" to (f.driverNumber?.let { js(it) } ?: JsonNull),
            "driverActivityState" to (f.driverActivityState?.let { js(it) } ?: JsonNull),
            "serviceStartTime" to js(f.serviceStartTime), "serviceEndTime" to js(f.serviceEndTime),
            "serviceStartDate" to js(f.serviceStartDate), "planRequestStatus" to js(f.planRequestStatus),
            "activityState" to js(zustand), "isIncomplete" to js(f.unfertig), "isInServiceNow" to js(f.imDienst()),
        )
        ruhe?.frueh?.let { z["earliest_start_minute"] = js(it) }
        ruhe?.spaet?.let { z["latest_end_minute"] = js(it) }
        return JsonObject(z)
    }

    /** runPlanning: Tag fuer Tag, jeder geplante Tag geht als Ruhezeit-Randbedingung in den naechsten ein. */
    suspend fun planen(tage: List<String>, zeitfenster: EinsatzZeitraum?, strategie: EinsatzStrategie? = null) {
        laufNr += 1
        val nr = laufNr
        laeuft = true
        planLog = ""
        fehler = ""
        val beginn = System.currentTimeMillis()
        val aktiv = strategie ?: EinsatzStrategie.finden(strategieKey)
        var regeln: Map<String, JsonElement> = PlanerRegeln.standard + PlanerRegeln.lesen()
        aktiv.regeln["mode"]?.let { regeln = regeln + ("mode" to it) }
        if (strategie != null) regeln = regeln + strategie.regeln
        val regelnJ = JsonObject(regeln)
        try {
            if (fahrzeuge.isEmpty()) fahrzeugeLaden()
            val schichten = speicher.angenommen.mapValues { (_, l) -> l.map { Schicht(it.driverId, it.serviceStart, it.serviceEnd) } }.toMutableMap()
            val ruhe = regelnJ["restHours"].planZahl?.takeIf { it > 0 } ?: RUHEZEIT_STANDARD

            for (iso in tage) {
                val fenster = ruhefenster(iso, schichten, ruhe)
                planungTag = iso
                val ergebnis = tagPlanen(iso, fenster, regelnJ, aktiv, zeitfenster)
                if (laufNr != nr) return
                val kpis = ergebnis.roh["kpis"].alsObjekt()
                fun ohneNull(k: String) = ergebnis.roh[k]?.takeIf { it !is JsonNull }
                val eintrag = EinsatzTagErgebnis(
                    strategyKey = aktiv.key, suggestions = ergebnis.vorschlaege, source = ergebnis.roh["source"].planText,
                    gap = kpis?.get("optimality_gap").planZahl, solverStatus = kpis?.get("solver_status").planText,
                    unassignedCount = (kpis?.get("unassigned_ride_count").planZahl ?: 0.0).toInt(), rideCount = ergebnis.anzahl,
                    tunnel = ohneNull("tunnel"), fleetKpis = ohneNull("fleet_kpis"), engine = ohneNull("engine"),
                )
                // Neu geplante Vorschlaege dieses Tages wieder sichtbar und offen.
                for (v in ergebnis.vorschlaege) { speicher.abgelehnt.remove(v.id); speicher.uebernommen.remove(v.id) }
                speicher.geplant[iso] = eintrag
                speicher.sichern()
                geplant = speicher.geplant.toMap()
                abgelehnt = speicher.abgelehnt.toSet()
                uebernommen = speicher.uebernommen.toSet()
                schichten[iso] = ergebnis.vorschlaege.map { Schicht(it.driverId, it.start, it.end) }
            }
            val rest = 1400 - (System.currentTimeMillis() - beginn)
            if (rest > 0) delay(rest)
        } finally {
            if (laufNr == nr) { laeuft = false; planLog = ""; planungTag = null }
        }
    }

    private class TagErgebnis(val roh: PlanerZeile, val vorschlaege: List<EinsatzVorschlag>, val anzahl: Int)

    private suspend fun tagPlanen(
        iso: String, ruhe: Map<String, Ruhe>, regeln: PlanerZeile, strategie: EinsatzStrategie, zeitfenster: EinsatzZeitraum?,
    ): TagErgebnis {
        fun imFenster(r: PlanerZeile): Boolean {
            val etd = EinsatzUhr.normal(r.text("etd"))
            val z = zeitfenster ?: return true
            if (etd.isEmpty()) return true
            if (z.startZeit.isNotEmpty() && iso == z.von && etd < z.startZeit) return false
            if (z.endZeit.isNotEmpty() && iso == z.bis && etd > z.endZeit) return false
            return true
        }
        val tagesFahrten = fahrten.filter {
            it.text("ride_date") == iso && it.text("status").lowercase() !in PlanKurven.ausgeschlossen && imFenster(it)
        }
        val index = max(0, min(HORIZONT_TAGE - 1, EinsatzUhr.tagNr(iso, heute)))
        val bedarf = bedarfAngepasst
        val tagesBedarf = TAGES_STUNDEN.map { bedarf[index * 24 + it] }
        val pool = (regeln["driverPool"].planZahl ?: 101.0).toInt()
        val zeilen = fahrerListe.take(max(0, pool)).map { fahrerZeile(it, ruhe[it.id]) }
        val einstellung = linkedMapOf<String, JsonElement>()
        for (k in listOf("maxWorkHours", "minWorkHours", "bufferMinutes", "rideDurationMinutes", "qualityGapPercent", "mode")) {
            regeln[k]?.let { einstellung[k] = it }
        }
        // Wie Web und iOS: travelModel steht nicht in dieser Liste, der Planer bekommt darum immer "osrm".
        val tagText = EinsatzUhr.tagLang(iso)
        val eingabe = Regex("""^Input: Fahrer=(\d+), Fahrten=(\d+)""")
        val schicht = Regex("Heuristik|Plan erstellt|Vorschläge", RegexOption.IGNORE_CASE)
        val anbieter = Regex("Provider|unterstützt", RegexOption.IGNORE_CASE)
        val roh = EinsatzPlanerDienst.planen(zeilen, tagesFahrten, fahrzeuge, iso, JsonObject(einstellung), tagesBedarf) { text ->
            val m = eingabe.find(text)
            if (m != null) {
                planLog = "$tagText: ${m.groupValues[1]} Fahrer, ${m.groupValues[2]} Fahrten …"
            } else if (schicht.containsMatchIn(text) && !anbieter.containsMatchIn(text)) {
                planLog = "$tagText: Schichten werden gebildet …"
            }
        }
        val vorschlaege = EinsatzPlanerDienst.vorschlaege(roh, tagesFahrten, strategie.key, iso)
        val extra = bereitschaft(iso, vorschlaege, zeilen, regeln, strategie)
        return TagErgebnis(roh, (vorschlaege + extra).sortedBy { it.startMinutes }, tagesFahrten.size)
    }

    /**
     * bereitschaftFuerHandbedarf: wo der Bedarf per Hand erhoeht wurde und der Plan ihn nicht deckt,
     * kommen Bereitschaftsdienste freier Fahrer dazu.
     */
    private fun bereitschaft(
        iso: String, vorschlaege: List<EinsatzVorschlag>, zeilen: List<PlanerZeile>, regeln: PlanerZeile, strategie: EinsatzStrategie,
    ): List<EinsatzVorschlag> {
        val nr = EinsatzUhr.tagNr(iso, heute)
        val stunden = (6 until 26).toList()
        val angepasst = bedarfAngepasst
        val basis = bedarfAlle
        fun wert(reihe: List<Int>, i: Int) = if (i >= 0 && i < reihe.size) reihe[i] else 0
        fun imDienst(minute: Int) = vorschlaege.count { minute >= it.startMinutes && minute < it.endMinutes }
        val offen = stunden.map { s ->
            val i = nr * 24 + s
            if (wert(angepasst, i) <= wert(basis, i)) 0 else max(0, wert(angepasst, i) - imDienst(s * 60 + 30))
        }.toMutableList()
        if (offen.none { it > 0 }) return emptyList()
        val minRoh = (regeln["minWorkHours"].planZahl ?: 3.0).toInt()
        val minH = max(1, if (minRoh == 0) 3 else minRoh)
        val maxRoh = (regeln["maxWorkHours"].planZahl ?: 8.0).toInt()
        val maxH = max(minH, if (maxRoh == 0) 8 else maxRoh)
        val belegt = vorschlaege.map { it.driverId }.filter { it.isNotEmpty() }.toSet()
        val frei = zeilen.filter { it.text("id").isNotEmpty() && it.text("id") !in belegt }.toMutableList()
        val dienste = mutableListOf<EinsatzVorschlag>()
        var sicherung = 0
        while (offen.any { it > 0 } && sicherung < 200) {
            sicherung += 1
            val erste = offen.indexOfFirst { it > 0 }
            if (erste < 0) break
            var letzte = erste
            while (letzte + 1 < offen.size && offen[letzte + 1] > 0 && letzte - erste + 1 < maxH) letzte += 1
            while (letzte - erste + 1 < minH && letzte + 1 < offen.size) letzte += 1
            var anfang = erste
            while (letzte - anfang + 1 < minH && anfang > 0) anfang -= 1
            val sMin = stunden[anfang] * 60
            val eMin = (stunden[letzte] + 1) * 60
            val fi = frei.indexOfFirst { d ->
                (d["earliest_start_minute"].planZahl?.let { it.toInt() <= sMin } ?: true) &&
                    (d["latest_end_minute"].planZahl?.let { it.toInt() >= eMin } ?: true)
            }
            if (fi < 0) break
            val f = frei.removeAt(fi)
            for (i in anfang..letzte) offen[i] = max(0, offen[i] - 1)
            val start = EinsatzUhr.uhr(sMin)
            val ende = EinsatzUhr.uhr(eMin)
            val h = (eMin - sMin) / 60.0
            dienste += EinsatzVorschlag(
                rides = emptyList(), chargeStops = emptyList(), standby = true,
                id = "$iso-${strategie.key}-bereitschaft-${f.text("id")}-$start", dayIso = iso, driverId = f.text("id"),
                name = f.text("name").ifEmpty { "Fahrer ${dienste.size + 1}" },
                start = start, end = ende, hours = stundenText(h),
                stops = listOf("Bereitschaft & Kurzfahrten im Stadtgebiet"), startMinutes = sMin, endMinutes = eMin,
                vehicleLabel = "", vehicleIsEv = false, vehicleId = "", shiftKm = null, chargeStopCount = 0, rideIds = emptyList(),
                minRangeReserveKm = null,
            )
        }
        return dienste
    }

    // MARK: Annehmen, Ablehnen, Zuruecknehmen (schreibt wie onApplySuggestions in die Datenbank)

    private fun zeile(v: EinsatzVorschlag) = EinsatzDienstZeile(v.driverId, v.start, v.end, v.rideIds, v.vehicleId)

    /** DRIVERS_RELOAD_EVENT: Fahrerliste neu laden. */
    private fun nachSchreiben() {
        scope.launch { fahrerDienst.laden() }
    }

    private fun fehlerSetzen(f: String) { fehler = f.ifEmpty { "Schicht konnte nicht übernommen werden." } }

    /** accept unten: alle offenen Vorschlaege des Tages auf einmal uebernehmen. */
    fun tagAnnehmen(iso: String) {
        if (tagGesperrt(iso)) return
        val offen = (geplant[iso]?.suggestions ?: emptyList())
            .filter { it.id !in abgelehnt && it.id !in uebernommen && it.driverId.isNotEmpty() }
        if (offen.isEmpty()) return
        val bisher = (angenommen[iso] ?: emptyList()).filter { z -> offen.none { it.driverId == z.driverId && it.start == z.serviceStart } }
        val zeilen = bisher + offen.map { zeile(it) }
        planLauf.launch {
            EinsatzUebernahme.anwenden(iso, zeilen)?.let { fehlerSetzen(it); return@launch }
            speicher.angenommen[iso] = zeilen
            offen.forEach { speicher.uebernommen += it.id }
            speicher.sichern()
            angenommen = speicher.angenommen.toMap()
            uebernommen = speicher.uebernommen.toSet()
            fehler = ""
            nachSchreiben()
        }
    }

    fun zuruecknehmen(v: EinsatzVorschlag) {
        val iso = v.dayIso
        if (tagGesperrt(iso)) return
        val zeilen = (angenommen[iso] ?: emptyList()).filter { !(it.driverId == v.driverId && it.serviceStart == v.start) }
        planLauf.launch {
            EinsatzUebernahme.anwenden(iso, zeilen, leerErlaubt = true)?.let { fehlerSetzen(it); return@launch }
            speicher.angenommen[iso] = zeilen
            speicher.uebernommen.remove(v.id)
            speicher.sichern()
            angenommen = speicher.angenommen.toMap()
            uebernommen = speicher.uebernommen.toSet()
            fehler = ""
            nachSchreiben()
        }
    }

    fun ablehnen(id: String) {
        val iso = id.take(10)
        val pruef = if (Regex("""\d{4}-\d{2}-\d{2}""").matches(iso)) iso else (aktuellerTag ?: heute)
        if (tagGesperrt(pruef)) return
        speicher.abgelehnt += id
        speicher.sichern()
        abgelehnt = abgelehnt + id
    }

    /**
     * accept: Schicht vergeben. Der Schreibweg ersetzt die Tagesplanung, darum gehen alle bisher
     * angenommenen Schichten des Tages mit.
     */
    fun annehmen(v: EinsatzVorschlag) {
        val iso = v.dayIso
        if (tagGesperrt(iso)) return
        if (v.driverId.isEmpty()) { ablehnen(v.id); return }
        val zeilen = (angenommen[iso] ?: emptyList()).filter { it.driverId != v.driverId || it.serviceStart != v.start } + zeile(v)
        planLauf.launch {
            EinsatzUebernahme.anwenden(iso, zeilen)?.let { fehlerSetzen(it); return@launch }
            speicher.angenommen[iso] = zeilen
            speicher.uebernommen += v.id
            speicher.sichern()
            angenommen = speicher.angenommen.toMap()
            uebernommen = speicher.uebernommen.toSet()
            fehler = ""
            nachSchreiben()
        }
    }

    /** Planungsregeln fuer die Fahrt-Simulation (rideDurationMinutes). */
    val fahrtDauerRegel: Int get() = (PlanerRegeln.lesen()["rideDurationMinutes"].planZahl ?: 80.0).toInt()
}
