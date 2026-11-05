package de.trisar.dispo.stamm

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.exceptions.RestException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Gemeinsame Bausteine der Stammdaten-Seiten (StammBausteine.swift) und kleine Hilfen.

internal val LIME = hex(0xE3F654)

/** Lesbare Fehlermeldung wie `error.message` im Web (dbMeldung). */
internal fun dbMeldung(e: Throwable): String = (e as? RestException)?.error ?: e.message ?: e.toString()

// MARK: JSON-Zeilen (select('*') wie im Web, Spalten koennen fehlen)

/** Wie `String(row?.x || '').trim()`. */
internal fun JsonObject.text(k: String): String = when (val w = this[k]) {
    null, is JsonNull -> ""
    is JsonPrimitive -> if (w.isString) w.content.trim() else {
        val b = w.booleanOrNull
        val d = w.doubleOrNull
        when {
            b != null -> if (b) "true" else ""
            d != null && d == Math.rint(d) -> d.toLong().toString()
            else -> w.content
        }
    }
    else -> ""
}

/** Zahl oder null (Number.parseFloat). */
internal fun JsonObject.zahl(k: String): Double? = when (val w = this[k]) {
    null, is JsonNull -> null
    is JsonPrimitive -> if (w.isString) w.content.trim().replace(",", ".").toDoubleOrNull() else w.doubleOrNull
    else -> null
}

/** Ganze Zahl oder null (Number.parseInt). */
internal fun JsonObject.ganz(k: String): Int? = when (val w = this[k]) {
    null, is JsonNull -> null
    is JsonPrimitive -> if (w.isString) w.content.trim().takeWhile { it.isDigit() || it == '-' }.toIntOrNull() else w.doubleOrNull?.toInt()
    else -> null
}

/** toBool: true, 1, '1', 'true'. */
internal fun JsonObject.wahr(k: String): Boolean = when (val w = this[k]) {
    is JsonPrimitive -> if (w.isString) w.content == "1" || w.content == "true" else (w.booleanOrNull ?: (w.doubleOrNull == 1.0))
    else -> false
}

internal fun jsonText(s: String): JsonElement {
    val t = s.trim()
    return if (t.isEmpty()) JsonNull else JsonPrimitive(t)
}

// MARK: Layout

/**
 * Wie Leinwand in iOS: Raster 402 breit, mindestens basisHoehe oder Bildschirmhoehe hoch,
 * groesserer Inhalt scrollt. `rahmen` ist die sichtbare Hoehe im Raster.
 */
@Composable
internal fun Leinwand(
    basisHoehe: Float = 874f,
    inhaltHoehe: Float = 0f,
    inhalt: @Composable BoxScope.(rahmen: Float) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
        val sichtbar = maxHeight.value
        val rahmen = max(basisHoehe, sichtbar)
        val hoehe = max(rahmen, inhaltHoehe)
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState(), enabled = hoehe > sichtbar + 0.5f)) {
            Box(Modifier.width(402.dp).height(hoehe.dp)) { inhalt(rahmen) }
        }
    }
}

/** Einzeilige Textzeile mit fester Hoehe; der Text darf wie im Web ueber die Zeilenhoehe hinausragen. */
@Composable
internal fun TextZeile(
    text: String,
    stil: TextStyle,
    modifier: Modifier = Modifier,
    hoehe: Float? = null,
    ausrichtung: Alignment = Alignment.CenterStart,
    zeilen: Int = 1,
) {
    Box(if (hoehe != null) modifier.height(hoehe.dp) else modifier, contentAlignment = ausrichtung) {
        Text(
            text, style = stil, maxLines = zeilen, overflow = TextOverflow.Ellipsis, softWrap = zeilen > 1,
            modifier = Modifier.wrapContentHeight(unbounded = true),
        )
    }
}

/** Seitentitel: 42 fett, Lime, CSS leading-[42px]. */
@Composable
internal fun StammTitel(text: String, modifier: Modifier = Modifier, groesse: Float = 42f, abstand: Float = 0f, farbe: Long = 0xE3F654) {
    TextZeile(text, grotesk(groesse, 700, groesse, abstand, hex(farbe)), modifier, hoehe = groesse)
}

/** Textfeld ohne Rahmen im Web-Stil, Platzhalter darunter. */
@Composable
internal fun Eingabe(
    wert: String,
    aendern: (String) -> Unit,
    platzhalter: String,
    stil: TextStyle,
    platzhalterFarbe: Color,
    modifier: Modifier = Modifier,
    tastatur: KeyboardType = KeyboardType.Text,
    gross: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    fokus: FocusRequester? = null,
    fokusGeaendert: ((Boolean) -> Unit)? = null,
    aktiv: Boolean = true,
    einzeilig: Boolean = true,
    verdeckt: Boolean = false,
) {
    var m = modifier
    if (fokus != null) m = m.focusRequester(fokus)
    if (fokusGeaendert != null) m = m.onFocusChanged { fokusGeaendert(it.isFocused) }
    BasicTextField(
        value = wert,
        onValueChange = aendern,
        enabled = aktiv,
        singleLine = einzeilig,
        textStyle = stil,
        cursorBrush = SolidColor(LIME),
        keyboardOptions = KeyboardOptions(capitalization = gross, autoCorrectEnabled = false, keyboardType = tastatur),
        visualTransformation = if (verdeckt) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = m,
        decorationBox = { feld ->
            Box(contentAlignment = if (einzeilig) Alignment.CenterStart else Alignment.TopStart) {
                if (wert.isEmpty()) Text(platzhalter, style = stil.copy(color = platzhalterFarbe), maxLines = 1)
                feld()
            }
        },
    )
}

