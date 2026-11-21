#!/usr/bin/env python3
"""Baut aus roh/db.json und roh/code.json das Architektur-Modell (modell.json).

Was es ableitet:
- je DB-Funktion: welche Tabellen sie liest/schreibt, welche Funktionen sie ruft,
  welche Spalten ein BEFORE-Trigger an NEW setzt, welche Edge Functions sie per pg_net ruft
- je Trigger: Zeitpunkt, Ereignisse, beobachtete Spalten
- Trigger-Ketten: Trigger -> Funktion -> schreibt Tabelle -> löst dort Trigger aus -> ...
- Kanten Komponente -> Tabelle/RPC/Edge/externer Dienst, mit Datei:Zeile als Beleg
- Befunde: Code nutzt Tabelle/RPC, die es in der DB nicht gibt; ungenutzte Tabellen/Funktionen; Kreisläufe

    python3 werkzeuge/architektur/modell-bauen.py
"""
import json
import re
from collections import defaultdict
from pathlib import Path

HIER = Path(__file__).resolve().parent
db = json.loads((HIER / "roh/db.json").read_text())
code = json.loads((HIER / "roh/code.json").read_text())

TABELLEN = {t["name"]: t for t in db["tabellen"]}
FUNKTIONEN = {}
for f in db["funktionen"]:
    FUNKTIONEN.setdefault(f["name"], []).append(f)  # Überladungen zusammen
TRIGGER = db["trigger"]
REALTIME = set(db.get("realtime") or [])

# Bekannte Verbindungen, die kein Muster findet. Jede mit Beleg.
BEKANNT = [
    {"von": "planner", "nach": "infra_osrm", "art": "http", "beleg": "admin/optimizer/admin_payload_adapter.py:141", "text": "Fahrzeiten"},
    {"von": "edge_dispo_admin", "nach": "infra_ollama", "art": "http", "beleg": "fahrer/supabase/functions/dispo-admin/ki.ts:565", "text": "ollama_url aus integration_settings"},
    {"von": "web_dispo", "nach": "planner", "art": "http", "beleg": "admin/src/services/kiDriverPlanner.js:26", "text": "/planner (CP-SAT)"},
    {"von": "push_dienst", "nach": "ext:api.push.apple.com", "art": "http", "beleg": "koordinaten/scripts/push-dienst.js:106", "text": "APNs (HTTP/2)"},
]

# Eigene Dienste (Docker auf 2018 / Mac mini): Host[:Port]-Muster -> Komponente
INFRA = [
    ("infra_osrm", "OSRM Straße", r"^(fahrer-app-lokal-osm-osrm-1:5000|host\.docker\.internal:5001)$"),
    ("infra_osrm_schiene", "OSRM Schiene", r"^(trisar-osrm-schiene:5000|host\.docker\.internal:5002)$"),
    ("infra_osrm_stadtbahn", "OSRM Stadtbahn", r"^(trisar-osrm-stadtbahn:5000|host\.docker\.internal:5003)$"),
    ("infra_nominatim", "Nominatim", r"^(fahrer-app-lokal-osm-nominatim-1|host\.docker\.internal:8088)"),
    ("infra_ollama", "Ollama (Mac mini)", r"(:11434|ollama)"),
    ("kong", None, r"^(kong|localhost)"),
]


def infra_von(host):
    for iid, name, rx in INFRA:
        if re.search(rx, host):
            return iid
    return None


# Was ein Dienst nach außen ist (Host -> lesbarer Name)
EXTERN_NAMEN = {
    "api.tomtom.com": "TomTom", "router.project-osrm.org": "OSRM öffentlich", "nominatim.openstreetmap.org": "Nominatim öffentlich",
    "apis.deutschebahn.com": "Deutsche Bahn API", "www.munich-airport.de": "Flughafen München", "api.lufthansa.com": "Lufthansa API",
    "opensky-network.org": "OpenSky", "auth.opensky-network.org": "OpenSky", "api.aviationstack.com": "aviationstack",
    "fcm.googleapis.com": "Firebase FCM", "oauth2.googleapis.com": "Google OAuth", "www.googleapis.com": "Google APIs",
    "bigquery.googleapis.com": "Google BigQuery", "monitoring.googleapis.com": "Google Monitoring", "api.push.apple.com": "Apple APNs",
    "basemaps.cartocdn.com": "CARTO Karten", "basemapstyles-api.arcgis.com": "Esri Satellit", "api.open-meteo.com": "Open-Meteo",
    "vpic.nhtsa.dot.gov": "NHTSA VIN", "hexdb.io": "hexdb (Flugzeug)", "ev-database.org": "EV-Database",
    "host.docker.internal": None, "esm.sh": None, "cdn.sheetjs.com": None, "ui-avatars.com": None,
    "www.google.com": None, "fahrer.trisar.de": None, "dispo.trisar.de": None, "admin.trisar.de": None,
}


