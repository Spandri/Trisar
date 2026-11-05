package de.trisar.dispo.planung

import android.content.Context
import de.trisar.kern.Backend
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import kotlin.math.max
import kotlin.math.min

// Logik der Einsatzplanung, 1:1 aus EinsatzPlaner.swift (iOS) bzw. KiPlanerDemoView.jsx (Live-Zweig),
// services/kiDriverPlanner.js (CP-SAT-Anfrage + Heuristik als Rueckfall), einsatzWallet.js und
// applyAiPlannerSuggestions aus AlleFahrer.jsx.

/** Planer (services/kiDriverPlanner.js): live der CP-SAT-Server, sonst die Heuristik. */
internal object EinsatzPlanerDienst {
    /** Im Web relativ `/planner` auf admin.trisar.de (Proxy auf den Planner-Container). */
    const val ENDPUNKT = "https://admin.trisar.de/planner/solve"
    /** Start- und Endort der Fahrer fuer die Leerfahrten (Ort aus der Tabelle). */
    const val ZENTRALE = "München Hauptbahnhof, Bayerstraße 10a"
    private const val STANDARD_FAHRT_DAUER = 80
    private const val BEDARF_START_STUNDE = 6

    private var distanzen: JsonObject = JsonObject(emptyMap())
    private var stundenFaktor: Map<String, Double> = emptyMap()
    private var geladen = false

    /** demo/data/distances.json (km, minuten je Ortspaar) und traffic_factors.json, mitgeliefert als Assets. */
    fun einrichten(ctx: Context) {
        if (geladen) return
        geladen = true
        runCatching {
            val text = ctx.assets.open("planer/planer_distanzen.json").bufferedReader().use { it.readText() }
            distanzen = planJson.parseToJsonElement(text) as JsonObject
        }
        runCatching {
            val text = ctx.assets.open("planer/planer_verkehr.json").bufferedReader().use { it.readText() }
            val o = (planJson.parseToJsonElement(text) as JsonObject)["stundenFaktor"].alsObjekt()
            stundenFaktor = o?.mapNotNull { (k, v) -> v.planZahl?.let { k to it } }?.toMap() ?: emptyMap()
        }
    }

    /** Ortskoordinaten aus der Tabelle. */
    val bekannteOrte: Map<String, Pair<Double, Double>>
        get() = distanzen["coords"].alsObjekt()?.mapNotNull { (name, w) ->
            val a = w.alsListe() ?: return@mapNotNull null
            if (a.size != 2) return@mapNotNull null
            val lat = a[0].planZahl ?: return@mapNotNull null
            val lng = a[1].planZahl ?: return@mapNotNull null
            name to (lat to lng)
        }?.toMap() ?: emptyMap()

    /** echteFahrzeit: gemessene Basiszeit des Ortspaars mal Verkehrsfaktor der Abfahrtsstunde. */
    private fun echteFahrzeit(ride: PlanerZeile): Int? {
        val von = ride.text("pickup_name").ifEmpty { ride.text("pickup_address") }
        val nach = ride.text("dropoff_name").ifEmpty { ride.text("dropoff_address") }
        if (von.isEmpty() || nach.isEmpty()) return null
        val tabelle = distanzen["minuten"].alsObjekt() ?: return null
        val basis = (tabelle["$von|$nach"] ?: tabelle["$nach|$von"]).planZahl ?: return null
        val stunde = ride.text("etd").take(2).toIntOrNull() ?: -1
        val faktor = stundenFaktor[stunde.toString()] ?: 1.0
        return max(5, rund(basis * faktor).toInt())
    }

    private fun mitEchtenFahrzeiten(rides: List<PlanerZeile>): List<PlanerZeile> = rides.map { r ->
        val m = echteFahrzeit(r) ?: return@map r
        JsonObject(r + ("duration_minutes" to js(m)))
    }

    // MARK: Heuristik

    private data class NormFahrt(val id: String, val etd: String, val etdMinutes: Int, val startMinutes: Int, val endMinutes: Int, val synthetic: Boolean)

    /** normalizeClockValue aus kiDriverPlanner.js (mit Bereichspruefung). */
    private fun uhrStreng(wert: String): Int? {
        val n = PlanDienstzeit.normal(wert.trim())
        if (n.isNotEmpty()) return PlanDienstzeit.minuten(n)
        val m = Regex("""(\d{1,2}):(\d{2})""").find(wert) ?: return null
        val h = m.groupValues[1].toInt()
        val mi = m.groupValues[2].toInt()
        if (h !in 0..23 || mi !in 0..59) return null
        return h * 60 + mi
    }

    private fun uhrText(minuten: Int): String {
        val m = max(0, min(1439, minuten))
        return zwei(m / 60) + ":" + zwei(m % 60)
    }

