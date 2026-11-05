package de.trisar.dispo.einlesen

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayInputStream
import java.nio.charset.Charset
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.zip.ZipInputStream
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Liest eine Tabelle (CSV/TSV/TXT oder XLSX) in Zeilen aus Texten, wie tabelleLesen in
 * admin/src/services/spaltenErkennung.js (TabellenLeser.swift). CSV mit erkanntem Trennzeichen,
 * XLSX als ZIP mit erstem Blatt. Altes .xls (Binaerformat) geht nicht.
 */
object TabellenLeser {
    class Fehler(text: String) : Exception(text)

    fun lesen(name: String, daten: ByteArray): List<List<String>> {
        val klein = name.lowercase()
        val zip = daten.size >= 4 && daten[0] == 0x50.toByte() && daten[1] == 0x4B.toByte() && daten[2] == 0x03.toByte() && daten[3] == 0x04.toByte()
        if (klein.endsWith(".xlsx") || klein.endsWith(".xlsm") || zip) return Xlsx.zeilen(daten)
        if (klein.endsWith(".xls")) throw Fehler("Altes Excel-Format (.xls) wird nicht unterstützt. Bitte als .xlsx oder .csv speichern.")
        val utf8 = Charsets.UTF_8.newDecoder()
        val inhalt = runCatching { utf8.decode(java.nio.ByteBuffer.wrap(daten)).toString() }
            .getOrElse { String(daten, Charset.forName("windows-1252")) }
        return ausText(inhalt)
    }

    // MARK: CSV

    /** tabelleAusText: BOM weg, Trennzeichen aus den ersten sechs Zeilen, Werte unveraendert. */
    fun ausText(roh: String): List<List<String>> {
        val inhalt = if (roh.startsWith("﻿")) roh.drop(1) else roh
        val sep = trennzeichen(inhalt)
        val zeilen = mutableListOf<List<String>>()
        var zeile = mutableListOf<String>()
        val feld = StringBuilder()
        var inAnf = false
        val zeichen = if (inhalt.endsWith("\n")) inhalt else inhalt + "\n"
        var i = 0
        while (i < zeichen.length) {
            val c = zeichen[i]
            if (inAnf) {
                if (c == '"') {
                    if (i + 1 < zeichen.length && zeichen[i + 1] == '"') { feld.append('"'); i++ } else inAnf = false
                } else feld.append(c)
            } else if (c == '"' && feld.isEmpty()) {
                inAnf = true
            } else if (c == sep) {
                zeile.add(feld.toString()); feld.clear()
            } else if (c == '\n' || c == '\r') {
                // \r\n zaehlt als ein Zeilenende (in Swift ein Zeichen).
                if (c == '\r' && i + 1 < zeichen.length && zeichen[i + 1] == '\n') i++
                zeile.add(feld.toString()); feld.clear()
                // blankrows: false wie im Web
                if (zeile.any { it.isNotBlank() }) zeilen.add(zeile)
                zeile = mutableListOf()
            } else {
                feld.append(c)
            }
            i++
        }
        return zeilen
    }

    private fun trennzeichen(inhalt: String): Char {
        val zeilen = inhalt.split(Regex("\\r\\n|\\r|\\n")).filter { it.isNotBlank() }.take(6)
        var bestes = ';' to 0
        for (sep in listOf(';', ',', '\t', '|')) {
            val n = zeilen.sumOf { z -> z.count { it == sep } }
            if (n > bestes.second) bestes = sep to n
        }
        return if (bestes.second > 0) bestes.first else ';'
    }

    // MARK: XLSX

