package de.trisar.dispo.karte

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import io.github.jan.supabase.postgrest.postgrest
import okhttp3.OkHttpClient
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.module.http.HttpRequestUtil
import java.net.URLEncoder

/**
 * Kartenstil (17.11., wie kartenStil.js im Web und KartenStil.swift): Dunkel (Carto Dark Matter,
 * Standard), Hell (Carto Positron), Farbig (Carto Voyager), Satellit (Esri World Imagery mit
 * Strassennamen). Umschalten im Karten Filter, je Geraet gemerkt. Offene Karten wechseln sofort
 * (StilFolgen). Satellit braucht den Esri-Schluessel (RPC karten_schluessel, nur Dispo), ohne ihn
 * gibt es den Knopf nicht. Esri erlaubt den Schluessel nur fuer *.trisar.de, deshalb geht diese
 * Adresse als Referer mit. Auf hellen Stilen bekommen die Zeichen einen weissen Rand.
 */
internal object KartenStil {
    enum class Art(val name_: String) { DUNKEL("Dunkel"), HELL("Hell"), FARBIG("Farbig"), SATELLIT("Satellit") }

    val STANDARD = Art.DUNKEL
    private const val SCHLUESSEL = "karten_stil"
    private const val SPEICHER_GELEERT = "esri_speicher_geleert_1"
    private const val ESRI = "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery"
    private val CARTO = mapOf(
        Art.DUNKEL to "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        Art.HELL to "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        Art.FARBIG to "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    )

    private var ablage: android.content.SharedPreferences? = null
    var art by mutableStateOf(STANDARD)
        private set
    var esri by mutableStateOf<String?>(null)
        private set
    private var holt = false
    /** Esri-Stil, korrigiert (esriStilHolen). Erst damit gibt es den Satellit. */
    var satellitJson by mutableStateOf<String?>(null)
        private set

    init {
        // Referer fuer alle Kartenanfragen, sonst lehnt Esri den Web-Schluessel ab. Carto stoert das nicht.
        HttpRequestUtil.setOkHttpClient(
            OkHttpClient.Builder().addInterceptor { kette ->
                kette.proceed(kette.request().newBuilder().header("Referer", "https://dispo.trisar.de/").build())
            }.build(),
        )
    }

    fun laden(ctx: android.content.Context) {
        if (ablage != null) return
        val a = ctx.applicationContext.getSharedPreferences("trisar-dispo-karte", android.content.Context.MODE_PRIVATE)
        ablage = a
        art = Art.entries.firstOrNull { it.name == a.getString(SCHLUESSEL, null) } ?: STANDARD
        // Einmal den Kartenspeicher leeren: Er hielt Esris Antworten "Token Required" von vorher fest,
        // MapLibre fragte darum gar nicht neu nach (17.11.).
        if (!a.getBoolean(SPEICHER_GELEERT, false)) {
            org.maplibre.android.offline.OfflineManager.getInstance(ctx.applicationContext).clearAmbientCache(
                object : org.maplibre.android.offline.OfflineManager.FileSourceCallback {
                    override fun onSuccess() { a.edit().putBoolean(SPEICHER_GELEERT, true).apply() }
                    override fun onError(message: String) {}
                },
            )
        }
    }

    fun setzen(neu: Art) {
        art = neu
        ablage?.edit()?.putString(SCHLUESSEL, neu.name)?.apply()
    }

    val satellitMoeglich: Boolean get() = satellitJson != null
    /** Satellit ohne Schluessel faellt auf Dunkel zurueck. */
    val wirksam: Art get() = if (art == Art.SATELLIT && satellitJson == null) STANDARD else art
    val istHell: Boolean get() = wirksam != Art.DUNKEL

    val url: String
        get() {
            return if (wirksam == Art.SATELLIT) {
                // Kennung fuer StilFolgen, geladen wird satellitJson (stilSetzen)
                "esri-satellit"
            } else {
                CARTO[wirksam] ?: CARTO.getValue(Art.DUNKEL)
            }
        }

    suspend fun schluesselLaden() {
        if (esri != null || holt) return
        holt = true
        try {
            val text = de.trisar.kern.Backend.client.postgrest.rpc("karten_schluessel").data
            val wert = text.trim().removeSurrounding("\"")
            if (wert.isNotEmpty() && wert != "null") {
                esri = wert
                satellitJson = esriStilHolen(wert)
            }
        } catch (_: Exception) {
        } finally {
            holt = false
        }
    }

    // Zuletzt angeforderter Stil je Karte, damit StilFolgen nicht doppelt laedt.
    internal val angefordert = java.util.WeakHashMap<MapLibreMap, String>()

    /** Stil laden (statt m.setStyle(Konfig.KARTEN_STIL)). geladen zeichnet Linien und Kreise neu. */
    fun stilSetzen(m: MapLibreMap, geladen: (Style) -> Unit) {
        val u = url
        angefordert[m] = u
        val json = satellitJson
        val stil = if (wirksam == Art.SATELLIT && json != null) Style.Builder().fromJson(json) else Style.Builder().fromUri(u)
        m.setStyle(stil) { geladen(it) }
    }

    /**
     * Esri (17.11.): Im Satelliten-Stil haben die Quellen eine Kachel-Liste (tiles, mit Schluessel) UND eine url
     * auf den ArcGIS-Dienst. Mit url holt MapLibre dort ein Kachelverzeichnis, bekommt aber Esris eigenes Format
     * ohne Kacheln und laedt nichts. Darum den Stil selbst holen und url entfernen, wo tiles da ist.
     */
    private suspend fun esriStilHolen(schluessel: String): String? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        runCatching {
            val adresse = "$ESRI?token=${URLEncoder.encode(schluessel, "UTF-8")}&language=de"
            val anfrage = okhttp3.Request.Builder().url(adresse).header("Referer", "https://dispo.trisar.de/").build()
            OkHttpClient().newCall(anfrage).execute().use { antwort ->
                if (!antwort.isSuccessful) return@use null
                val stil = org.json.JSONObject(antwort.body?.string() ?: return@use null)
                val quellen = stil.optJSONObject("sources") ?: return@use null
                for (name in quellen.keys()) {
                    val q = quellen.optJSONObject(name) ?: continue
                    if ((q.optJSONArray("tiles")?.length() ?: 0) > 0) q.remove("url")
                }
                stil.toString()
            }
        }.getOrNull()
    }
}

/** Haengt eine offene Karte an den Kartenstil: anderer Stil im Filter laedt sofort neu. */
@Composable
internal fun StilFolgen(karte: MapLibreMap?, geladen: (Style) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    KartenStil.laden(ctx)
    LaunchedEffect(Unit) { KartenStil.schluesselLaden() }
    val u = KartenStil.url
    val rueckruf by rememberUpdatedState(geladen)
    LaunchedEffect(karte, u) {
        val m = karte ?: return@LaunchedEffect
        if (KartenStil.angefordert[m] == u) return@LaunchedEffect
        KartenStil.stilSetzen(m) { rueckruf(it) }
    }
}
