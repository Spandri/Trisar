"""Gibt den Demo-Fahrern unterscheidbare Namen.

Die Demo-Fahrer hiessen fast alle Meyer, Schmidt oder Schneider. Dieses
Werkzeug ersetzt die Namen einmalig in allen Demo-Daten, die sie tragen:
Profile der Dispo- und Fahrer-App, vorgerechnete Engine-, Planer- und
Risiko-Ergebnisse, die Planer-Anfrage und Kommentare im Tutorial. IDs und
Fahrernummern bleiben, nur Vor- und Nachname und E-Mail aendern sich.

Aufruf (aus Programm/trisar):  python3 werkzeuge/demo_fahrernamen.py
Laeuft ein zweites Mal ohne Wirkung, weil die alten Namen dann fehlen.
"""
import json
import re
import unicodedata
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Meist deutsch, dazu tuerkisch, italienisch und weitere europaeische Namen,
# Frauen und Maenner gemischt. Reihenfolge = Fahrernummer 2, 3, 4, ...
# Fahrer #36 (Tutorial, oben in der Fahrerliste) bekommt "Adler", damit er
# nach Nachname weiter vorne steht. Stefano Spandri (#1) bleibt.
NEUE_NAMEN = [
    "Sabine Krüger", "Markus Hoffmann", "Julia Wagner", "Thomas Becker", "Katrin Schulz",
    "Mehmet Yılmaz", "Lisa Richter", "Andreas Wolf", "Giulia Conti", "Jens Neumann",
    "Sandra Schwarz", "Christian Zimmermann", "Ayşe Demir", "Stefan Lange", "Anja Werner",
    "Frank Schmitz", "Tanja Krause", "Luca Romano", "Oliver Köhler", "Claudia Herrmann",
    "Martin König", "Emre Kaya", "Birgit Walter", "Uwe Peters", "Petra Möller",
    "Sven Kaiser", "Francesca Marino", "Heike Lorenz", "Jürgen Ludwig", "Elif Şahin",
    "Silke Böhm", "Ralf Winter", "Kerstin Jung", "Piotr Wiśniewski", "Aaron Adler",
    "Dirk Haas", "Simone Schäfer", "Murat Çelik", "Marcel Busch", "Jana Keller",
    "Matteo Greco", "Carsten Friedrich", "Nadine Beck", "Torsten Sommer", "Zeynep Arslan",
    "Bettina Engel", "Kai Ziegler", "Svenja Kühn", "Ivan Babić", "Lars Pohl",
    "Monika Franke", "Burak Doğan", "Benjamin Horn", "Chiara Lombardi", "Carina Graf",
    "Marius Thiel", "Daniela Arnold", "Leyla Kılıç", "Holger Sauer", "Ute Schreiner",
    "Nikos Papadopoulos", "Rainer Dietrich", "Vanessa Hahn", "Björn Jäger", "Can Öztürk",
    "Elke Pfeiffer", "Henning Voigt", "Alessandro Galli", "Lena Bauer", "Philipp Kraft",
    "Derya Aksoy", "Annika Wendt", "Pablo García", "Jörg Otto", "Steffi Krämer",
    "Serkan Polat", "Volker Schulte", "Sara Ricci", "Marlene Haase", "Konstantin Ernst",
    "Camille Laurent", "Merve Koç", "Vivien Stein", "Davide Moretti", "Gerhard Wiesner",
    "Ana Jurić", "Hakan Erdem", "Agnieszka Zając", "Julien Mercier", "Eleni Georgiou",
    "Giorgio Colombo", "Esra Kurt", "Daan Visser", "Federica Barbieri", "Lotte Jansen",
    "Mikael Nyström", "Lucía Romero", "Sebastian Kolb", "Ilse Brandner", "Tobias Reuter",
]
FAHRER_OBEN = 36
NAME_OBEN = "Aaron Adler"

DATEIEN = [
    *sorted((WURZEL / "admin/src/demo/data").glob("*.json")),
    *sorted((WURZEL / "fahrer/src/demo/data").glob("*.json")),
    WURZEL / "werkzeuge/engine/ergebnisse/engine-ergebnisse.json",
    WURZEL / "werkzeuge/engine/ergebnisse/bisheriger-planer-tag2.json",
    WURZEL / "werkzeuge/engine/bisheriger_planer/anfrage_tag2.json",
    WURZEL / "demo/deploy/tutorial-dispo.js",
    WURZEL / "admin/src/services/kiAssistant.js",
    WURZEL / "admin/src/demo/risikoErgebnisse.js",
]


def ascii_klein(text: str) -> str:
    ersetzt = text.replace("ß", "ss").replace("ı", "i").replace("ł", "l")
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("Ä", "Ae"), ("Ö", "Oe"), ("Ü", "Ue")):
        ersetzt = ersetzt.replace(a, b)
    ohne = unicodedata.normalize("NFKD", ersetzt).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", ohne.lower())


def main() -> None:
    profile_pfad = WURZEL / "admin/src/demo/data/profiles.json"
    profile = json.loads(profile_pfad.read_text())
    fahrer = sorted(
        (p for p in profile if p.get("role") == "fahrer" and p.get("last_name") in ("Meyer", "Schmidt", "Schneider")),
        key=lambda p: int(p.get("driver_number") or 0),
    )
    if not fahrer:
        print("Keine alten Namen mehr gefunden, nichts zu tun.")
        return
    namen = [n for n in NEUE_NAMEN if n != NAME_OBEN]
    assert len(set(NEUE_NAMEN)) == len(NEUE_NAMEN), "doppelte Namen"
    assert len(namen) >= len(fahrer) - 1, f"zu wenige Namen: {len(namen)} fuer {len(fahrer)}"

    zuordnung = {}   # id -> (alt, neu)
    frei = iter(namen)
    for p in fahrer:
        neu = NAME_OBEN if int(p["driver_number"]) == FAHRER_OBEN else next(frei)
        zuordnung[p["id"]] = (f'{p["first_name"]} {p["last_name"]}', neu)

    alt_zu_neu = {alt: neu for alt, neu in zuordnung.values()}
    muster = re.compile(r"\b(" + "|".join(re.escape(a) for a in sorted(alt_zu_neu, key=len, reverse=True)) + r")\b")

    for pfad in DATEIEN:
        if not pfad.exists():
            continue
        text = pfad.read_text()
        neu_text, n = muster.subn(lambda m: alt_zu_neu[m.group(1)], text)
        # Profile: Vor-, Nachname und E-Mail je ID.
        if pfad.name == "profiles.json":
            daten = json.loads(neu_text)
            for p in daten:
                if p.get("id") not in zuordnung:
                    continue
                vor, nach = zuordnung[p["id"]][1].split(" ", 1)
                p["first_name"], p["last_name"] = vor, nach
                if p.get("email", "").endswith("@trisar-demo.local"):
                    nummer = re.search(r"\.(\d+)@", p["email"])
                    nummer = nummer.group(1) if nummer else str(p.get("driver_number") or 0).zfill(3)
                    p["email"] = f"{ascii_klein(vor)}.{ascii_klein(nach)}.{nummer}@trisar-demo.local"
                n += 1
            neu_text = json.dumps(daten, ensure_ascii=False, separators=(",", ":")) if "\n" not in text.strip() else json.dumps(daten, ensure_ascii=False, indent=2) + "\n"
        if neu_text != text:
            pfad.write_text(neu_text)
            print(f"{pfad.relative_to(WURZEL)}: {n} Stellen")


if __name__ == "__main__":
    main()
