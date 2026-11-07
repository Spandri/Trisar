import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Firebase-Werte fuer Push aus push-schluessel/google-services.json (nicht im Git).
// Fehlt die Datei, baut die App ohne Push.
fun firebaseWert(paket: String): Map<String, String> {
    val datei = rootProject.file("../push-schluessel/google-services.json")
    if (!datei.exists()) return emptyMap()
    @Suppress("UNCHECKED_CAST")
    val json = groovy.json.JsonSlurper().parse(datei) as Map<String, Any?>
    val projekt = json["project_info"] as Map<String, Any?>
    @Suppress("UNCHECKED_CAST")
    val kunde = (json["client"] as List<Map<String, Any?>>).firstOrNull {
        ((it["client_info"] as Map<String, Any?>)["android_client_info"] as Map<String, Any?>)["package_name"] == paket
    } ?: return emptyMap()
    @Suppress("UNCHECKED_CAST")
    return mapOf(
        "APP_ID" to ((kunde["client_info"] as Map<String, Any?>)["mobilesdk_app_id"] as String),
        "API_KEY" to (((kunde["api_key"] as List<Map<String, Any?>>).first())["current_key"] as String),
        "PROJEKT" to (projekt["project_id"] as String),
        "SENDER" to (projekt["project_number"] as String),
    )
}

android {
    namespace = "de.trisar.dispo"
    compileSdk = 35
    defaultConfig {
        applicationId = "de.trisar.dispo"
        val fb = firebaseWert("de.trisar.dispo")
        listOf("APP_ID", "API_KEY", "PROJEKT", "SENDER").forEach {
            buildConfigField("String", "FIREBASE_$it", "\"${fb[it] ?: ""}\"")
        }
        minSdk = 26
        targetSdk = 35
        versionCode = 17
        versionName = "0.1.16"
    }
    // Eigener Release-Schluessel in android/signatur/ (nicht im Git, sicher aufbewahren).
    // Fehlt er, wird mit dem Debug-Schluessel signiert.
    val releaseDatei = rootProject.file("signatur/release.properties")
    signingConfigs {
        if (releaseDatei.exists()) {
            val p = Properties().apply { releaseDatei.inputStream().use { load(it) } }
            create("release") {
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation(project(":kern"))
}