    private fun fahrtenNormal(rides: List<PlanerZeile>, puffer: Int, dauer: Int): List<NormFahrt> =
        rides.mapNotNull { r ->
            val etd = uhrStreng(r.text("etd")) ?: return@mapNotNull null
            if (r.text("status").lowercase() in PlanKurven.ausgeschlossen) return@mapNotNull null
            NormFahrt(r.text("id"), uhrText(etd), etd, max(0, etd - puffer), min(1439, etd + dauer + puffer), false)
        }.sortedBy { it.startMinutes }

    private fun synthetisch(
        fahrten: List<NormFahrt>, bedarf: List<Int>, puffer: Int, dauer: Int,
        jeStunde: Int = Int.MAX_VALUE, gesamt: Int = Int.MAX_VALUE,
    ): List<NormFahrt> {
        if (bedarf.isEmpty()) return emptyList()
        val vorhanden = IntArray(bedarf.size)
        for (f in fahrten) {
            val i = f.etdMinutes / 60 - BEDARF_START_STUNDE
            if (i >= 0 && i < vorhanden.size) vorhanden[i] += 1
        }
        val aus = mutableListOf<NormFahrt>()
        for ((i, ziel) in bedarf.withIndex()) {
            if (aus.size >= gesamt) break
            val fehlt = max(0, ziel - vorhanden[i])
            val n = min(fehlt, max(0, jeStunde))
            if (n <= 0) continue
            val stunde = BEDARF_START_STUNDE + i
            val etd = stunde * 60
            for (k in 0 until n) {
                if (aus.size >= gesamt) break
                aus += NormFahrt("synthetic-$stunde-${k + 1}", zwei(stunde) + ":00", etd, max(0, etd - puffer), min(1439, etd + dauer + puffer), true)
            }
        }
        return aus
    }

    /** expandWindowToMinDuration */
    private fun aufMindestdauer(s: Int, e: Int, minDauer: Int, maxDauer: Int): Pair<Int, Int> {
        val minD = max(0, minDauer)
        val maxD = max(minD, maxDauer)
        var start = s
        var ende = e
        var dauer = max(0, ende - start)
        if (dauer > maxD) { ende = start + maxD; dauer = maxD }
        if (dauer >= minD) return start to ende
        var fehlt = minD - dauer
        val vor = fehlt / 2
        start = max(0, start - vor)
        ende = min(1439, ende + (fehlt - vor))
        dauer = max(0, ende - start)
        if (dauer < minD) {
            fehlt = minD - dauer
            if (start == 0) ende = min(1439, ende + fehlt) else if (ende == 1439) start = max(0, start - fehlt)
        }
        dauer = max(0, ende - start)
        if (dauer > maxD) {
            ende = start + maxD
            if (ende > 1439) { val ueber = ende - 1439; ende = 1439; start = max(0, start - ueber) }
        }
        return start to ende
    }

    private data class HFahrer(val id: String, val name: String, val order: Int)

    private fun vorschlagJson(id: String, name: String, x: Int, y: Int, rideIds: List<String>, anzahl: Int) = JsonObject(
        mapOf(
            "driver_id" to js(id), "driver_name" to js(name), "service_start" to js(uhrText(x)),
            "service_end" to js(uhrText(y)), "assigned_ride_ids" to JsonArray(rideIds.map { js(it) }),
            "assigned_rides_count" to js(anzahl),
        )
    )

    /** buildDemandBasedSuggestions */
    private fun nachBedarf(fahrer: List<HFahrer>, bedarf: List<Int>, maxM: Int, minM: Int, pauseM: Int): PlanerZeile? {
        if (bedarf.sum() <= 0 || fahrer.isEmpty()) return null
        class Stand { var first: Int? = null; var last: Int? = null; var block: Int? = null; var arbeit = 0; var slots = 0; val idx = mutableSetOf<Int>() }
        val stand = fahrer.associate { it.id to Stand() }
        var offen = 0
        for ((slot, noetig) in bedarf.withIndex()) {
            if (noetig <= 0) continue
            val a = (BEDARF_START_STUNDE + slot) * 60
            val b = min(1439, a + 60)
            repeat(noetig) {
                var bester: String? = null
                var punkte = Double.POSITIVE_INFINITY
                for (f in fahrer) {
                    val s = stand[f.id] ?: continue
                    if (slot in s.idx) continue
                    val luecke = s.last?.let { a - it }
                    if (luecke != null && luecke < 0) continue
                    val verlaengert = luecke?.let { it < pauseM } ?: false
                    val blockStart = if (verlaengert) (s.block ?: s.first ?: a) else a
                    if (b - blockStart > maxM) continue
                    val p = (s.arbeit * 10).toDouble() + (luecke ?: 0) * 0.2 + f.order
                    if (p < punkte) { punkte = p; bester = f.id }
                }
                val s = bester?.let { stand[it] }
                if (s == null) { offen += 1; return@repeat }
                val luecke = s.last?.let { a - it }
                val verlaengert = luecke?.let { it < pauseM } ?: false
                s.idx += slot; s.slots += 1; s.arbeit += b - a
                if (s.first == null || a < s.first!!) s.first = a
                if (s.last == null || b > s.last!!) s.last = b
                if (s.block == null || !verlaengert) s.block = a
            }
        }
        val vorschlaege = fahrer.mapNotNull { f ->
            val s = stand[f.id] ?: return@mapNotNull null
            val a = s.first ?: return@mapNotNull null
            val b = s.last ?: return@mapNotNull null
            val (x, y) = aufMindestdauer(a, b, minM, maxM)
            vorschlagJson(f.id, f.name, x, y, emptyList(), s.slots)
        }
        return JsonObject(
            mapOf(
                "source" to js("heuristic"), "suggestions" to JsonArray(vorschlaege), "unassigned_ride_ids" to JsonArray(emptyList()),
                "warnings" to JsonArray(if (offen > 0) listOf(js("$offen Bedarfsslot(s) konnten nicht abgedeckt werden.")) else emptyList()),
            )
        )
    }

