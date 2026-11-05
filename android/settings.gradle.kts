pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "trisar-android"
// kern: gemeinsame Teile (Datenbank, Raster 402, Stil, Schrift, Icons, Login).
include(":kern", ":fahrer", ":dispo")
