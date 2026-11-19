#!/usr/bin/env python3
"""Empfaenger fuer Konfigurator-Daten (18.11.2026).

Hersteller-Konfiguratoren blocken fetch an localhost per CSP. Darum schickt das Sammel-Skript die Daten
als URL-Anker: http://127.0.0.1:5341/#name=<datei>&daten=<json>&zurueck=<url>.
Die Seite hier liest den Anker, schickt ihn per POST an diesen Server, der speichert die Datei
in konfigurator/eingang/<name> und leitet zurueck.
Aufruf: python3 empfaenger.py   (Strg+C beendet)
"""
import http.server, json, os, re

HIER = os.path.dirname(os.path.abspath(__file__))
EINGANG = os.path.join(HIER, "eingang")
SEITE = b"""<!doctype html><meta charset=utf-8><body>speichere ...<script>
const p=new URLSearchParams(location.hash.slice(1));
fetch('/speichern',{method:'POST',body:JSON.stringify({name:p.get('name'),daten:p.get('daten')})})
 .then(r=>r.text()).then(t=>{document.body.textContent=t; const z=p.get('zurueck'); if(z) setTimeout(()=>location.href=z,800);});
</script>"""


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(SEITE)

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        name = re.sub(r"[^a-zA-Z0-9._-]", "_", d.get("name") or "daten.json")
        os.makedirs(EINGANG, exist_ok=True)
        ziel = os.path.join(EINGANG, name)
        with open(ziel, "w") as f:
            f.write(d.get("daten") or "")
        print("gespeichert", ziel, flush=True)
        self.send_response(200); self.end_headers(); self.wfile.write(f"gespeichert {name}".encode())


http.server.HTTPServer(("127.0.0.1", 5341), H).serve_forever()