# ---------- SQL-Analyse ----------
def ohne_kommentare(sql):
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return sql


def ohne_strings(sql):
    # Literale leeren, aber URLs/Aktionen vorher separat auslesen
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


TAB = r"(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?"


def set_spalten(rest):
    """Spaltennamen aus 'set a = .., b = ..' bis 'where'/'returning'/';' (nur oberste Klammerebene)."""
    tiefe, aktuell, teile = 0, "", []
    for ch in rest:
        if ch == "(":
            tiefe += 1
        elif ch == ")":
            if tiefe == 0:
                break
            tiefe -= 1
        if ch == "," and tiefe == 0:
            teile.append(aktuell)
            aktuell = ""
            continue
        aktuell += ch
    teile.append(aktuell)
    spalten = []
    for t in teile:
        m = re.match(r"\s*\(?\s*([a-z_][a-z0-9_]*)\s*(?:,|=)", t)
        if m:
            spalten.append(m.group(1))
    return spalten


def sql_analyse(name, quelltext):
    roh = ohne_kommentare(quelltext).lower()
    s = ohne_strings(roh)
    schreibt = defaultdict(set)  # tabelle -> {insert, update:spalte, delete}
    for m in re.finditer(r"\binsert\s+into\s+" + TAB, s):
        if m.group(1) in TABELLEN:
            schreibt[m.group(1)].add("insert")
    for m in re.finditer(r"\bupdate\s+" + TAB + r"(?:\s+(?:as\s+)?[a-z_]+)?\s+set\b", s):
        t = m.group(1)
        if t in TABELLEN:
            ende = re.search(r"\b(where|returning|from)\b|;", s[m.end():])
            stueck = s[m.end(): m.end() + (ende.start() if ende else 600)]
            schreibt[t].add("update")
            for sp in set_spalten(stueck):
                schreibt[t].add("update:" + sp)
    for m in re.finditer(r"\bdelete\s+from\s+" + TAB, s):
        if m.group(1) in TABELLEN:
            schreibt[m.group(1)].add("delete")
    liest = set()
    for m in re.finditer(r"\b(?:from|join)\s+" + TAB, s):
        t = m.group(1)
        vorher = s[max(0, m.start() - 8): m.start()]
        if t in TABELLEN and "delete" not in vorher:
            liest.add(t)
    ruft = set()
    for m in re.finditer(r"(?<![a-z0-9_.])(?:public\.)?([a-z_][a-z0-9_]*)\s*\(", s):
        n = m.group(1)
        if n in FUNKTIONEN and n != name:
            ruft.add(n)
    # Zuweisung an NEW: "new.x := ..." oder als Anweisung "new.x = ..." (nicht in if-Vergleichen)
    neu_spalten = sorted(set(re.findall(r"\bnew\.([a-z_][a-z0-9_]*)\s*:=", s))
                         | set(re.findall(r"(?:^|;|\bthen|\belse|\bbegin|\bloop)\s*new\.([a-z_][a-z0-9_]*)\s*=(?!=)", s)))
    http = []
    for m in re.finditer(r"net\.http_(post|get)\s*\((.{0,600}?)\)\s*;", roh, re.S):
        stueck = m.group(2)
        edge = re.search(r"functions/v1/([a-z_-]+)", stueck)
        aktion = re.search(r"'(?:aktion|action)'\s*,\s*'([a-z_]+)'", stueck)
        host = re.search(r"https?://([a-z0-9.-]+)", stueck)
        http.append({"edge": edge.group(1) if edge else None, "aktion": aktion.group(1) if aktion else None,
                     "host": host.group(1) if host else None})
    notify = sorted(set(re.findall(r"pg_notify\s*\(\s*'([^']+)'", roh)))
    return {
        "schreibt": {t: sorted(v) for t, v in sorted(schreibt.items())},
        "liest": sorted(liest - set(schreibt)),
        "ruft": sorted(ruft),
        "setzt_neu": neu_spalten,
        "http": http,
        "notify": notify,
    }