    /** buildHeuristicSuggestions */
    private fun heuristik(
        drivers: List<PlanerZeile>, rides: List<PlanerZeile>, bedarf: List<Int>, maxM: Int, minM: Int,
        pauseM: Int, puffer: Int, dauer: Int,
    ): PlanerZeile {
        val fahrer = drivers.mapIndexed { i, d -> HFahrer(d.text("id"), d.text("name").ifEmpty { "Fahrer #${i + 1}" }, i) }
            .filter { it.id.isNotEmpty() }
        val normal = fahrtenNormal(rides, puffer, dauer)
        val alle = (normal + synthetisch(normal, bedarf, puffer, dauer)).sortedBy { it.startMinutes }
        if (alle.isEmpty()) nachBedarf(fahrer, bedarf, maxM, minM, pauseM)?.let { return it }

        class Stand { val rides = mutableListOf<NormFahrt>(); var first: Int? = null; var last: Int? = null; var block: Int? = null }
        val stand = fahrer.associate { it.id to Stand() }
        val offen = mutableListOf<String>()
        for (r in alle) {
            var bester: String? = null
            var punkte = Double.POSITIVE_INFINITY
            for (f in fahrer) {
                val s = stand[f.id] ?: continue
                if (s.rides.isEmpty()) {
                    val p = (5000 + f.order * 20).toDouble()
                    if (p < punkte) { punkte = p; bester = f.id }
                    continue
                }
                val ns = min(s.first ?: r.startMinutes, r.startMinutes)
                val ne = max(s.last ?: r.endMinutes, r.endMinutes)
                if (ne - ns > maxM) continue
                val luecke = r.startMinutes - (s.last ?: r.startMinutes)
                if (luecke < 0) continue
                val lang = if (luecke >= pauseM) luecke - pauseM else 0
                val bisher = max(0, (s.last ?: r.endMinutes) - (s.first ?: r.startMinutes))
                val p = (max(0, (ne - ns) - bisher) * 10).toDouble() + lang * 1.2 + f.order * 0.5
                if (p < punkte) { punkte = p; bester = f.id }
            }
            val s = bester?.let { stand[it] }
            if (s == null) {
                if (r.id.isNotEmpty() && !r.synthetic) offen += r.id
                continue
            }
            val luecke = s.last?.let { r.startMinutes - it }
            val verlaengert = luecke?.let { it < pauseM } ?: false
            s.rides += r
            if (s.first == null || r.startMinutes < s.first!!) s.first = r.startMinutes
            if (s.last == null || r.endMinutes > s.last!!) s.last = r.endMinutes
            if (s.block == null || !verlaengert) s.block = r.startMinutes
        }
        val vorschlaege = fahrer.mapNotNull { f ->
            val s = stand[f.id] ?: return@mapNotNull null
            val a = s.first ?: return@mapNotNull null
            val b = s.last ?: return@mapNotNull null
            val (x, y) = aufMindestdauer(a, b, minM, maxM)
            val echte = s.rides.map { it.id }.filter { it.isNotEmpty() && !it.startsWith("synthetic-") }
            vorschlagJson(f.id, f.name, x, y, echte, s.rides.size)
        }
        val einzeln = offen.toSet().toList()
        return JsonObject(
            mapOf(
                "source" to js("heuristic"), "suggestions" to JsonArray(vorschlaege),
                "unassigned_ride_ids" to JsonArray(einzeln.map { js(it) }),
                "warnings" to JsonArray(if (einzeln.isEmpty()) emptyList() else listOf(js("${offen.size} Fahrt(en) konnten nicht konfliktfrei zugewiesen werden."))),
            )
        )
    }

