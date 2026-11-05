package de.trisar.dispo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import de.trisar.kern.Anmeldung
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.LoginSeite
import de.trisar.kern.WebMassstab
import de.trisar.kern.Zustand
import de.trisar.kern.grotesk
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.Serializable

/** Einstieg der Dispo-App, wie TrisarDispoApp in iOS. Zugang nur fuer Dispo-Konten. */
class HauptAktivitaet : ComponentActivity() {
    private val anmeldung: Anmeldung by lazy {
        ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                Anmeldung({ DispoZugang.erlaubt(it) }, "Dieses Konto hat keinen Zugang zur Disposition.") as T
        })[Anmeldung::class.java]
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WebMassstab {
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    val zustand by anmeldung.zustand.collectAsState()
                    when (zustand) {
                        Zustand.Pruefe -> Box(Modifier.fillMaxSize().background(Color.Black))
                        Zustand.Abgemeldet -> LoginSeite(anmeldung) { DispoHintergrund() }
                        is Zustand.Angemeldet -> Box(Modifier.fillMaxSize()) {
                            DispoHintergrund()
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text("Dispo angemeldet. Abmelden", style = grotesk(20f), modifier = Modifier.tippen { anmeldung.abmelden() })
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Wie AnmeldeTor.jsx: is_dispo oder Rolle dispo/dispatcher/admin/koordinator. */
object DispoZugang {
    private val rollen = setOf("dispo", "dispatcher", "admin", "koordinator", "coordinator")
    @Serializable private data class Zeile(val role: String? = null, val is_dispo: Boolean? = null)

    suspend fun erlaubt(id: String): Boolean = runCatching {
        val z = Backend.client.from("profiles").select(Columns.raw("role,is_dispo")) {
            filter { eq("id", id) }; limit(1)
        }.decodeList<Zeile>().firstOrNull() ?: return false
        z.is_dispo == true || (z.role ?: "").lowercase() in rollen
    }.getOrDefault(false)
}
