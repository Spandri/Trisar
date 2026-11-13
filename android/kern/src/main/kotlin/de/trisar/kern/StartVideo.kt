package de.trisar.kern

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay

/**
 * Startvideo 1:1 wie BootSplashGate in main.jsx (Web) und StartVideo.swift (iOS):
 * startvideo.mp4 (= loadScreen.mp4), bildfuellend, stumm, danach direkt die App.
 * Nur beim Kaltstart (neuer Prozess): das Flag liegt im Prozess, nicht in der Aktivitaet,
 * daher kein erneuter Ablauf beim Drehen oder Zurueckholen aus dem Hintergrund.
 * Nahtlos: unter dem Video liegt sein erstes Bild (startbild.jpg), der Spieler wird schon in
 * onCreate vorbereitet ([vorbereiten]), das Video zeichnet ueber die TextureView-Oberflaeche.
 */
object StartVideo {
    @Volatile var gezeigt = false
    const val HOECHSTENS_MS = 6000L
    private var spieler: MediaPlayer? = null

    /** So frueh wie moeglich aufrufen (onCreate): Datei oeffnen und dekodieren, noch ohne Abspielen. */
    fun vorbereiten(ctx: Context) {
        if (gezeigt || spieler != null) return
        spieler = runCatching { MediaPlayer.create(ctx, R.raw.startvideo) }.getOrNull()?.apply {
            // Stumm und ohne Audiofokus: laufende Musik oder Navigation bleibt.
            setVolume(0f, 0f)
        }
    }

    internal fun nehmen(ctx: Context): MediaPlayer? {
        vorbereiten(ctx)
        return spieler
    }

    internal fun freigeben() {
        spieler?.runCatching { stop(); release() }
        spieler = null
    }
}

/** Legt das Startvideo ueber [inhalt], solange es laeuft. */
@Composable
fun StartVideoTor(inhalt: @Composable () -> Unit) {
    var sichtbar by remember { mutableStateOf(!StartVideo.gezeigt) }
    val fertig = {
        if (sichtbar) {
            StartVideo.gezeigt = true
            sichtbar = false
            StartVideo.freigeben()
        }
    }
    Box(Modifier.fillMaxSize()) {
        inhalt()
        if (sichtbar) {
            LaunchedEffect(Unit) {
                delay(StartVideo.HOECHSTENS_MS)
                fertig()
            }
            // Erstes Bild des Videos, bis das Video zeichnet.
            Image(
                painter = painterResource(R.drawable.startbild),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().background(Color.Black),
            )
            StartVideoFlaeche(fertig)
        }
    }
}

@Composable
private fun StartVideoFlaeche(fertig: () -> Unit) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            TextureView(ctx).apply {
                // Durchsichtig bis zum ersten Frame, darunter liegt das Startbild.
                isOpaque = false
                surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
                        val mp = StartVideo.nehmen(ctx)
                        if (mp == null) { fertig(); return }
                        mp.setSurface(Surface(st))
                        mp.setOnCompletionListener { fertig() }
                        mp.setOnErrorListener { _, _, _ -> fertig(); true }
                        bildfuellend(this@apply, mp.videoWidth, mp.videoHeight)
                        mp.start()
                    }
                    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {
                        StartVideo.nehmen(ctx)?.let { bildfuellend(this@apply, it.videoWidth, it.videoHeight) }
                    }
                    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean = true
                    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                }
            }
        },
    )
}

/** Wie object-fit: cover: Video mittig auf die Flaeche skalieren, Ueberstand abschneiden. */
private fun bildfuellend(ansicht: TextureView, vb: Int, vh: Int) {
    val b = ansicht.width.toFloat()
    val h = ansicht.height.toFloat()
    if (vb <= 0 || vh <= 0 || b <= 0f || h <= 0f) return
    val faktor = maxOf(b / vb, h / vh)
    val m = Matrix()
    // TextureView streckt das Video zuerst auf die volle Flaeche, daher relativ dazu skalieren.
    m.setScale(vb * faktor / b, vh * faktor / h, b / 2f, h / 2f)
    ansicht.setTransform(m)
}