    // MARK: Anfrage

    private fun regel(s: PlanerZeile, k: String, standard: Double): Double {
        val w = s[k]
        if (w.istNull) return standard
        return w.planZahl ?: 0.0
    }

    private class PlanerFehler(val text: String) : Exception(text)

    /** planDriverShiftsWithOllama mit KI_PROVIDER 'cp_sat': erst der Planer-Server, bei Fehler die Heuristik. */
    suspend fun planen(
        drivers: List<PlanerZeile>, rides: List<PlanerZeile>, vehicles: List<PlanerZeile>, serviceDate: String,
        settings: PlanerZeile, demandProfile: List<Int>, fortschritt: (String) -> Unit,
    ): PlanerZeile {
        val bedarf = demandProfile.map { max(0, it) }
        fortschritt("Input: Fahrer=${drivers.size}, Fahrten=${rides.size}, BedarfSumme=${bedarf.sum()}.")
        val maxH = max(1.0, if (regel(settings, "maxWorkHours", 10.0) == 0.0) 10.0 else regel(settings, "maxWorkHours", 10.0))
        var minH = max(0.0, regel(settings, "minWorkHours", 4.0))
        val pauseH = max(0.0, regel(settings, "minPauseHours", 3.0))
        val puffer = max(0, regel(settings, "bufferMinutes", 20.0).toInt())
        val dauerRoh = regel(settings, "rideDurationMinutes", STANDARD_FAHRT_DAUER.toDouble()).toInt()
        val dauer = max(20, if (dauerRoh == 0) STANDARD_FAHRT_DAUER else dauerRoh)
        val modus = settings["mode"].planText.ifEmpty { "balanced" }
        val guete = max(0.0, regel(settings, "qualityGapPercent", 0.0))
        minH = min(maxH, minH)
        val normiert = JsonObject(
            mapOf(
                "maxWorkHours" to js(maxH), "minWorkHours" to js(minH), "minPauseHours" to js(pauseH),
                "bufferMinutes" to js(puffer), "rideDurationMinutes" to js(dauer), "mode" to js(modus),
                "qualityGapPercent" to js(guete),
                // Leerfahrten: "osrm" (Standard) oder "osrm_raum" (Faktor je Gegend/Tag/Stunde).
                "travelModel" to js(if (settings["travelModel"].planText == "osrm_raum") "osrm_raum" else "osrm"),
            )
        )
        val rueckfall = heuristik(drivers, rides, bedarf, (maxH * 60).toInt(), (minH * 60).toInt(), (pauseH * 60).toInt(), puffer, dauer)

        return try {
            // Ohne echte Fahrten: Bedarfsfahrten (hoechstens 3 je Stunde, 54 insgesamt).
            val synth = synthetisch(fahrtenNormal(rides, puffer, dauer), bedarf, puffer, dauer, jeStunde = 3, gesamt = 54)
                .map { f -> JsonObject(mapOf("id" to js(f.id), "ride_date" to js(serviceDate), "etd" to js(f.etd), "status" to js("open"))) }
            val fuerSolver = if (rides.isEmpty()) synth else rides
            if (rides.isEmpty() && synth.isNotEmpty()) fortschritt("Keine echten Fahrten. Erzeuge ${synth.size} Demand-Fahrten (CP-SAT-Cap aktiv).")
            fortschritt("Solver-Modus: CP-SAT aktiv.")
            fortschritt("Starte CP-SAT Optimierer ...")
            val koerper = JsonObject(
                mapOf(
                    "drivers" to JsonArray(drivers),
                    "rides" to JsonArray(mitEchtenFahrzeiten(fuerSolver)),
                    "vehicles" to JsonArray(vehicles),
                    "distances" to (distanzen["km"] ?: JsonObject(emptyMap())),
                    "travelMinutes" to (distanzen["minuten"] ?: JsonObject(emptyMap())),
                    "depot" to js(ZENTRALE),
                    "serviceDate" to js(serviceDate),
                    "settings" to normiert,
                    "demandProfile" to JsonArray(bedarf.map { js(it) }),
                )
            )
            fortschritt("Endpoint: $ENDPUNKT")
            fortschritt("Sende Anfrage an CP-SAT Planner ...")
            val (status, art, text) = withContext(Dispatchers.IO) { senden(koerper.toString()) }
            val inhalt = runCatching { planJson.parseToJsonElement(text) }.getOrNull()
            if (status !in 200..299) {
                throw PlanerFehler(inhalt.alsObjekt()?.get("error").planText.planOderNull ?: "CP-SAT Planner API Fehler ($status)")
            }
            val roh = inhalt.alsObjekt()
            if (roh == null) {
                val t = text.trim().lowercase()
                if (art.contains("text/html") || t.startsWith("<!doctype html>") || t.startsWith("<html")) {
                    throw PlanerFehler("Planner Endpoint liefert HTML statt JSON (Proxy/URL prüfen).")
                }
                throw PlanerFehler("Planner Endpoint liefert kein JSON.")
            }
            val vorschlaege = roh["suggestions"].alsListe() ?: emptyList()
            val plaene = roh["vehicle_plans"].alsListe() ?: emptyList()
            val quelle = roh["source"].planText.ifEmpty { "cp_sat" }
            fortschritt("Solver-Quelle bestätigt: $quelle.")
            fortschritt("CP-SAT Plan erstellt (Vorschläge: ${vorschlaege.size}).")
            if (plaene.isNotEmpty()) {
                val ev = plaene.count { it.alsObjekt()?.get("is_ev").alsWahr() == true }
                fortschritt("Fahrzeugplanung: ${plaene.size} Schichten mit Fahrzeug, davon $ev EV.")
            }
            JsonObject(
                mapOf(
                    "source" to js(quelle), "suggestions" to JsonArray(vorschlaege),
                    "warnings" to (roh["warnings"] ?: JsonArray(emptyList())),
                    "unassigned_ride_ids" to (roh["unassigned_ride_ids"] ?: JsonArray(emptyList())),
                    "kpis" to (roh["kpis"] ?: JsonNull), "vehicle_plans" to JsonArray(plaene),
                    "fleet_kpis" to (roh["fleet_kpis"] ?: JsonNull), "tunnel" to (roh["tunnel"] ?: JsonNull),
                    "engine" to (roh["engine"] ?: JsonNull),
                )
            )
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            val meldung = (e as? PlanerFehler)?.text ?: (e.message ?: e.toString())
            fortschritt("CP-SAT fehlgeschlagen: $meldung")
            fortschritt("Solver-Quelle gewechselt: heuristic (Fallback, BedarfSumme=${bedarf.sum()}).")
            JsonObject(rueckfall + ("source" to js("heuristic")))
        }
    }

