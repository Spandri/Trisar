package de.trisar.kern

/** Feste Werte, gleiche Datenbank wie Web und iOS. */
object Konfig {
    /** Supabase hinter dem Tunnel, gleicher Weg wie die Web-App (`/supabase`). */
    const val SUPABASE_URL = "https://fahrer.trisar.de/supabase"
    /** Oeffentlicher Schluessel (publishable). Zugriff regeln die Regeln in der Datenbank. */
    const val SUPABASE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

    /** Wie die Web-App: Live-Standort alle 5 s, Verlauf alle 15 s, Profil alle 60 s. */
    const val LIVE_INTERVALL_MS = 5_000L
    const val VERLAUF_INTERVALL_MS = 15_000L
    const val PROFIL_INTERVALL_MS = 60_000L

    /** Kennung in `source`, damit man in der Datenbank sieht, woher der Punkt kommt. */
    const val QUELLE = "android_app"

    /** Karte wie iOS und Web: CARTO Dark Matter. */
    const val KARTEN_STIL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
}
