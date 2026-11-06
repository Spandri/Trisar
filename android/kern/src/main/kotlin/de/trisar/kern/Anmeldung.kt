package de.trisar.kern

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import io.ktor.client.statement.bodyAsText
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

@Serializable
data class FahrerProfil(
    val id: String,
    val first_name: String? = null,
    val last_name: String? = null,
    val tracking_mode: String? = null,
) {
    val nutztOBD get() = tracking_mode == "obd"
    val vorname get() = first_name.orEmpty()
}

sealed interface Zustand {
    data object Pruefe : Zustand
    data object Abgemeldet : Zustand
    data class Angemeldet(val id: String) : Zustand
}

/**
 * Anmeldestatus wie Anmeldung in iOS. Gleiches Konto wie im Web (Benutzername oder E-Mail + Passwort).
 * zugang: optional nur bestimmte Konten (Dispo: Rolle dispo/admin/koordinator).
 */
class Anmeldung(
    private val zugang: (suspend (String) -> Boolean)? = null,
    private val zugangVerweigert: String = "",
) : ViewModel() {
    val zustand = MutableStateFlow<Zustand>(Zustand.Pruefe)
    val profil = MutableStateFlow<FahrerProfil?>(null)
    val fehler = MutableStateFlow<String?>(null)
    val arbeitet = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            Backend.client.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> {
                        val id = status.session.user?.id ?: return@collect
                        val z = zugang
                        if (z != null && !z(id)) {
                            Backend.client.auth.signOut(SignOutScope.LOCAL)
                            fehler.value = zugangVerweigert
                            zustand.value = Zustand.Abgemeldet
                            return@collect
                        }
                        if ((zustand.value as? Zustand.Angemeldet)?.id != id) zustand.value = Zustand.Angemeldet(id)
                        profilLaden()
                    }
                    is SessionStatus.NotAuthenticated -> { zustand.value = Zustand.Abgemeldet; profil.value = null }
                    is SessionStatus.RefreshFailure -> { /* bleibt angemeldet, naechster Versuch automatisch */ }
                    // Beim Zurueckkehren in die App (z. B. aus der Dateiauswahl) prueft die Bibliothek die
                    // Sitzung kurz neu. Eine bestehende Anmeldung bleibt dabei stehen, sonst wuerde die
                    // ganze Oberflaeche neu aufgebaut und landete auf der Startseite.
                    is SessionStatus.Initializing -> if (zustand.value !is Zustand.Angemeldet) zustand.value = Zustand.Pruefe
                }
            }
        }
    }

    val fahrerID: String? get() = (zustand.value as? Zustand.Angemeldet)?.id

    /** kennung: Benutzername oder E-Mail. Mit '@' direkt bei Supabase, sonst ueber die Funktion `anmelden`. */
    fun anmelden(kennung: String, passwort: String, fertig: () -> Unit = {}) {
        val k = kennung.trim().lowercase()
        if (k.isEmpty() || passwort.isEmpty()) { fehler.value = "Bitte Benutzername oder E-Mail und Passwort eingeben."; return }
        arbeitet.value = true
        fehler.value = null
        viewModelScope.launch {
            try {
                if ('@' in k) {
                    Backend.client.auth.signInWith(Email) { this.email = k; this.password = passwort }
                } else {
                    mitBenutzername(k, passwort)
                }
                fertig()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fehler.value = lesbar(e)
            } finally {
                arbeitet.value = false
            }
        }
    }

    /**
     * Der Server loest den Benutzernamen in die E-Mail auf und liefert die fertige Sitzung.
     * Falsche Daten kommen als HTTP 400 mit invalid_credentials, invoke wirft dann.
     */
    private suspend fun mitBenutzername(name: String, passwort: String) {
        val koerper = buildJsonObject { put("kennung", name); put("passwort", passwort) }
        val text = Backend.client.functions.invoke("anmelden", body = koerper).bodyAsText()
        val d = Backend.json.parseToJsonElement(text).jsonObject
        fun feld(n: String) = (d[n] as? JsonPrimitive)?.content?.takeIf { it != "null" }.orEmpty()
        val zugang = feld("access_token")
        val erneuern = feld("refresh_token")
        if (zugang.isEmpty() || erneuern.isEmpty()) throw IllegalStateException("invalid_credentials")
        // Nutzer vorher holen, damit sessionStatus gleich mit user.id kommt (Zustand.Angemeldet braucht sie).
        val nutzer = runCatching { Backend.client.auth.retrieveUser(zugang) }.getOrNull()
        Backend.client.auth.importSession(
            UserSession(
                accessToken = zugang,
                refreshToken = erneuern,
                expiresIn = feld("expires_in").toLongOrNull() ?: 3600L,
                tokenType = feld("token_type").ifEmpty { "bearer" },
                user = nutzer,
            )
        )
        if (nutzer == null) Backend.client.auth.retrieveUserForCurrentSession(updateSession = true)
    }

    fun abmelden() {
        // Nur dieses Geraet abmelden, sonst fliegt auch die Dispo-Sitzung desselben Kontos raus.
        viewModelScope.launch {
            // Erst das Geraet fuer Mitteilungen austragen, solange die Sitzung noch gilt.
            Push.abmelden()
            runCatching { Backend.client.auth.signOut(SignOutScope.LOCAL) }
            zustand.value = Zustand.Abgemeldet
            profil.value = null
        }
    }

    fun passwortVergessen(email: String, hinweis: (String) -> Unit) {
        val mail = email.trim().lowercase()
        if (mail.isEmpty()) { fehler.value = "Bitte zuerst deine E-Mail eintragen."; return }
        // Der Link geht nur an eine E-Mail, ein Benutzername reicht dafuer nicht.
        if ('@' !in mail) { fehler.value = "Zum Zurücksetzen bitte deine E-Mail eintragen, nicht den Benutzernamen."; return }
        fehler.value = null
        viewModelScope.launch {
            // Direkt per REST statt resetPasswordForEmail: ein PKCE-Link liesse sich im Browser
            // nicht einloesen (Schluessel liegt nur in der App), man landete auf dem Login.
            runCatching {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val url = java.net.URL(Konfig.SUPABASE_URL + "/auth/v1/recover?redirect_to=" +
                        java.net.URLEncoder.encode("https://fahrer.trisar.de", "UTF-8"))
                    val verbindung = url.openConnection() as java.net.HttpURLConnection
                    verbindung.requestMethod = "POST"
                    verbindung.doOutput = true
                    verbindung.setRequestProperty("Content-Type", "application/json")
                    verbindung.setRequestProperty("apikey", Konfig.SUPABASE_KEY)
                    verbindung.outputStream.use { it.write(buildJsonObject { put("email", mail) }.toString().toByteArray()) }
                    verbindung.responseCode
                    verbindung.disconnect()
                }
            }
            hinweis("Wenn die E-Mail bekannt ist, kommt gleich ein Link zum Zurücksetzen.")
        }
    }

    suspend fun profilLaden() {
        val id = fahrerID ?: return
        runCatching {
            Backend.client.from("profiles").select(io.github.jan.supabase.postgrest.query.Columns.raw("id,first_name,last_name,tracking_mode")) {
                filter { eq("id", id) }
                limit(1)
            }.decodeList<FahrerProfil>().firstOrNull()
        }.onSuccess { profil.value = it }
    }

    private fun lesbar(e: Exception): String {
        var t = e.toString().lowercase()
        if (e is RestException) t += " " + e.error.lowercase()
        return when {
            "invalid login" in t || "invalid_credentials" in t -> "Benutzername, E-Mail oder Passwort stimmt nicht."
            "unable to resolve" in t || "timeout" in t || "network" in t -> "Keine Verbindung. Bitte Internet prüfen."
            else -> "Anmeldung fehlgeschlagen: ${e.message}"
        }
    }
}