def trigger_teile(defn):
    m = re.search(r"CREATE (?:CONSTRAINT )?TRIGGER \S+ (BEFORE|AFTER|INSTEAD OF) (.+?) ON ", defn)
    zeit = m.group(1).lower() if m else "?"
    teil = m.group(2) if m else ""
    ereignisse, spalten = [], []
    for e in re.split(r"\s+OR\s+", teil):
        e = e.strip()
        if e.startswith("UPDATE OF"):
            ereignisse.append("update")
            spalten += [c.strip().strip('"') for c in e[len("UPDATE OF"):].split(",")]
        else:
            ereignisse.append(e.lower())
    je = "row" if "FOR EACH ROW" in defn else "statement"
    wenn = re.search(r"WHEN \((.*)\) EXECUTE", defn)
    return {"zeitpunkt": zeit, "ereignisse": ereignisse, "spalten": spalten, "je": je,
            "wenn": wenn.group(1) if wenn else None}


# ---------- Funktionen ----------
funktionen = {}
trigger_funktionen = {t["funktion"] for t in TRIGGER}
for name, varianten in FUNKTIONEN.items():
    a = {"schreibt": defaultdict(set), "liest": set(), "ruft": set(), "setzt_neu": set(), "http": [], "notify": set()}
    for v in varianten:
        r = sql_analyse(name, v["quelltext"])
        for t, ops in r["schreibt"].items():
            a["schreibt"][t] |= set(ops)
        a["liest"] |= set(r["liest"])
        a["ruft"] |= set(r["ruft"])
        a["setzt_neu"] |= set(r["setzt_neu"])
        a["http"] += r["http"]
        a["notify"] |= set(r["notify"])
    v0 = varianten[0]
    rollen = set()
    for v in varianten:
        rollen |= set(v.get("ausfuehrbar_fuer") or [])
    funktionen[name] = {
        "name": name,
        "art": "trigger" if name in trigger_funktionen or v0["rueckgabe"] == "trigger" else ("rpc" if rollen & {"authenticated", "anon"} else "intern"),
        "argumente": [v["argumente"] for v in varianten],
        "rueckgabe": v0["rueckgabe"],
        "sprache": v0["sprache"],
        "security_definer": any(v["security_definer"] for v in varianten),
        "rollen": sorted(rollen),
        "kommentar": v0.get("kommentar"),
        "zeilen": sum(v["quelltext"].count("\n") for v in varianten),
        "schreibt": {t: sorted(o) for t, o in sorted(a["schreibt"].items())},
        "liest": sorted(a["liest"] - set(a["schreibt"])),
        "ruft": sorted(a["ruft"]),
        "setzt_neu": sorted(a["setzt_neu"]),
        "http": a["http"],
        "notify": sorted(a["notify"]),
        "aufgerufen_von": [],
    }

# Funktionen, die in RLS-Policies oder Views stecken
for p in db.get("policies") or []:
    text = ((p.get("bedingung") or "") + " " + (p.get("pruefung") or "")).lower()
    for n in re.findall(r"([a-z_][a-z0-9_]*)\s*\(", text):
        if n in funktionen:
            funktionen[n]["aufgerufen_von"].append({"komponente": "policy", "beleg": f"Policy {p['tabelle']}.{p['name']}"})
for v in db.get("views") or []:
    for n in re.findall(r"([a-z_][a-z0-9_]*)\s*\(", (v.get("definition") or "").lower()):
        if n in funktionen:
            funktionen[n]["aufgerufen_von"].append({"komponente": "view", "beleg": f"View {v['name']}"})


# transitive Wirkung einer Funktion (inkl. gerufener Helfer)
def wirkung(name, gesehen=None):
    gesehen = gesehen or set()
    if name in gesehen or name not in funktionen:
        return {"schreibt": {}, "http": [], "funktionen": []}
    gesehen.add(name)
    f = funktionen[name]
    schreibt = defaultdict(set, {t: set(o) for t, o in f["schreibt"].items()})
    http = list(f["http"])
    fs = [name]
    for r in f["ruft"]:
        w = wirkung(r, gesehen)
        for t, o in w["schreibt"].items():
            schreibt[t] |= set(o)
        http += w["http"]
        fs += w["funktionen"]
    return {"schreibt": {t: sorted(o) for t, o in schreibt.items()}, "http": http, "funktionen": fs}


# ---------- Trigger ----------
trigger = []
for t in TRIGGER:
    teile = trigger_teile(t["definition"])
    trigger.append({"name": t["name"], "tabelle": t["tabelle"], "funktion": t["funktion"], "aktiv": t["aktiv"], **teile})
