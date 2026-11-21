#!/usr/bin/env python3
"""Liest aus dem Quellcode, welche Komponente welche Tabelle, RPC, Edge Function,
Realtime-Tabelle und welchen externen Dienst nutzt. Jeder Treffer mit Datei:Zeile.

    python3 werkzeuge/architektur/code-auslesen.py   -> roh/code.json
"""
import json
import re
from pathlib import Path

HIER = Path(__file__).resolve().parent
WURZEL = HIER.parent.parent  # Programm/trisar

# Komponenten: id, Name, Art, Ordner/Dateien (relativ zu WURZEL)
KOMPONENTEN = [
    ("web_dispo", "Dispo Web", "app", ["admin/src"]),
    ("web_fahrer", "Fahrer Web", "app", ["fahrer/src"]),
    ("ios_fahrer", "Fahrer iOS", "app", ["ios-fahrer"]),
    ("ios_dispo", "Dispo iOS", "app", ["ios-dispo"]),
    ("android_fahrer", "Fahrer Android", "app", ["android/fahrer", "android/kern"]),
    ("android_dispo", "Dispo Android", "app", ["android/dispo", "android/kern"]),
    ("edge_dispo_admin", "dispo-admin", "edge", ["fahrer/supabase/functions/dispo-admin"]),
    ("edge_external_sync", "external-sync", "edge", ["fahrer/supabase/functions/external-sync"]),
    ("edge_flight_validate", "flight-validate", "edge", ["fahrer/supabase/functions/flight-validate"]),
    ("edge_train_validate", "train-validate", "edge", ["fahrer/supabase/functions/train-validate"]),
    ("edge_airport_board", "airport-board", "edge", ["fahrer/supabase/functions/airport-board"]),
    ("edge_places_proxy", "places-proxy", "edge", ["fahrer/supabase/functions/places-proxy"]),
    ("edge_anmelden", "anmelden", "edge", ["fahrer/supabase/functions/anmelden"]),
    ("edge_billing", "billing-sync-costs", "edge", ["fahrer/supabase/functions/billing-sync-costs"]),
    ("edge_shared", "Edge _shared", "edge", ["fahrer/supabase/functions/_shared"]),
    ("gateway", "Teltonika-Gateway", "server", ["admin/scripts/teltonika-gateway.js"]),
    ("ki_webhook", "KI-Webhook-Server", "server", ["admin/scripts/ai-webhook-server.js", "admin/scripts/sync-ai-documents.js"]),
    ("planner", "Planner (CP-SAT)", "server", ["admin/optimizer"]),
    ("push_dienst", "Push-Dienst", "server", ["koordinaten/scripts/push-dienst.js"]),
]

ENDUNGEN = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".swift", ".kt", ".py"}
AUSLASSEN = ("node_modules", "/dist/", "/build/", "DerivedData", ".xcodeproj", "/.gradle/", "/demo/", "__pycache__")

Q = r"""['"]"""
MUSTER = {
    # .from('tabelle')  /  postgrest["tabelle"]  /  postgrest.from("tabelle")
    "tabelle": re.compile(r"""(?:\.from\(\s*|postgrest\[\s*)['"]([a-z_][a-z0-9_]*)['"]"""),
    "rpc": re.compile(r"""\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]|['"`/]rpc/([a-z_][a-z0-9_]*)"""),
    "rest": re.compile(r"""rest/v1/([a-z_][a-z0-9_]*)|\brest\(\s*[`'"]([a-z_][a-z0-9_]*)"""),
    "edge": re.compile(r"""functions\.invoke\(\s*['"]([a-z_-]+)['"]|functions/v1/([a-z_-]+)"""),
    "realtime": re.compile(r"""\btable\s*[:=]\s*['"]([a-z_][a-z0-9_]*)['"]"""),
    "aktion": re.compile(r"""\baktion\s*[:=]+\s*['"]([a-z_]+)['"]"""),
    "extern": re.compile(r"""https?://([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{2,5}))?""", re.I),
}
OPERATION = re.compile(r"\.(select|insert|update|upsert|delete)\b")
INTERN_HOSTS = ("localhost", "127.0.0.1", "supabase.co", "example.", "w3.org", "schemas.", "apple.com/DTDs",
                "www.apple.com", "schemas.android.com", "github.com", "developer.", "maps.google", "ns.adobe")


