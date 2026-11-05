plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "de.trisar.kern"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val compose = platform("androidx.compose:compose-bom:2024.12.01")
    api(compose)
    api("androidx.compose.ui:ui")
    api("androidx.compose.foundation:foundation")
    api("androidx.compose.material3:material3")
    api("androidx.activity:activity-compose:1.9.3")
    api("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    api("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Gleiche Datenbank wie Web und iOS (Supabase hinter fahrer.trisar.de/supabase).
    api(platform("io.github.jan-tennert.supabase:bom:3.0.3"))
    api("io.github.jan-tennert.supabase:postgrest-kt")
    api("io.github.jan-tennert.supabase:auth-kt")
    api("io.github.jan-tennert.supabase:realtime-kt")
    api("io.github.jan-tennert.supabase:functions-kt")
    api("io.ktor:ktor-client-okhttp:3.0.3")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Icons aus public/icon als SVG, Bilder per URL.
    api("io.coil-kt.coil3:coil-compose:3.0.4")
    api("io.coil-kt.coil3:coil-svg:3.0.4")
    api("io.coil-kt.coil3:coil-network-okhttp:3.0.4")

    // Karte wie iOS: MapLibre mit CARTO Dark Matter.
    api("org.maplibre.gl:android-sdk:11.7.1")
    // Standort.
    api("com.google.android.gms:play-services-location:21.3.0")
}
