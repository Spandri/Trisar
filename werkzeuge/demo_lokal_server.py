"""Demo lokal ansehen (wie demo.trisar.de), ohne zu veroeffentlichen.

Vorher die Apps in demo/deploy bauen:
  (cd admin && VITE_DATENQUELLE=demo npx vite build --base=/admin/ --outDir ../demo/deploy/admin --emptyOutDir)
  (cd fahrer && VITE_DATENQUELLE=demo npx vite build --base=/fahrer/ --outDir ../demo/deploy/fahrer --emptyOutDir)
Dann: python3 werkzeuge/demo_lokal_server.py [Port], Standard 5331.
Jede Antwort mit Cache-Control: no-store, damit immer der neue Stand erscheint.
"""
import functools
import http.server
import pathlib
import sys

ORDNER = pathlib.Path(__file__).resolve().parent.parent / "demo" / "deploy"


class OhneCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5331
    handler = functools.partial(OhneCache, directory=str(ORDNER))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