    private object Xlsx {
        fun zeilen(daten: ByteArray): List<List<String>> {
            val dateien = HashMap<String, ByteArray>()
            try {
                ZipInputStream(ByteArrayInputStream(daten)).use { zip ->
                    while (true) {
                        val e = zip.nextEntry ?: break
                        if (!e.isDirectory) dateien[e.name] = zip.readBytes()
                    }
                }
            } catch (e: Exception) {
                throw Fehler("Datei ist keine gültige Excel-Datei.")
            }
            if (dateien.isEmpty()) throw Fehler("Datei ist keine gültige Excel-Datei.")
            val texte = dateien["xl/sharedStrings.xml"]?.let { geteilteTexte(it) } ?: emptyList()
            val stile = dateien["xl/styles.xml"]?.let { stile(it) } ?: emptyMap()
            val blatt = dateien[erstesBlatt(dateien)] ?: dateien["xl/worksheets/sheet1.xml"] ?: throw Fehler("Kein Tabellenblatt gefunden.")
            return blattLesen(blatt, texte, stile)
        }

        private fun parser(d: ByteArray): XmlPullParser = Xml.newPullParser().apply {
            setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            setInput(ByteArrayInputStream(d), null)
        }

        private fun lokal(n: String): String = n.substringAfterLast(':')

        private fun attribute(p: XmlPullParser): Map<String, String> =
            (0 until p.attributeCount).associate { lokal(p.getAttributeName(it)) to p.getAttributeValue(it) }

        /** Attribute aller Elemente mit einem Namen. */
        private fun sammeln(d: ByteArray, name: String): List<Map<String, String>> {
            val p = parser(d)
            val treffer = mutableListOf<Map<String, String>>()
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                if (p.eventType == XmlPullParser.START_TAG && lokal(p.name) == name) treffer.add(attribute(p))
            }
            return treffer
        }

        /** Pfad des ersten Blatts aus workbook.xml + Beziehungen. */
        private fun erstesBlatt(dateien: Map<String, ByteArray>): String {
            val mappe = dateien["xl/workbook.xml"] ?: return ""
            val rels = dateien["xl/_rels/workbook.xml.rels"] ?: return ""
            val blatt = sammeln(mappe, "sheet").firstOrNull() ?: return ""
            val rid = blatt.entries.firstOrNull { it.key.endsWith("id") && it.key != "sheetId" }?.value ?: return ""
            val ziel = sammeln(rels, "Relationship").firstOrNull { it["Id"] == rid }?.get("Target") ?: ""
            if (ziel.startsWith("/")) return ziel.drop(1)
            return "xl/$ziel"
        }