    /** POST an den Planer. Gerechnet wird bis zur Guetevorgabe, nicht auf Zeit: grosszuegig warten. */
    private fun senden(koerper: String): Triple<Int, String, String> {
        val v = URL(ENDPUNKT).openConnection() as HttpURLConnection
        try {
            v.requestMethod = "POST"
            v.setRequestProperty("Content-Type", "application/json")
            v.connectTimeout = 30_000
            v.readTimeout = 900_000
            v.doOutput = true
            v.outputStream.use { it.write(koerper.toByteArray(Charsets.UTF_8)) }
            val status = v.responseCode
            val art = (v.contentType ?: "").lowercase()
            val strom = if (status in 200..299) v.inputStream else (v.errorStream ?: v.inputStream)
            val text = strom.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return Triple(status, art, text)
        } finally {
            v.disconnect()
        }
    }

    // MARK: Ergebnis -> Karten (mapPlannerSuggestions)

    fun vorschlaege(ergebnis: PlanerZeile, rides: List<PlanerZeile>, strategie: String, tag: String): List<EinsatzVorschlag> {
        val nachID = LinkedHashMap<String, PlanerZeile>()
        for (r in rides) if (!nachID.containsKey(r.text("id"))) nachID[r.text("id")] = r
        val plaene = mutableMapOf<String, PlanerZeile>()
        for (p in ergebnis["vehicle_plans"].alsListe() ?: emptyList()) {
            val o = p.alsObjekt() ?: continue
            if (o.text("driver_id").isNotEmpty()) plaene[o.text("driver_id")] = o
        }
        val eintraege = (ergebnis["suggestions"].alsListe() ?: emptyList()).mapNotNull { it.alsObjekt() }
            .filter { it.text("service_start").isNotEmpty() && it.text("service_end").isNotEmpty() }
        val bloecke = mutableMapOf<String, Int>()
        for (e in eintraege) if (e.text("driver_id").isNotEmpty()) bloecke[e.text("driver_id")] = (bloecke[e.text("driver_id")] ?: 0) + 1
        val engineFahrten = ergebnis["engine"].alsObjekt()?.get("fahrten").alsObjekt() ?: JsonObject(emptyMap())

        val liste = eintraege.mapIndexed { index, e ->
            val start = EinsatzUhr.normal(e.text("service_start"))
            val end = EinsatzUhr.normal(e.text("service_end"))
            val sMin = EinsatzUhr.minuten(start) ?: 0
            val eRoh = EinsatzUhr.minuten(end) ?: sMin
            val eMin = if (eRoh < sMin) eRoh + 1440 else eRoh
            val stundenRoh = max(0.0, (eMin - sMin) / 60.0)
            val stunden = rund(stundenRoh * 2) / 2
            val zugeteilt = (e["assigned_ride_ids"].alsListe() ?: emptyList()).mapNotNull { nachID[it.planText] }.map { r ->
                val ef = engineFahrten[r.text("id")].alsObjekt()
                val etd = EinsatzUhr.normal(r.text("etd"))
                val dauer = r.zahl("ext_route_duration_in_traffic_mins")?.takeIf { it != 0.0 }
                    ?: r.zahl("ext_route_duration_mins")?.takeIf { it != 0.0 }
                val anzeige = rund(dauer ?: (if (r.text("trip_type") == "airport") 55.0 else 25.0)).toInt()
                val etdMin = EinsatzUhr.minuten(etd)
                val meter = r.zahl("ext_route_distance_m") ?: 0.0
                val pax = r.zahl("passengers") ?: 0.0
                EinsatzFahrt(
                    etd = etd,
                    pickup = r.text("pickup_name").ifEmpty { r.text("pickup_address") },
                    dropoff = r.text("dropoff_name").ifEmpty { r.text("dropoff_address") },
                    adresseAb = r.text("pickup_address").ifEmpty { r.text("pickup_name") },
                    adresseZiel = r.text("dropoff_address").ifEmpty { r.text("dropoff_name") },
                    ankunft = etdMin?.let { EinsatzUhr.normal(EinsatzUhr.uhr(it + anzeige)) } ?: "",
                    passengers = if (pax == 0.0) 1.0 else pax,
                    km = if (meter > 0) meter / 1000 else (if (r.text("trip_type") == "airport") 40.0 else 12.0),
                    durationMinutes = dauer,
                    id = r.text("id"),
                    sammel = ef?.get("sammel").alsWahr() ?: false,
                    route = ef?.get("route").planText.planOderNull,
                    reserveMin = ef?.get("reserve_min").planZahl,
                )
            }.filter { it.etd.isNotEmpty() && it.pickup.isNotEmpty() && it.dropoff.isNotEmpty() }.sortedBy { it.etd }

            val stops = zugeteilt.take(3).map { "${it.etd} ${it.pickup} - ${it.dropoff}" }.toMutableList()
            if (zugeteilt.size > 3) stops += "+ ${zugeteilt.size - 3} weitere Fahrten"
            val fahrerID = e.text("driver_id")
            if (e.text("split_block") == "late") {
                stops.add(0, "Geteilter Dienst · Spätblock")
            } else if (fahrerID.isNotEmpty() && (bloecke[fahrerID] ?: 0) > 1) {
                stops.add(0, "Geteilter Dienst · Frühblock")
            }
            val plan = plaene[if (e.text("split_block") == "late") "$fahrerID#B" else fahrerID]
            val ladestopps = plan?.get("charge_stops").alsListe() ?: emptyList()
            EinsatzVorschlag(
                rides = zugeteilt,
                chargeStops = ladestopps,
                id = "$tag-$strategie-${fahrerID.ifEmpty { index.toString() }}-$start",
                dayIso = tag,
                driverId = fahrerID,
                name = e.text("driver_name").ifEmpty { "Fahrer ${index + 1}" },
                start = start, end = end,
                hours = stundenText(stunden),
                stops = stops, startMinutes = sMin, endMinutes = eMin,
                vehicleLabel = plan?.text("vehicle_label") ?: "",
                vehicleIsEv = plan?.get("is_ev").alsWahr() ?: (plan?.wahr("is_ev") ?: false),
                vehicleId = plan?.text("vehicle_id") ?: "",
                shiftKm = plan?.zahl("shift_km")?.let { rund(it).toInt() },
                chargeStopCount = ladestopps.size,
                rideIds = (e["assigned_ride_ids"].alsListe() ?: emptyList()).map { it.planText },
                minRangeReserveKm = plan?.zahl("min_range_reserve_km")?.let { rund(it).toInt() },
            )
        }
        return liste.sortedBy { it.startMinutes }
    }
}

