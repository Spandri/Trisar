package de.trisar.dispo.fahrten

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.LineHeightStyle
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import java.time.LocalDate

/** Lime der Listen und Formulare (GREEN in FahrtAdd.jsx). */
internal val LIME = hex(0xE3F654)

/** Schrift mit CSS line-height: Text mittig in der Zeile, ohne Abschneiden (cssZeile in iOS). */
internal fun css(groesse: Float, gewicht: Int = 400, zeile: Float? = null, abstand: Float = 0f, farbe: Color = Color.White): TextStyle =
    grotesk(groesse, gewicht, zeile, abstand, farbe).copy(
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    )

/** Seite liegt ueber einer anderen: Tipps auf leere Stellen nicht nach unten durchreichen. */
internal fun Modifier.blockieren(): Modifier = pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }

/** Einzeilige Lime-Eingabe ohne Rahmen (eingabeStil in iOS). */
@Composable
internal fun LimeEingabe(
    wert: String,
    aendern: (String) -> Unit,
    modifier: Modifier = Modifier,
    platzhalter: String = "",
    platzhalterFarbe: Color = LIME.copy(alpha = 0.6f),
    stil: TextStyle = grotesk(16f, 500, farbe = LIME),
    zahl: Boolean = false,
    gross: Boolean = false,
    gesperrt: Boolean = false,
) {
    BasicTextField(
        wert, aendern, modifier, enabled = !gesperrt, singleLine = true, textStyle = stil,
        cursorBrush = SolidColor(LIME),
        keyboardOptions = KeyboardOptions(
            capitalization = if (gross) KeyboardCapitalization.Sentences else KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = if (zahl) KeyboardType.Number else KeyboardType.Text,
        ),
        decorationBox = { inner ->
            if (wert.isEmpty() && platzhalter.isNotEmpty()) Text(platzhalter, style = stil.copy(color = platzhalterFarbe), maxLines = 1)
            inner()
        },
    )
}

/** Systemauswahl fuer ein Datum (wie `<input type="date">`), Ergebnis als yyyy-MM-dd. */
internal fun datumWaehlen(ctx: Context, wert: String, fertig: (String) -> Unit) {
    val d = runCatching { LocalDate.parse(wert) }.getOrElse { LocalDate.now() }
    DatePickerDialog(ctx, { _, j, m, t -> fertig("%04d-%02d-%02d".format(j, m + 1, t)) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
}

/** Systemauswahl fuer eine Uhrzeit (24 h), Ergebnis als HH:MM. */
internal fun zeitWaehlen(ctx: Context, minuten: Int?, fertig: (String) -> Unit) {
    val jetzt = java.time.LocalTime.now()
    val m = minuten ?: (jetzt.hour * 60 + jetzt.minute)
    TimePickerDialog(ctx, { _, h, mi -> fertig("%02d:%02d".format(h, mi)) }, m / 60, m % 60, true).show()
}

/** Hinweis wie .alert in iOS. */
@Composable
internal fun Hinweis(titel: String?, text: String?, schliessen: () -> Unit) {
    DunklesThema {
        AlertDialog(
            onDismissRequest = schliessen,
            confirmButton = { TextButton(onClick = schliessen) { Text("OK") } },
            title = titel?.let { { Text(it) } },
            text = text?.let { { Text(it) } },
        )
    }
}

/** Rueckfrage mit Abbrechen/OK wie .alert mit zwei Knoepfen in iOS. */
@Composable
internal fun Rueckfrage(titel: String, ok: () -> Unit, abbrechen: () -> Unit) {
    DunklesThema {
        AlertDialog(
            onDismissRequest = abbrechen,
            confirmButton = { TextButton(onClick = ok) { Text("OK") } },
            dismissButton = { TextButton(onClick = abbrechen) { Text("Abbrechen") } },
            title = { Text(titel) },
        )
    }
}

/** Systemmenues und Dialoge dunkel wie .preferredColorScheme(.dark) in iOS. */
@Composable
internal fun DunklesThema(inhalt: @Composable () -> Unit) = MaterialTheme(colorScheme = darkColorScheme(), content = inhalt)