        /** sharedStrings.xml: jedes <si> ein Text, Runs (<r><t>) aneinandergehaengt, Lautschrift (<rPh>) ignoriert. */
        private fun geteilteTexte(d: ByteArray): List<String> {
            val p = parser(d)
            val liste = mutableListOf<String>()
            val aktuell = StringBuilder()
            var inT = false
            var inPh = false
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG -> when (lokal(p.name)) { "si" -> aktuell.clear(); "t" -> inT = true; "rPh" -> inPh = true }
                    XmlPullParser.END_TAG -> when (lokal(p.name)) { "si" -> liste.add(aktuell.toString()); "t" -> inT = false; "rPh" -> inPh = false }
                    XmlPullParser.TEXT -> if (inT && !inPh) aktuell.append(p.text)
                }
            }
            return liste
        }

        /** styles.xml: welche Stil-Nummer ein Datum/eine Uhrzeit ist. Index in cellXfs -> (Datum, Zeit). */
        private fun stile(d: ByteArray): Map<Int, Pair<Boolean, Boolean>> {
            val p = parser(d)
            val formate = HashMap<Int, String>()
            val xfs = mutableListOf<Int>()
            var inCellXfs = false
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG -> {
                        val a = attribute(p)
                        when (lokal(p.name)) {
                            "numFmt" -> a["numFmtId"]?.toIntOrNull()?.let { formate[it] = a["formatCode"] ?: "" }
                            "cellXfs" -> inCellXfs = true
                            "xf" -> if (inCellXfs) xfs.add(a["numFmtId"]?.toIntOrNull() ?: 0)
                        }
                    }
                    XmlPullParser.END_TAG -> if (lokal(p.name) == "cellXfs") inCellXfs = false
                }
            }
            val art = HashMap<Int, Pair<Boolean, Boolean>>()
            xfs.forEachIndexed { i, id ->
                val a = eingebaut(id) ?: formate[id]?.let { ausCode(it) }
                if (a != null) art[i] = a
            }
            return art
        }

        private fun eingebaut(id: Int): Pair<Boolean, Boolean>? = when (id) {
            in 14..17, in 27..31, in 34..36, in 50..58 -> true to false
            in 18..21, 32, 33, in 45..47 -> false to true
            22 -> true to true
            else -> null
        }

        /** Eigenes Format: Text in Anfuehrungszeichen und [..] weg, dann nach y/d bzw. h/s suchen. */
        private fun ausCode(code: String): Pair<Boolean, Boolean>? {
            val rein = code.replace(Regex(""""[^"]*"|\[[^\]]*\]|\\."""), "").lowercase()
            val datum = rein.contains("y") || rein.contains("d")
            val zeit = rein.contains("h") || rein.contains("s")
            return if (datum || zeit) datum to zeit else null
        }

        /** Blatt lesen: Zellen nach Zeile/Spalte, Texte aufgeloest, Datumszahlen als Text (yyyy-MM-dd, HH:mm). */
        private fun blattLesen(d: ByteArray, texte: List<String>, stile: Map<Int, Pair<Boolean, Boolean>>): List<List<String>> {
            val p = parser(d)
            val zellen = HashMap<Int, HashMap<Int, String>>()
            var zeile = -1
            var spalte = -1
            var typ = "n"
            var stil = 0
            val wert = StringBuilder()
            var inWert = false
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG -> {
                        val a = attribute(p)
                        when (lokal(p.name)) {
                            "row" -> { zeile = a["r"]?.toIntOrNull()?.minus(1) ?: (zeile + 1); spalte = -1 }
                            "c" -> {
                                spalte = a["r"]?.let { spaltenIndex(it) } ?: (spalte + 1)
                                typ = a["t"] ?: "n"
                                stil = a["s"]?.toIntOrNull() ?: 0
                                wert.clear()
                            }
                            "v", "t" -> inWert = true
                        }
                    }
                    XmlPullParser.END_TAG -> when (lokal(p.name)) {
                        "v", "t" -> inWert = false
                        "c" -> {
                            val w = wert.toString()
                            val text = when (typ) {
                                "s" -> w.toIntOrNull()?.let { texte.getOrNull(it) } ?: ""
                                "b" -> if (w == "1") "TRUE" else "FALSE"
                                "str", "inlineStr", "e" -> w
                                else -> zahl(w, stile[stil])
                            }
                            if (text.isNotEmpty()) zellen.getOrPut(zeile) { HashMap() }[spalte] = text
                        }
                    }
                    XmlPullParser.TEXT -> if (inWert) wert.append(p.text)
                }
            }
            val maxZeile = zellen.keys.maxOrNull() ?: return emptyList()
            val aus = mutableListOf<List<String>>()
            for (z in 0..maxZeile) {
                val reihe = zellen[z] ?: continue
                val breite = reihe.keys.maxOrNull() ?: continue
                val werte = (0..breite).map { reihe[it] ?: "" }
                if (werte.any { it.isNotBlank() }) aus.add(werte)
            }
            return aus
        }

        private fun zahl(roh: String, art: Pair<Boolean, Boolean>?): String {
            val d = roh.toDoubleOrNull() ?: return roh
            if (art != null) {
                // Excel-Seriennummer: Tage seit 30.12.1899.
                val sek = (d * 86400).roundToLong()
                val t = LocalDateTime.ofEpochSecond(sek - 2_209_161_600L, 0, ZoneOffset.UTC)
                val tag = "%04d-%02d-%02d".format(t.year, t.monthValue, t.dayOfMonth)
                val uhr = "%02d:%02d".format(t.hour, t.minute)
                if (art.first && art.second) return "$tag $uhr"
                return if (art.first) tag else uhr
            }
            if (d == floor(d) && abs(d) < 1e15) return d.toLong().toString()
            return d.toString()
        }

        private fun spaltenIndex(ref: String): Int {
            var n = 0
            for (c in ref.uppercase()) {
                if (c !in 'A'..'Z') break
                n = n * 26 + (c - 'A' + 1)
            }
            return n - 1
        }
    }
}
