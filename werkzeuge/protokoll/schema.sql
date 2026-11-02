-- Besucherprotokoll demo.trisar.de (fuer neue Datenbanken; bestehende: erweiterung_ki.sql, dann erweiterung_beweis.sql, erweiterung_dauer.sql) (D1 trisar-demo-besuche), siehe functions/_middleware.js
CREATE TABLE IF NOT EXISTS besuche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,      -- Zeitpunkt in ms seit 1970 (UTC)
  art TEXT NOT NULL,       -- besuch | ki | vorschau | bot
  daten TEXT NOT NULL,     -- JSON: pfad, quelle, herkunft, stadt, region, land, netz, geraet, browser, sprache, ua, ki
  vid TEXT,                -- Kennung des Besuchs fuer die Rueckmeldung aus dem Browser
  js INTEGER NOT NULL DEFAULT 0, -- 1, wenn die Seite im Browser lief (functions/besuch-da.js)
  ray TEXT,                -- Cloudflare-Anfrage-ID (cf-ray) des Seitenaufrufs
  roh TEXT,                -- JSON: vollstaendige Kennung, Kopfzeilen ohne Cookies und IP, ASN, Rechenzentrum ...
  js_t INTEGER,            -- Zeitpunkt der Rueckmeldung aus dem Browser
  js_ray TEXT,             -- Ray-ID der Rueckmeldung
  js_roh TEXT,             -- JSON: Rohdaten der Rueckmeldung
  aktiv_s INTEGER,         -- Verweildauer: Sekunden, in denen der Tab sichtbar war
  zuletzt INTEGER          -- letztes Lebenszeichen aus dem Browser (ms)
);
CREATE INDEX IF NOT EXISTS besuche_vid ON besuche (vid);
CREATE INDEX IF NOT EXISTS besuche_t ON besuche (t);
