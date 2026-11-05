package de.trisar.kern

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

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
 * Anmeldestatus wie Anmeldung in iOS. Gleiches Konto wie im Web (E-Mail + Passwort).
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
                        zustand.value = Zustand.Angemeldet(id)
                        profilLaden()
                    }
                    is SessionStatus.NotAuthenticated -> { zustand.value = Zustand.Abgemeldet; profil.value = null }
                    is SessionStatus.RefreshFailure -> { /* bleibt angemeldet, naechster Versuch automatisch */ }
                    is SessionStatus.Initializing -> zustand.value = Zustand.Pruefe
                }
            }
        }
    }

    val fahrerID: String? get() = (zustand.value as? Zustand.Angemeldet)?.id

    fun anmelden(email: String, passwort: String, fertig: () -> Unit = {}) {
        val mail = email.trim().lowercase()
        if (mail.isEmpty() || passwort.isEmpty()) { fehler.value = "Bitte E-Mail und Passwort eingeben."; return }
        arbeitet.value = true
        fehler.value = null
        viewModelScope.launch {
            try {
                Backend.client.auth.signInWith(Email) { this.email = mail; this.password = passwort }
                fertig()
            } catch (e: Exception) {
                fehler.value = lesbar(e)
            } finally {
                arbeitet.value = false
            }
        }
    }

    fun abmelden() {
        // Nur dieses Geraet abmelden, sonst fliegt auch die Dispo-Sitzung desselben Kontos raus.
        viewModelScope.launch {
            runCatching { Backend.client.auth.signOut(SignOutScope.LOCAL) }
            zustand.value = Zustand.Abgemeldet
            profil.value = null
        }
    }

    fun passwortVergessen(email: String, hinweis: (String) -> Unit) {
        val mail = email.trim().lowercase()
        if (mail.isEmpty()) { fehler.value = "Bitte zuerst deine E-Mail eintragen."; return }
        fehler.value = null
        viewModelScope.launch {
            runCatching { Backend.client.auth.resetPasswordForEmail(mail, redirectUrl = "https://fahrer.trisar.de") }
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
        val t = e.toString().lowercase()
        return when {
            "invalid login" in t || "invalid_credentials" in t -> "E-Mail oder Passwort stimmt nicht."
            "unable to resolve" in t || "timeout" in t || "network" in t -> "Keine Verbindung. Bitte Internet prüfen."
            else -> "Anmeldung fehlgeschlagen: ${e.message}"
        }
    }
}