/** 8 -> "8", 7.5 -> "7,5" */
internal fun stundenText(h: Double): String =
    if (h == rund(h)) h.toInt().toString() else String.format(java.util.Locale.ROOT, "%.1f", h).replace(".", ",")

// MARK: - Wallet (einsatzWallet.js)

internal data class EinsatzWallet(
    val start: String = "–", val ende: String = "–", val fahrer: String = "0", val kunden: String = "0",
    val schnitt: String = "0", val fahrten: String = "0", val km: String = "0", val co2: String = "0kg", val preis: String = "0€",
) {
    companion object {
        fun werte(vorschlaege: List<EinsatzVorschlag>): EinsatzWallet {
            if (vorschlaege.isEmpty()) return EinsatzWallet()
            val ids = mutableSetOf<String>()
            var kunden = 0.0
            var fahrten = 0
            var km = 0.0
            var co2 = 0.0
            var stunden = 0.0
            var startMin: Int? = null
            var endeMin: Int? = null
            for (v in vorschlaege) {
                ids += v.driverId.ifEmpty { v.id }
                fahrten += v.rides.size
                kunden += v.rides.sumOf { if (it.passengers == 0.0) 1.0 else it.passengers }
                val kmSchicht = v.shiftKm?.toDouble() ?: (v.rides.sumOf { it.km } * 1.3)
                km += kmSchicht
                co2 += kmSchicht * (if (v.vehicleIsEv) 0.075 else 0.195)
                stunden += max(0.0, (v.endMinutes - v.startMinutes) / 60.0)
                startMin = min(startMin ?: v.startMinutes, v.startMinutes)
                endeMin = max(endeMin ?: v.endMinutes, v.endMinutes)
            }
            val preis = (stunden * 28 + km * 0.45) * 1.19
            fun uhr(m: Int) = zwei((m / 60) % 24) + ":" + zwei(m % 60)
            return EinsatzWallet(
                start = "${uhr(startMin ?: 0)} Uhr", ende = "${uhr(endeMin ?: 0)} Uhr",
                fahrer = einsatzZahl(ids.size.toDouble()), kunden = einsatzZahl(kunden),
                schnitt = einsatzZahl(if (ids.isEmpty()) 0.0 else kunden / ids.size, 1),
                fahrten = einsatzZahl(fahrten.toDouble()), km = einsatzZahl(rund(km)),
                co2 = "${einsatzZahl(rund(co2))}kg", preis = "${einsatzZahl(rund(preis / 10) * 10)}€",
            )
        }
    }
}

