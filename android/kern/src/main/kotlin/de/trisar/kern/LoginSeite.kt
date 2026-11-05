@file:OptIn(ExperimentalComposeUiApi::class)

package de.trisar.kern

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.autofill.AutofillNode
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalAutofill
import androidx.compose.ui.platform.LocalAutofillTree
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Nachbau von fahrer/src/features/auth/LoginView.jsx (wie LoginAnsicht in iOS).
 * Fahrer: gelber Verlauf, Dispo: blauer Verlauf ueber `hintergrund`.
 */
@Composable
fun LoginSeite(anmeldung: Anmeldung, hintergrund: @Composable () -> Unit = { TrisarHintergrund() }) {
    var email by remember { mutableStateOf("") }
    var passwort by remember { mutableStateOf("") }
    var sichtbar by remember { mutableStateOf(false) }
    var hinweis by remember { mutableStateOf<String?>(null) }
    var fokusMail by remember { mutableStateOf(false) }
    var fokusPw by remember { mutableStateOf(false) }
    val fehler by anmeldung.fehler.collectAsState()
    val arbeitet by anmeldung.arbeitet.collectAsState()
    val fokus = LocalFocusManager.current
    val pwFeld = remember { FocusRequester() }

    // Passwort-Manager: Benutzername und Passwort automatisch eintragen lassen.
    val autofill = LocalAutofill.current
    val baum = LocalAutofillTree.current
    val kennungKnoten = remember { AutofillNode(listOf(AutofillType.Username)) { email = it } }
    val pwKnoten = remember { AutofillNode(listOf(AutofillType.Password)) { passwort = it } }
    DisposableEffect(Unit) { baum += kennungKnoten; baum += pwKnoten; onDispose { } }
    fun Modifier.ausfuellen(knoten: AutofillNode) = onGloballyPositioned { knoten.boundingBox = it.boundsInWindow() }
        .onFocusChanged { if (it.isFocused) autofill?.requestAutofillForNode(knoten) else autofill?.cancelAutofillForNode(knoten) }

    fun los() { fokus.clearFocus(); hinweis = null; anmeldung.anmelden(email, passwort) { passwort = "" } }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        hintergrund()
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(44.dp))
            // Logos: trisar links, „x“, Kundenlogo rechts (wie iOS).
            Row(Modifier.fillMaxWidth().height(53.dp)) {
                Icon("TrisarLogo", Modifier.padding(top = 14.dp).size(161.79.dp, 24.dp))
                Spacer(Modifier.weight(1f))
                Icon("PartnerX", Modifier.padding(top = 17.dp).size(20.dp))
                Spacer(Modifier.width(34.dp))
                Icon("PartnerLogo", Modifier.size(113.dp, 53.dp))
            }
            Spacer(Modifier.height(56.dp))
            Spalte(24f) {
                Feld("Benutzername oder E-Mail", "Brief", fokusMail) {
                    BasicTextField(
                        email, { email = it }, singleLine = true,
                        textStyle = grotesk(15f, farbe = Farbe.grauText),
                        cursorBrush = SolidColor(Farbe.lime),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Text, imeAction = ImeAction.Next,
                        ),
                        keyboardActions = KeyboardActions(onNext = { pwFeld.requestFocus() }),
                        modifier = Modifier.fillMaxWidth().ausfuellen(kennungKnoten).onFocusChanged { fokusMail = it.isFocused },
                        decorationBox = { inner -> if (email.isEmpty()) Text("name oder deine@email.de", style = grotesk(15f, farbe = Farbe.grauText)); inner() },
                    )
                }
                Feld("Passwort", "Schloss", fokusPw, rechts = {
                    Icon(if (sichtbar) "AugeZu" else "AugeOffen", Modifier.size(20.dp).tippen { sichtbar = !sichtbar })
                }) {
                    BasicTextField(
                        passwort, { passwort = it }, singleLine = true,
                        textStyle = grotesk(15f, farbe = Farbe.grauText),
                        cursorBrush = SolidColor(Farbe.lime),
                        visualTransformation = if (sichtbar) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                        keyboardActions = KeyboardActions(onGo = { los() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(pwFeld).ausfuellen(pwKnoten).onFocusChanged { fokusPw = it.isFocused },
                        decorationBox = { inner -> if (passwort.isEmpty()) Text("••••••••", style = grotesk(15f, farbe = Farbe.grauText)); inner() },
                    )
                }
                Text("Passwort vergessen?", style = grotesk(13f, farbe = Farbe.grauText), textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().tippen { anmeldung.passwortVergessen(email) { hinweis = it } })
                LimeKnopf(if (arbeitet) "…" else "Anmelden", gesperrt = arbeitet) { los() }
                val text = fehler ?: hinweis
                if (text != null) {
                    Text(text, style = grotesk(13f, 500, farbe = if (fehler != null) Farbe.fehler else Farbe.lime),
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                }
            }
            Spacer(Modifier.height(51.dp))
            Icon("PfeilRechtsLime", Modifier.fillMaxWidth().height(260.dp))
            Spacer(Modifier.height(60.dp))
        }
        FussleisteUnten()
    }
}

/** Eingabefeld im Stil der Web-App (wie TrisarFeld in iOS). */
@Composable
private fun Feld(titel: String, icon: String, fokussiert: Boolean, rechts: @Composable () -> Unit = {}, feld: @Composable () -> Unit) {
    Column {
        Text(titel, style = grotesk(13f, 600, farbe = Farbe.lime), modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        Row(
            Modifier.fillMaxWidth().height(58.dp).background(Farbe.feld).border(1.dp, if (fokussiert) Farbe.lime else Farbe.feldRand),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, Modifier.padding(start = 16.dp, end = 12.dp).size(20.dp))
            Box(Modifier.weight(1f)) { feld() }
            Box(Modifier.padding(end = 16.dp)) { rechts() }
        }
    }
}