trigger_je_tabelle = defaultdict(list)
for t in trigger:
    trigger_je_tabelle[t["tabelle"]].append(t)


def loest_aus(tr, ops):
    """Löst eine Schreib-Operation (Menge aus insert/update/update:x/delete) diesen Trigger aus?"""
    for e in tr["ereignisse"]:
        if e in ("insert", "delete", "truncate") and e in ops:
            return True
        if e == "update" and "update" in ops:
            if not tr["spalten"]:
                return True
            gesetzt = {o.split(":", 1)[1] for o in ops if o.startswith("update:")}
            if not gesetzt or gesetzt & set(tr["spalten"]):
                return True
    return False


def kette(tr, tiefe=0, pfad=()):
    w = wirkung(tr["funktion"])
    knoten = {
        "trigger": tr["name"], "tabelle": tr["tabelle"], "funktion": tr["funktion"], "zeitpunkt": tr["zeitpunkt"],
        "ereignisse": tr["ereignisse"], "spalten": tr["spalten"],
        "setzt": funktionen.get(tr["funktion"], {}).get("setzt_neu", []),
        "helfer": [f for f in w["funktionen"] if f != tr["funktion"]],
        "schreibt": w["schreibt"],
        "http": [h for h in w["http"] if h["edge"] or h["host"]],
        "folgen": [],
    }
    if tiefe >= 6:
        knoten["abgeschnitten"] = True
        return knoten
    for tab, ops in w["schreibt"].items():
        for nxt in trigger_je_tabelle.get(tab, []):
            if not loest_aus(nxt, set(ops)):
                continue
            if nxt["name"] in pfad or nxt["name"] == tr["name"]:
                knoten["folgen"].append({"trigger": nxt["name"], "tabelle": tab, "kreis": True})
                continue
            knoten["folgen"].append(kette(nxt, tiefe + 1, pfad + (tr["name"],)))
    return knoten


ketten = [kette(t) for t in trigger if t["aktiv"]]

# ---------- Komponenten + Kanten ----------
komponenten = [{"id": "db", "name": "Supabase Postgres", "art": "db", "dateien": None, "zeilen": None}]
kanten = defaultdict(lambda: {"belege": [], "ops": set()})
extern = {}
nutzung_tabelle = defaultdict(lambda: defaultdict(set))  # tabelle -> komponente -> ops
nutzung_rpc = defaultdict(set)
nutzung_edge = defaultdict(set)
unbekannt = []
EDGE_IDS = {k["name"]: k["id"] for k in code["komponenten"] if k["art"] == "edge"}

for k in code["komponenten"]:
    komponenten.append({kk: k[kk] for kk in ("id", "name", "art", "dateien", "zeilen", "pfade")})
    for t in k["treffer"]:
        beleg = f"{t['datei']}:{t['zeile']}"
        typ, ziel = t["typ"], t["ziel"]
        if typ in ("tabelle", "rest"):
            if ziel in TABELLEN:
                op = t.get("op", "?")
                nutzung_tabelle[ziel][k["id"]].add(op)
                kk = kanten[(k["id"], "tab:" + ziel, "daten")]
                kk["belege"].append(beleg)
                kk["ops"].add(op)
            elif ziel in FUNKTIONEN:
                nutzung_rpc[ziel].add(k["id"])
                funktionen[ziel]["aufgerufen_von"].append({"komponente": k["id"], "beleg": beleg})
            else:
                unbekannt.append({"art": "tabelle", "name": ziel, "komponente": k["id"], "beleg": beleg})
        elif typ == "rpc":
            if ziel in funktionen:
                nutzung_rpc[ziel].add(k["id"])
                funktionen[ziel]["aufgerufen_von"].append({"komponente": k["id"], "beleg": beleg})
                kanten[(k["id"], "fn:" + ziel, "rpc")]["belege"].append(beleg)
            else:
                unbekannt.append({"art": "rpc", "name": ziel, "komponente": k["id"], "beleg": beleg})
        elif typ == "realtime":
            if ziel in TABELLEN:
                nutzung_tabelle[ziel][k["id"]].add("realtime")
                kk = kanten[(k["id"], "tab:" + ziel, "realtime")]
                kk["belege"].append(beleg)
                if ziel not in REALTIME:
                    unbekannt.append({"art": "realtime_nicht_freigegeben", "name": ziel, "komponente": k["id"], "beleg": beleg})
        elif typ == "edge":
            eid = EDGE_IDS.get(ziel)
            if eid:
                nutzung_edge[eid].add(k["id"])
                kanten[(k["id"], eid, "edge")]["belege"].append(beleg)
            else:
                unbekannt.append({"art": "edge", "name": ziel, "komponente": k["id"], "beleg": beleg})
        elif typ == "aktion":
            kanten[(k["id"], "aktion:" + ziel, "aktion")]["belege"].append(beleg)
        elif typ == "extern":
            iid = infra_von(ziel)
            if iid:
                if iid != "kong":
                    kanten[(k["id"], iid, "http")]["belege"].append(beleg)
                continue
            ziel = ziel.split(":")[0]
            if "." not in ziel:
                continue
            name = EXTERN_NAMEN.get(ziel, ziel)
            if name is None:
                continue
            extern.setdefault(ziel, name)
            kanten[(k["id"], "ext:" + ziel, "http")]["belege"].append(beleg)