// MARK: - Schichten vergeben (applyAiPlannerSuggestions aus AlleFahrer.jsx)

internal object EinsatzUebernahme {
    private val schemaSQL = """
        -- Falls noch nicht vorhanden:
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_activity_state TEXT DEFAULT 'frei';
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_date DATE;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_date DATE;
        ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;
        CREATE TABLE IF NOT EXISTS public.driver_service_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
          service_date DATE NOT NULL,
          service_start_time TIME,
          service_end_time TIME,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_by TEXT,
          refusal_reason TEXT,
          responded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """.trimIndent()

    private const val KENNUNG = "admin-app-ai-planner"

    @Serializable private data class FahrerID(val driver_id: String? = null)
    @Serializable private data class JobID(val id: String? = null)

    private suspend fun <T> versuch(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException) throw e
        Result.failure(e)
    }

    /**
     * Ersetzt die Planung des Tages: alte Planer-Anfragen weg, neue Anfragen, Profile, Fahrten.
     * Rueckgabe: null = ok, sonst die Fehlermeldung.
     */
    suspend fun anwenden(tag: String, zeilen: List<EinsatzDienstZeile>, leerErlaubt: Boolean = false): String? {
        val ziel = zeilen.map { z ->
            EinsatzDienstZeile(
                driverId = z.driverId.trim(),
                serviceStart = PlanDienstzeit.normal(z.serviceStart), serviceEnd = PlanDienstzeit.normal(z.serviceEnd),
                rideIds = z.rideIds.map { it.trim() }.filter { it.isNotEmpty() },
                vehicleId = z.vehicleId.trim(),
            )
        }.filter { it.driverId.isNotEmpty() && it.serviceStart.isNotEmpty() && it.serviceEnd.isNotEmpty() }
        if (ziel.isEmpty() && !leerErlaubt) return "Keine gültigen Vorschläge ausgewählt."
        if (!Regex("""\d{4}-\d{2}-\d{2}""").matches(tag)) return "Bitte ein gültiges Datum wählen."

        val db = Backend.client
        val jetzt = js(Instant.now().toString())
        val abgebrochen = JsonObject(mapOf("status" to js("cancelled"), "updated_at" to jetzt))
        val fahrerIDs = ziel.map { it.driverId }.distinct()
        val frueher = versuch {
            db.from("driver_service_requests").select(Columns.raw("driver_id")) {
                filter { eq("service_date", tag); eq("requested_by", KENNUNG) }
            }.decodeList<FahrerID>()
        }.getOrDefault(emptyList())
        val frueherIDs = frueher.mapNotNull { it.driver_id?.trim() }.filter { it.isNotEmpty() }.distinct()

        versuch { db.from("driver_service_requests").delete { filter { eq("service_date", tag); eq("requested_by", KENNUNG) } } }
            .onFailure {
                versuch {
                    db.from("driver_service_requests").update(abgebrochen) { filter { eq("service_date", tag); eq("requested_by", KENNUNG) } }
                }.onFailure { f -> return dbMeldung(f).planOderNull ?: "Vorherige KI-Planung konnte nicht überschrieben werden." }
            }

        if (fahrerIDs.isNotEmpty()) {
            versuch { db.from("driver_service_requests").delete { filter { eq("service_date", tag); isIn("driver_id", fahrerIDs) } } }
                .onFailure {
                    versuch {
                        db.from("driver_service_requests").update(abgebrochen) { filter { eq("service_date", tag); isIn("driver_id", fahrerIDs) } }
                    }.onFailure { f -> return dbMeldung(f).planOderNull ?: "Vorherige Planung konnte nicht überschrieben werden." }
                }
        }

        val anfragen = ziel.map {
            JsonObject(
                mapOf(
                    "driver_id" to js(it.driverId), "service_date" to js(tag), "service_start_time" to js(it.serviceStart),
                    "service_end_time" to js(it.serviceEnd), "status" to js("pending"), "requested_by" to js(KENNUNG),
                )
            )
        }
        if (anfragen.isNotEmpty()) {
            versuch { db.from("driver_service_requests").insert(anfragen) }.onFailure { f ->
                val m = dbMeldung(f)
                if (Regex("service_start_time|service_end_time|service_date|driver_service_requests", RegexOption.IGNORE_CASE).containsMatchIn(m)) {
                    return "DB-Schema unvollständig. Bitte ausführen:\n$schemaSQL"
                }
                return m.planOderNull ?: "Dienstplan-Anfragen konnten nicht gespeichert werden."
            }
        }

        for (z in ziel) {
            val voll = JsonObject(
                mapOf(
                    "service_start_time" to js(z.serviceStart), "service_end_time" to js(z.serviceEnd),
                    "service_start_date" to js(tag), "service_end_date" to js(tag),
                )
            )
            val kurz = JsonObject(mapOf("service_start_time" to js(z.serviceStart), "service_end_time" to js(z.serviceEnd)))
            versuch { db.from("profiles").update(voll) { filter { eq("id", z.driverId) } } }.onFailure {
                versuch { db.from("profiles").update(kurz) { filter { eq("id", z.driverId) } } }
                    .onFailure { f -> return dbMeldung(f).planOderNull ?: "Fahrerprofil konnte nicht aktualisiert werden." }
            }
        }

        val veraltet = frueherIDs.filter { it !in fahrerIDs }
        if (veraltet.isNotEmpty()) {
            val voll = JsonObject(
                mapOf("service_start_time" to JsonNull, "service_end_time" to JsonNull, "service_start_date" to JsonNull, "service_end_date" to JsonNull)
            )
            val kurz = JsonObject(mapOf("service_start_time" to JsonNull, "service_end_time" to JsonNull))
            versuch { db.from("profiles").update(voll) { filter { isIn("id", veraltet) } } }.onFailure {
                versuch { db.from("profiles").update(kurz) { filter { isIn("id", veraltet) } } }
                    .onFailure { f -> return dbMeldung(f).planOderNull ?: "Vorherige Fahrerzeiten konnten nicht zurückgesetzt werden." }
            }
        }

        // Fahrten an Fahrer und Fahrzeug vergeben; fruehere Vergaben des Planers, die nicht
        // mehr im Plan stehen, wieder oeffnen.
        val geplant = ziel.flatMap { it.rideIds }.toSet()
        val alt = versuch {
            db.from("jobs").select(Columns.raw("id")) { filter { eq("ride_date", tag); eq("assigned_by", "trisar-engine") } }.decodeList<JobID>()
        }.getOrDefault(emptyList())
        val oeffnen = alt.mapNotNull { it.id }.filter { it.isNotEmpty() && it !in geplant }
        if (oeffnen.isNotEmpty()) {
            val offen = JsonObject(mapOf("driver_id" to JsonNull, "vehicle_id" to JsonNull, "status" to js("pending"), "assigned_by" to JsonNull))
            versuch { db.from("jobs").update(offen) { filter { isIn("id", oeffnen) } } }
        }
        for (z in ziel) {
            if (z.rideIds.isEmpty()) continue
            val vergabe = mutableMapOf<String, JsonElement>("driver_id" to js(z.driverId), "status" to js("assigned"), "assigned_by" to js("trisar-engine"))
            if (z.vehicleId.isNotEmpty()) vergabe["vehicle_id"] = js(z.vehicleId)
            versuch { db.from("jobs").update(JsonObject(vergabe)) { filter { isIn("id", z.rideIds) } } }
                .onFailure { f -> return dbMeldung(f).planOderNull ?: "KI-Plan konnte nicht gespeichert werden." }
        }
        return null
    }
}