/**
 * `Box` aus FahrzeugErstellenView/SettingsViewKo: 2er Lime-Rahmen, Eingabe in #8a9728,
 * rechts der kurze Pfeil, der das Feld fokussiert.
 */
@Composable
internal fun BoxFeld(
    platzhalter: String,
    wert: String,
    aendern: (String) -> Unit,
    modifier: Modifier = Modifier,
    links: Float = 16f,
    rechts: Float = 48f,
    pfeil: Boolean = true,
    tastatur: KeyboardType = KeyboardType.Text,
    gross: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    fokusGeaendert: ((Boolean) -> Unit)? = null,
) {
    val fokus = remember { FocusRequester() }
    Box(modifier.border(2.dp, LIME), contentAlignment = Alignment.CenterStart) {
        Eingabe(
            wert, aendern, platzhalter, grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)), hex(0x8A9728, 0.9f),
            Modifier.fillMaxWidth().padding(start = links.dp, end = rechts.dp),
            tastatur = tastatur, gross = gross, fokus = fokus, fokusGeaendert = fokusGeaendert,
        )
        if (pfeil) {
            Box(Modifier.align(Alignment.CenterEnd).size(34.dp, 44.dp).tippen { runCatching { fokus.requestFocus() } }, contentAlignment = Alignment.Center) {
                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
            }
        }
    }
}

/** Voller Lime-Knopf mit Text links und Icon rechts (Fahrzeug erstellen, Filter speichern, ...). */
@Composable
internal fun StammZeilenKnopf(
    text: String,
    icon: String,
    modifier: Modifier = Modifier,
    iconBreite: Float = 24f,
    iconHoehe: Float = 24f,
    hintergrund: Long = 0xE3F654,
    textFarbe: Long = 0x1D1C1D,
    innen: Float = 16f,
    abstand: Float = 0.4f,
    aktion: () -> Unit,
) {
    Row(
        modifier.background(hex(hintergrund)).tippen(aktion).padding(horizontal = innen.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = abstand, farbe = hex(textFarbe)), maxLines = 1)
        Spacer(Modifier.weight(1f))
        Icon(icon, Modifier.size(iconBreite.dp, iconHoehe.dp))
    }
}

/** Fehlerkasten der Listen (#171717, Rand #3A3A3A, Text #FF8E8E). */
@Composable
internal fun FehlerKasten(text: String, modifier: Modifier = Modifier) {
    Box(modifier.background(hex(0x171717)).border(1.dp, hex(0x3A3A3A)).padding(16.dp)) {
        Text(text, style = grotesk(13f, 500, 13f * 1.4f, farbe = hex(0xFF8E8E)))
    }
}

// MARK: Bilder

/** Bilder liegen teils als Pfad der Web-App vor (/fahrzeuge/...). */
internal fun bildURL(wert: String?): String? {
    val roh = wert?.trim().orEmpty()
    if (roh.isEmpty() || roh.startsWith("data:") || roh.startsWith("blob:")) return null
    if (roh.startsWith("http")) return roh
    return "https://fahrer.trisar.de" + if (roh.startsWith("/")) roh else "/$roh"
}

internal fun ausDataURL(text: String): Bitmap? {
    if (!text.startsWith("data:")) return null
    val komma = text.indexOf(',')
    if (komma < 0) return null
    return runCatching {
        val daten = Base64.decode(text.substring(komma + 1), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(daten, 0, daten.size)
    }.getOrNull()
}

/** Bild aus Data-URL oder Internetadresse (Fahrzeug- und Profilbilder liegen in beiden Formen vor). */
@Composable
internal fun StammBild(quelle: String, modifier: Modifier = Modifier, skalierung: ContentScale = ContentScale.Fit) {
    val bitmap = remember(quelle) { ausDataURL(quelle) }
    if (bitmap != null) {
        Image(bitmap.asImageBitmap(), null, modifier, contentScale = skalierung)
    } else {
        val url = bildURL(quelle) ?: return
        AsyncImage(model = url, contentDescription = null, modifier = modifier, contentScale = skalierung)
    }
}

/** Gewaehltes Bild verkleinern (laengste Seite `maxKante`) und als Data-URL schreiben. */
internal fun bildAlsDataURL(ctx: Context, uri: Uri, maxKante: Int, png: Boolean? = null, qualitaet: Int = 84): String? = runCatching {
    val daten = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bild = BitmapFactory.decodeByteArray(daten, 0, daten.size) ?: return null
    val istPNG = png ?: (daten.size > 4 && daten[0] == 0x89.toByte() && daten[1] == 0x50.toByte())
    val faktor = min(1f, maxKante.toFloat() / max(bild.width, bild.height).coerceAtLeast(1))
    val klein = if (faktor < 1f) Bitmap.createScaledBitmap(bild, max(1, (bild.width * faktor).roundToInt()), max(1, (bild.height * faktor).roundToInt()), true) else bild
    val aus = ByteArrayOutputStream()
    if (istPNG) klein.compress(Bitmap.CompressFormat.PNG, 100, aus) else klein.compress(Bitmap.CompressFormat.JPEG, qualitaet, aus)
    (if (istPNG) "data:image/png;base64," else "data:image/jpeg;base64,") + Base64.encodeToString(aus.toByteArray(), Base64.NO_WRAP)
}.getOrNull()

// MARK: Telefon und Mail

/** tel:-Link wie im Web (Leerzeichen, Klammern und Striche raus). Oeffnet die Waehltastatur. */
internal fun anrufen(ctx: Context, telefon: String) {
    val nummer = telefon.replace(Regex("[\\s()-]"), "")
    if (nummer.isEmpty()) return
    runCatching { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$nummer")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

internal fun mailOeffnen(ctx: Context, adresse: String) {
    runCatching { ctx.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$adresse")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