# DB -> Edge (pg_net)
for f in funktionen.values():
    for h in f["http"]:
        if h["edge"] and h["edge"] in EDGE_IDS:
            kk = kanten[("db", EDGE_IDS[h["edge"]], "pg_net")]
            kk["belege"].append(f"fn {f['name']}" + (f" (aktion {h['aktion']})" if h["aktion"] else ""))

for b in BEKANNT:
    kanten[(b["von"], b["nach"], b["art"])]["belege"].append(b["beleg"])
    if b["nach"].startswith("ext:"):
        h = b["nach"][4:]
        extern.setdefault(h, EXTERN_NAMEN.get(h) or h)

for iid, name, _ in INFRA:
    if name:
        komponenten.append({"id": iid, "name": name, "art": "server", "infra": True})
for host, name in sorted(extern.items()):
    komponenten.append({"id": "ext:" + host, "name": name, "art": "extern", "host": host})

kanten_liste = [{"von": v, "nach": n, "art": a, "ops": sorted(d["ops"] - {"?"}) if d["ops"] else [],
                 "anzahl": len(d["belege"]), "belege": sorted(set(d["belege"]))[:40]}
                for (v, n, a), d in sorted(kanten.items())]

# ---------- Tabellen ----------
geschrieben_von_fn = defaultdict(set)
gelesen_von_fn = defaultdict(set)
for f in funktionen.values():
    for t in f["schreibt"]:
        geschrieben_von_fn[t].add(f["name"])
    for t in f["liest"]:
        gelesen_von_fn[t].add(f["name"])
fk = defaultdict(list)
for x in db.get("fremdschluessel") or []:
    fk[x["von"]].append({"nach": x["nach"], "spalten": x["spalten"]})

tabellen = []
for name, t in sorted(TABELLEN.items()):
    tabellen.append({
        "name": name, "art": t["art"], "zeilen_ca": t["zeilen_ca"], "rls": t["rls"], "realtime": name in REALTIME,
        "spalten": [s["name"] for s in (t["spalten"] or [])], "kommentar": t.get("kommentar"),
        "fremdschluessel": fk.get(name, []),
        "trigger": [tr["name"] for tr in trigger_je_tabelle.get(name, [])],
        "komponenten": {k: sorted(o) for k, o in sorted(nutzung_tabelle[name].items())},
        "geschrieben_von_fn": sorted(geschrieben_von_fn[name]),
        "gelesen_von_fn": sorted(gelesen_von_fn[name]),
        "policies": len([p for p in (db.get("policies") or []) if p["tabelle"] == name]),
    })

# ---------- Befunde ----------
gerufen = set()
for f in funktionen.values():
    gerufen |= set(f["ruft"])
befunde = {
    "unbekannt_im_code": unbekannt,
    "tabellen_ohne_nutzung": [t["name"] for t in tabellen if not t["komponenten"] and not t["geschrieben_von_fn"]
                              and not t["gelesen_von_fn"] and not t["trigger"]],
    "funktionen_ohne_aufrufer": sorted(n for n, f in funktionen.items()
                                       if f["art"] != "trigger" and not f["aufgerufen_von"] and n not in gerufen),
    "trigger_inaktiv": [t["name"] for t in trigger if not t["aktiv"]],
    "kreislaeufe": [],
}


def kreise(k, pfad=()):
    for f in k.get("folgen", []):
        if f.get("kreis"):
            befunde["kreislaeufe"].append(list(pfad) + [k["trigger"], f["trigger"]])
        else:
            kreise(f, pfad + (k["trigger"],))