def xcode_fremddateien(projekt, eigener_ordner, fremder_ordner):
    """Swift-Dateien, die ein Xcode-Projekt aus einem anderen App-Ordner mitbaut (geteilte Dateien)."""
    pbx = WURZEL / projekt
    if not pbx.is_file():
        return []
    namen = set(re.findall(r"/\* ([^*/]+\.swift) in Sources \*/", pbx.read_text(errors="ignore")))
    eigene = {f.name for f in (WURZEL / eigener_ordner).rglob("*.swift")}
    return [str(f.relative_to(WURZEL)) for f in sorted((WURZEL / fremder_ordner).rglob("*.swift"))
            if f.name in namen and f.name not in eigene and "DerivedData" not in str(f)]


def dateien(pfade):
    for p in pfade:
        p = WURZEL / p
        if p.is_file():
            yield p
            continue
        for d in sorted(p.rglob("*")):
            s = str(d)
            if d.suffix in ENDUNGEN and d.is_file() and not any(a in s for a in AUSLASSEN):
                yield d


REST_METHODE = re.compile(r"""\b(?:methode?|method)\s*:\s*['"](GET|POST|PATCH|PUT|DELETE)['"]""", re.I)
REST_OP = {"GET": "select", "POST": "insert", "PATCH": "update", "PUT": "upsert", "DELETE": "delete"}


def operation_nach(text, pos, rest_aufruf=False):
    """Erste Supabase-Operation nach .from(...) bzw. REST-Methode, innerhalb ~400 Zeichen."""
    rest = text[pos:pos + 400]
    if rest_aufruf:
        m = REST_METHODE.search(text[pos:pos + 200])
        return REST_OP[m.group(1).upper()] if m else "select"
    m = OPERATION.search(rest)
    return m.group(1) if m else "?"


def auslesen():
    ergebnis = {"komponenten": []}
    geteilt = xcode_fremddateien("ios-dispo/TrisarDispo.xcodeproj/project.pbxproj", "ios-dispo", "ios-fahrer")
    for kid, name, art, pfade in KOMPONENTEN:
        if kid == "ios_dispo":
            pfade = pfade + geteilt
        treffer = []
        anzahl_dateien = 0
        zeilen_gesamt = 0
        for f in dateien(pfade):
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            anzahl_dateien += 1
            zeilen_gesamt += text.count("\n")
            rel = str(f.relative_to(WURZEL))
            zeilenstart = [0] + [m.end() for m in re.finditer("\n", text)]

            def zeile(pos):
                lo, hi = 0, len(zeilenstart) - 1
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if zeilenstart[mid] <= pos:
                        lo = mid
                    else:
                        hi = mid - 1
                return lo + 1

            for typ, rx in MUSTER.items():
                for m in rx.finditer(text):
                    ziel = next(g for g in m.groups() if g)
                    eintrag = {"typ": typ, "ziel": ziel, "datei": rel, "zeile": zeile(m.start())}
                    if typ in ("tabelle", "rest"):
                        eintrag["op"] = operation_nach(text, m.end(), typ == "rest")
                    if typ == "rest" and ziel == "rpc":
                        continue
                    if typ == "extern":
                        host = m.group(1).lower()
                        if any(i in host for i in INTERN_HOSTS) or "." not in host and not m.group(2):
                            continue
                        eintrag["ziel"] = host + (":" + m.group(2) if m.group(2) else "")
                    treffer.append(eintrag)
            # Kotlin: TabellenBeobachter("name", listOf("a", "b"))
            for m in re.finditer(r"TabellenBeobachter\([^)]*listOf\(([^)]*)\)", text):
                for t in re.findall(r'"([a-z_]+)"', m.group(1)):
                    treffer.append({"typ": "realtime", "ziel": t, "datei": rel, "zeile": zeile(m.start())})
        ergebnis["komponenten"].append({
            "id": kid, "name": name, "art": art, "pfade": pfade,
            "dateien": anzahl_dateien, "zeilen": zeilen_gesamt, "treffer": treffer,
        })
    return ergebnis


if __name__ == "__main__":
    e = auslesen()
    (HIER / "roh").mkdir(exist_ok=True)
    (HIER / "roh" / "code.json").write_text(json.dumps(e, ensure_ascii=False, indent=1))
    for k in e["komponenten"]:
        arten = {}
        for t in k["treffer"]:
            arten[t["typ"]] = arten.get(t["typ"], 0) + 1
        print(f"{k['name']:22} {k['dateien']:4} Dateien {k['zeilen']:7} Zeilen  {arten}")
