package de.trisar.kern

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import kotlinx.serialization.json.Json

/** Ein Supabase-Client fuer die ganze App (wie Backend.client in iOS). */
object Backend {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    val client by lazy {
        createSupabaseClient(Konfig.SUPABASE_URL, Konfig.SUPABASE_KEY) {
            install(Auth)
            install(Postgrest)
            install(Realtime)
            install(Functions)
        }
    }
}