for k in ketten:
    kreise(k)
# doppelte Kreise (gleiche Menge) zusammenfassen, Schutz gegen Endlosschleife suchen
QUELL = {}
for f in db["funktionen"]:
    QUELL[f["name"]] = QUELL.get(f["name"], "") + f["quelltext"].lower()
TR_FN = {t["name"]: t["funktion"] for t in trigger}
seen, eindeutig = set(), []
for c in befunde["kreislaeufe"]:
    s = frozenset(c)
    if s in seen:
        continue
    seen.add(s)
    schutz = set()
    for tn in c:
        for fn in wirkung(TR_FN[tn])["funktionen"]:
            q = QUELL.get(fn, "")
            if "pg_trigger_depth" in q:
                schutz.add(f"{fn}: pg_trigger_depth")
            if "is distinct from" in q or "is not distinct from" in q:
                schutz.add(f"{fn}: is distinct from")
            if "current_setting" in q:
                schutz.add(f"{fn}: current_setting-Flag")
    eindeutig.append({"trigger": c, "schutz": sorted(schutz)})
befunde["kreislaeufe"] = eindeutig


# ---------- Szenarien ----------
SZ = json.loads((HIER / "szenarien.json").read_text())["szenarien"]
KART = {k["id"]: k for k in komponenten}
PUSH_APPS = sorted({a["komponente"] for a in funktionen.get("push_geraet_melden", {}).get("aufgerufen_von", [])})
REALTIME_ABO = defaultdict(set)
for k in kanten_liste:
    if k["art"] == "realtime":
        REALTIME_ABO[k["nach"][4:]].add(k["von"])
EDGE_RAUS = defaultdict(list)
for k in kanten_liste:
    if k["art"] == "http" and (k["nach"].startswith("ext:") or k["nach"].startswith("infra")):
        EDGE_RAUS[k["von"]].append(k["nach"])


def spur(kid, start):
    if kid == start:
        return "start"
    art = KART.get(kid, {}).get("art")
    return {"app": "apps", "edge": "server", "server": "server", "extern": "extern"}.get(art, "server")


def szenario(sz):
    start = sz["start"]
    schritte = []
    for u in sz.get("ueber", []):
        schritte.append({"art": "aufruf", "von": spur(u["von"], start), "nach": spur(u["nach"], start), "ziel": u["nach"],
                         "text": u["text"], "beleg": u.get("beleg")})
    w = sz["schreiben"]
    tab = w["tabelle"]
    schritte.append({"art": "schreiben", "von": spur(w.get("von", start), start), "nach": "db", "ziel": tab,
                     "text": f"{w['op']} {tab}" + (f" ({w['text']})" if w.get("text") else ""), "beleg": w.get("beleg"),
                     "spalten": w.get("spalten", [])})
    ops = {w["op"]} | {"update:" + c for c in w.get("spalten", [])}
    wurzeln = [t for t in trigger_je_tabelle.get(tab, []) if t["aktiv"] and loest_aus(t, ops)]
    wurzeln.sort(key=lambda t: (t["zeitpunkt"] != "before", t["name"]))
    geschrieben = {tab: {w["op"]}}
    http = []

    def sammeln(k):
        for t, o in k.get("schreibt", {}).items():
            geschrieben.setdefault(t, set()).update(x for x in o if ":" not in x)
        for h in k.get("http", []):
            http.append(dict(h, funktion=k.get("funktion")))
        for f in k.get("folgen", []):
            if not f.get("kreis"):
                sammeln(f)

    def gehen(k, tiefe):
        if k.get("kreis"):
            schritte.append({"art": "kreis", "von": "db", "nach": "db", "tiefe": tiefe, "trigger": k["trigger"], "ziel": k["tabelle"],
                             "text": f"{k['tabelle']}.{k['trigger']} erneut (Rückkopplung)"})
            return
        tr = TR_NACH_NAME[k["trigger"]]
        schritte.append({"art": "trigger", "von": "db", "nach": "db", "tiefe": tiefe, "trigger": k["trigger"], "funktion": k["funktion"],
                         "zeitpunkt": k["zeitpunkt"], "ziel": k["tabelle"], "wenn": tr.get("wenn"),
                         "setzt": k.get("setzt", []), "schreibt": {t: sorted(o) for t, o in k.get("schreibt", {}).items()},
                         "http": [h["edge"] or h["host"] for h in k.get("http", [])]})
        folgen = [f for f in k.get("folgen", [])]
        if tiefe >= 2 and folgen:
            schritte[-1]["weitere"] = len(folgen)
            return
        for f in folgen:
            gehen(f, tiefe + 1)

    for t in wurzeln:
        k = next((x for x in ketten if x["trigger"] == t["name"]), None)
        if k:
            sammeln(k)
            gehen(k, 0)

    gesehen = set()
    for h in http:
        if not h.get("edge") or h["edge"] in gesehen:
            continue
        gesehen.add(h["edge"])
        eid = EDGE_IDS.get(h["edge"])
        schritte.append({"art": "pg_net", "von": "db", "nach": "server", "ziel": eid, "async": True,
                         "text": f"pg_net → {h['edge']}" + (f" ({h['aktion']})" if h.get("aktion") else ""), "funktion": h.get("funktion")})
        raus = sorted(set(EDGE_RAUS.get(eid, [])))
        if raus:
            schritte.append({"art": "http", "von": "server", "nach": "extern", "ziel": raus,
                             "text": h["edge"] + " kann rufen: " + ", ".join(KART.get(r, {}).get("name", r) for r in raus),
                             "hinweis": "alle Ziele der Edge Function, nicht nur dieser Zweig"})
    if "push_ausgang" in geschrieben:
        schritte.append({"art": "push", "von": "db", "nach": "server", "ziel": "push_dienst", "async": True,
                         "text": "Push-Dienst holt neue Zeilen aus push_ausgang", "beleg": "koordinaten/scripts/push-dienst.js:224"})
        schritte.append({"art": "http", "von": "server", "nach": "extern", "ziel": ["ext:api.push.apple.com", "ext:fcm.googleapis.com"],
                         "text": "an APNs (iOS) und FCM (Android)", "async": True})
        schritte.append({"art": "mitteilung", "von": "extern", "nach": "apps", "ziel": PUSH_APPS, "async": True,
                         "text": "Mitteilung auf " + ", ".join(KART[a]["name"] for a in PUSH_APPS if a in KART)})
    for t in sorted(geschrieben):
        abo = sorted(REALTIME_ABO.get(t, set()) - {start}) if t in REALTIME else []
        if abo:
            schritte.append({"art": "realtime", "von": "db", "nach": "apps", "ziel": abo, "tabelle": t, "async": True,
                             "text": f"realtime {t} → " + ", ".join(KART[a]["name"] for a in abo if a in KART)})
    return {"id": sz["id"], "titel": sz["titel"], "start": start, "schritte": schritte,
            "geschrieben": {t: sorted(o) for t, o in sorted(geschrieben.items())},
            "zusammenfassung": {"trigger": sum(1 for x in schritte if x["art"] == "trigger"),
                                "tabellen": len(geschrieben), "pg_net": len(gesehen),
                                "push": "push_ausgang" in geschrieben,
                                "realtime_apps": sorted({a for x in schritte if x["art"] == "realtime" for a in x["ziel"]})}}


TR_NACH_NAME = {t["name"]: t for t in trigger}
szenarien = [szenario(s) for s in SZ]

# ---------- Status-Automat (Regeln aus trisar_evaluate_job_status) ----------
EIN = db.get("status_einstellungen") or {}
RAD = db.get("orte_radien") or {}
STD = RAD.get("standard") or {}
ZUSTAENDE = [
    {"id": "pending", "name": "offen", "alias": ["pending", "offen", "new", "requested", "offered"]},
    {"id": "assigned", "name": "angenommen", "alias": ["assigned", "zugewiesen"]},
    {"id": "at_pickup", "name": "beim Gast", "alias": ["at_pickup", "pickup", "beim_pickup", "beim pickup"]},
    {"id": "in_progress", "name": "unterwegs", "alias": ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"]},
    {"id": "done", "name": "beendet", "alias": ["done", "completed", "arrived", "beendet"]},
    {"id": "cancelled", "name": "storniert", "alias": ["cancelled", "canceled", "storniert", "stoniert"]},
    {"id": "refused", "name": "abgelehnt", "alias": ["refused"]},
]
ALIAS = {a: z["id"] for z in ZUSTAENDE for a in z["alias"]}
rein = STD.get("rein") or EIN.get("status_pickup_enter_radius_m")
raus = STD.get("raus") or EIN.get("status_pickup_exit_radius_m")
ziel_rein = STD.get("rein") or EIN.get("status_dropoff_done_radius_m")
REGELN = [
    {"von": ["pending", "assigned"], "nach": "at_pickup", "kurz": "≤ Rein-Radius",
     "regel": f"Fahrer ist höchstens Rein-Radius vom Abholort entfernt (Standard {rein} m, eigener Ort: dessen Radius) und die Fahrt ist dran.",
     "bedingungen": [f"Fahrt ist dran: Start höchstens {EIN.get('status_vorlauf_min', 90)} min voraus, nicht mehr als 3 h vorbei",
                     "Fahrer hat keine andere Fahrt beim Gast oder unterwegs",
                     "Fahrt ohne Start (Start = Fahrer-Standort): erst nach dem Annehmen",
                     "Standort höchstens 2 min alt, sonst Routen-Distanz höchstens 5 min alt"]},
    {"von": ["at_pickup"], "nach": "in_progress", "kurz": f"{EIN.get('status_pickup_depart_hits', 2)}× > Raus-Radius",
     "regel": f"{EIN.get('status_pickup_depart_hits', 2)} Standort-Punkte in Folge weiter als Raus-Radius (Standard {raus} m) vom Abholort.",
     "bedingungen": ["Ohne Distanz (kein Standort, keine Route) keine Entscheidung", "Zähler in job_status_runtime.pickup_exit_hits"]},
    {"von": ["in_progress"], "nach": "done", "kurz": f"{EIN.get('status_dropoff_done_hits', 2)}× ≤ Ziel-Radius",
     "regel": f"{EIN.get('status_dropoff_done_hits', 2)} Treffer innerhalb Rein-Radius des Ziels (Standard {ziel_rein} m). Punkt außerhalb zieht einen Treffer ab.",
     "bedingungen": ["Zähler in job_status_runtime.dropoff_near_hits"]},
]
for r in REGELN:
    r.update({"funktion": "trisar_evaluate_job_status", "ausloeser": ["trg_driver_live_status_eval", "trg_jobs_status_eval"],
              "schreibt_ueber": "trisar_transition_job_status"})
AUTO_QUELLEN = {"driver_live_trigger", "jobs_trigger", "db_engine"}
uebergaenge = defaultdict(lambda: {"auto": 0, "hand": 0, "quellen": defaultdict(int), "zuletzt": None})
for u in db.get("status_uebergaenge") or []:
    v, n = ALIAS.get(u["von"], u["von"] or "neu"), ALIAS.get(u["nach"], u["nach"])
    e = uebergaenge[(v, n)]
    e["auto" if u["quelle"] in AUTO_QUELLEN else "hand"] += u["anzahl"]
    e["quellen"][u["quelle"]] += u["anzahl"]
    e["zuletzt"] = max(filter(None, [e["zuletzt"], u["zuletzt"]]))
bestand = defaultdict(int)
for s_, n in (db.get("status_bestand") or {}).items():
    bestand[ALIAS.get(s_, s_)] += n
status = {
    "zustaende": [dict(z, bestand=bestand.get(z["id"], 0)) for z in ZUSTAENDE],
    "regeln": REGELN,
    "uebergaenge": [{"von": v, "nach": n, "auto": e["auto"], "hand": e["hand"], "quellen": dict(e["quellen"]), "zuletzt": e["zuletzt"]}
                    for (v, n), e in sorted(uebergaenge.items(), key=lambda x: -(x[1]["auto"] + x[1]["hand"]))],
    "einstellungen": EIN, "radien": RAD,
    "protokoll": {"tabelle": "job_status_history", "trigger": "jobs_status_protokoll", "quelle_hand": "app"},
}

modell = {
    "stand_db": db["stand"],
    "komponenten": komponenten,
    "kanten": kanten_liste,
    "tabellen": tabellen,
    "funktionen": sorted(funktionen.values(), key=lambda f: f["name"]),
    "trigger": trigger,
    "ketten": ketten,
    "befunde": befunde,
    "szenarien": szenarien,
    "status": status,
}
(HIER / "modell.json").write_text(json.dumps(modell, ensure_ascii=False, indent=1))
print(f"Modell: {len(komponenten)} Komponenten, {len(kanten_liste)} Kanten, {len(tabellen)} Tabellen, "
      f"{len(funktionen)} Funktionen, {len(trigger)} Trigger")
print(f"Befunde: {len(unbekannt)} unbekannte Bezüge im Code, {len(befunde['tabellen_ohne_nutzung'])} ungenutzte Tabellen, "
      f"{len(befunde['funktionen_ohne_aufrufer'])} Funktionen ohne Aufrufer, {len(befunde['kreislaeufe'])} Trigger-Kreisläufe")
