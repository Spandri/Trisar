# Trisar Lokal Start/Stop (Fahrer + Koordinaten)

## Voraussetzungen

- Node.js `22.x` verwenden (nicht `23.x`)
- Zwei Terminal-Fenster offen halten
- Keine Kommentare hinter Befehlen mitschreiben (kein `# ...`)

Wenn `node -v` nicht mit `v22` startet:

```bash
brew install node@22
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v
```

## Einmaliges Setup

### Fahrer

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
cp .env.example .env.local
npm ci --no-audit --no-fund
```

### Koordinaten

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/koordinaten-app-lokal
cp .env.example .env.local
npm ci --no-audit --no-fund
```

## Sauber starten

Vor jedem Start alte Dev-Server stoppen:

```bash
pkill -f "node_modules/.bin/vite" || true
```

### Terminal 1: Fahrer starten (Port 5173)

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
npm run dev
```

### Terminal 2: Koordinaten starten (Port 5175)

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/koordinaten-app-lokal
npm run dev
```

Im Browser:

- `http://127.0.0.1:5173` (Fahrer)
- `http://127.0.0.1:5175` (Koordinaten)

## Sauber beenden

### Standard (empfohlen)

In jedem Dev-Terminal `Ctrl + C` drücken.

### Falls Prozesse hängen

```bash
pkill -f "node_modules/.bin/vite"
```

Optional prüfen, ob Ports frei sind:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:5175 -sTCP:LISTEN
```

Wenn keine Ausgabe kommt, sind alle Ports frei.

## Häufige Fehler

- `Port 5173/5175 is already in use`:
  - Alte Vite-Prozesse laufen noch. `pkill -f "node_modules/.bin/vite"` ausführen.
- `zsh: bad pattern: #`:
  - Du hast Kommentartext mitkopiert. Befehl ohne `# ...` ausführen.
- `Invalid authentication credentials`:
  - `.env.local` enthält falsche Supabase-Werte.
- Google Maps lädt nicht:
  - `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` prüfen und Dev-Server neu starten.

## Docker (beide Apps zusammen)

Die Compose-Datei liegt in `fahrer-app-lokal/docker-compose.yml` und startet:

- `fahrer` auf `http://127.0.0.1:5173`
- `koordinaten` auf `http://127.0.0.1:5175`

### Start

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
docker compose up
```

### Stop (sauber)

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
docker compose down
```

## Docker (lokaler OSM-Stack für Planung)

Der OSM-Stack startet zwei lokale Dienste:

- `osm-osrm` auf `http://127.0.0.1:5001` (Routing/Fahrzeit)
- `osm-nominatim` auf `http://127.0.0.1:8088` (Geocoding)

### 1) OSM-Umgebung anlegen

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
cp .env.osm.example .env.osm
```

### 2) Initial import + Start

```bash
npm run docker:osm:up
```

Hinweis: Der erste Lauf kann je nach Hardware länger dauern (PBF-Download + Import/Preprocessing).

### 3) Logs ansehen

```bash
npm run docker:osm:logs
```

### 4) Stop

```bash
npm run docker:osm:down
```

### 5) Python-Adapter auf lokale OSM-Services zeigen lassen

```bash
export TRISAR_OSM_NOMINATIM_URL=http://127.0.0.1:8088
export TRISAR_OSM_OSRM_URL=http://127.0.0.1:5001
```

Diese ENV-Variablen werden vom Adapter in `admin-app-lokal/optimizer/admin_payload_adapter.py` automatisch verwendet.

## Dienstplan-Optimierer (CP-SAT) im Docker-Stack

Der neue Planer läuft als eigener Service:

- `planner` auf `http://127.0.0.1:8790`
- Healthcheck: `http://127.0.0.1:8790/health`
- Solve-Endpoint: `POST http://127.0.0.1:8790/solve`

Wichtig für die Admin-App:

- In `admin-app-lokal/src/services/kiDriverPlanner.js` ist `VITE_KI_PROVIDER` standardmäßig auf `cp_sat`.
- Die Admin-Vite-Proxy-Route `/planner` zeigt auf `http://host.docker.internal:8790`.

Start mit den normalen App-Skripten:

```bash
npm run docker:apps:up
```

Damit wird jetzt auch der `planner`-Container gestartet.

## Website an Freund schicken (öffentlicher Link)

Mit Cloudflare Quick Tunnel (kein eigener Server nötig):

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
docker compose --profile share up
```

Oder kurz per npm-Script:

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
npm run docker:share
```

Einfacher 3-Schritte-Start (wie in Docker Desktop nacheinander):

1) Supabase starten (in deinem Supabase-Projekt)  
2) Apps starten:

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
npm run docker:apps:up
```

3) Cloudflare-Tunnel starten:

```bash
npm run docker:cloudflare:up
```

Mit Named Tunnel bleiben die Links fix:

- `https://fahrer.trisar.de`
- `https://supabase.trisar.de`

Wenn du nur die Tunnel-Logs sehen willst:

```bash
npm run docker:logs:tunnels
```

## Cloudflare DDNS für OBD (automatische IP-Updates)

Einmalig Datei anlegen:

```bash
cd /Users/stefanospandri/Documents/Projekte/Trisar/Programm/fahrer-app-lokal
cp .env.cloudflare-ddns.example .env.cloudflare-ddns
```

Dann in `.env.cloudflare-ddns` setzen:

- `CLOUDFLARE_API_TOKEN=<dein-token>`
- `DOMAINS=obd.deinedomain.tld`

DDNS starten/stoppen:

```bash
npm run docker:ddns:up
npm run docker:ddns:logs
npm run docker:ddns:down
```

Wichtig:

- DNS-Record muss `DNS only` (graue Wolke) sein.
- Teltonika `Domain` auf `obd.deinedomain.tld`, `Port` `5027`, `TCP`.

### Wenn Supabase lokal auf `localhost:54321` läuft

Die Apps proxyen Supabase automatisch auf `/supabase` und leiten intern auf `host.docker.internal:54321` weiter.
Du musst `VITE_SUPABASE_URL` in `.env.local` nicht mehr bei jedem Neustart auf eine neue Tunnel-URL setzen.

## Supabase API-Zentralisierung (neu)

### 1) SQL ausführen

Im Supabase SQL Editor diese Datei ausführen:

- `db/supabase_api_centralization.sql`

### 2) Secrets setzen (nur serverseitig)

```bash
supabase secrets set AVIATIONSTACK_API_KEY=...
supabase secrets set GOOGLE_PLACES_SERVER_KEY=...
supabase secrets set GOOGLE_ROUTES_SERVER_KEY=...
supabase secrets set LUFTHANSA_GROUP_OPERATING_CARRIERS=LH,VL,EW,E2,LX,OS,SN,EN,4Y
supabase secrets set LH_CLIENT_ID=...
supabase secrets set LH_CLIENT_SECRET=...
supabase secrets set OPENSKY_CLIENT_ID=...
supabase secrets set OPENSKY_CLIENT_SECRET=...
supabase secrets set GCP_SERVICE_ACCOUNT_EMAIL=...
supabase secrets set GCP_SERVICE_ACCOUNT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
supabase secrets set GCP_BILLING_PROJECT_ID=...
supabase secrets set GCP_BILLING_DATASET=...
supabase secrets set GCP_BILLING_TABLE=gcp_billing_export_resource_v1_XXXXXX_XXXXXX_XXXXXX
supabase secrets set GCP_BIGQUERY_LOCATION=EU
supabase secrets set GCP_MAPS_SERVICE_NAME='Google Maps Platform'
supabase secrets set GCP_MONITORING_PROJECT_ID=...
supabase secrets set GCP_MONITORING_FILTER='metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"'
```

Lokal ohne Supabase-Cloud-Account:

- Trage `LH_CLIENT_ID` und `LH_CLIENT_SECRET` in `supabase/functions/.env.local` ein.
- Starte die Functions lokal neu, damit die neuen ENV-Variablen geladen werden.

### 3) Edge Functions deployen

```bash
supabase functions deploy external-sync
supabase functions deploy places-proxy
supabase functions deploy flight-validate
supabase functions deploy airport-board
supabase functions deploy billing-sync-costs
```

### 4) Wichtig für Frontend

- `VITE_AVIATIONSTACK_API_KEY` wird nicht mehr verwendet.
- Flight/Route/Places laufen über Supabase Functions.
- Flights werden bei der Auswahl auf `OperatingCarrier` gefiltert; nur Carrier aus `LUFTHANSA_GROUP_OPERATING_CARRIERS` gelten als "echte" Lufthansa-Group-Flüge.
- Wenn `LH_CLIENT_ID` + `LH_CLIENT_SECRET` gesetzt sind, nutzt `external-sync` Lufthansa Flight Status (OAuth). Ohne diese Werte fällt es auf den bisherigen Flight-Provider zurück.
- `flight-validate` validiert Flugnummern vor dem Speichern (inkl. OperatingCarrier-Check auf Lufthansa Group).
- `airport-board` liefert Live-Ankünfte/-Abflüge für einen IATA-Airport-Code (z. B. `MUC`).
- Für Airport-Jobs ergänzt `external-sync` Live-Flugpositionen über HexDB + OpenSky (`ext_flight_payload.live_tracking` inkl. `radar_hex`, `latitude`, `longitude`).
- Beim Klick auf Fahrten werden nur gespeicherte Job-Daten gelesen.
- Externe API-Calls passieren nur bei `Fahrt anlegen` und beim manuellen `Refresh`.
- Function-Namen liegen zentral in `src/config/supabase-functions.js`.

## Token Visualisierung

### SQL Editor: Verbrauch pro User

```sql
select
  user_id,
  service,
  total_tokens,
  requests,
  last_used_at
from public.v_ai_token_usage_by_user
order by total_tokens desc;
```

### SQL Editor: Gesamt pro User

```sql
select
  user_id,
  sum(tokens_used)::bigint as total_tokens
from public.ai_token_usage
group by user_id
order by total_tokens desc;
```

## API-Token Dashboard (Docker + Grafana)

Interaktive Monitoring-UI für API-Verbrauch über Zeiträume:

- API Requests nach Provider (Zeitreihe)
- Token Usage nach Service (Zeitreihe)
- Fehlerquote / Cache-Hit-Rate
- Verteilung pro Provider/Service
- Tabelle mit letzten API-Fehlern

### Starten

```bash
cd fahrer-app-lokal
docker compose up -d api-usage-grafana
```

### Öffnen

- URL: `http://localhost:3001`
- Login: `admin` / `admin`
- Dashboard: `Trisar / API Token & Usage Monitor`

Hinweis:
- Das Dashboard liest direkt aus der lokalen Supabase-DB (`host.docker.internal:54322`).
- Dafür muss dein lokaler Supabase-Stack laufen (`supabase start`).

## Google Cloud Kosten-Import (BigQuery + Monitoring)

### SQL ausführen

Im Supabase SQL Editor ausführen:

- `db/api_usage_cost_tracking.sql`

### Lokal (ohne Supabase Cloud Login)

Wenn dein Projekt nur lokal auf deinem Rechner läuft, brauchst du **kein** `supabase login`.

1. Lokalen Stack starten:
```bash
supabase start
```

2. GCP-Variablen in `supabase/functions/.env.local` eintragen:
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GCP_BILLING_PROJECT_ID`
- `GCP_MONITORING_PROJECT_ID`
- `GCP_BILLING_DATASET`
- `GCP_BILLING_TABLE`
- `GCP_BIGQUERY_LOCATION`
- `GCP_MAPS_SERVICE_NAME`
- `GCP_MONITORING_FILTER`

3. Functions lokal serven:
```bash
supabase functions serve billing-sync-costs --env-file supabase/functions/.env.local --no-verify-jwt
```

### BigQuery Billing Export (Google Cloud)

Aktiviere im Billing Account:

- Detailed usage cost export
- Pricing export (optional aber empfohlen)

Ziel-Dataset muss mit `GCP_BILLING_PROJECT_ID` + `GCP_BILLING_DATASET` übereinstimmen.

Wichtig beim ersten Aktivieren:
- Die Tabelle `gcp_billing_export_resource_v1_...` wird oft erst nach einigen Stunden angelegt (bis zu 24h).
- Vorher sind 404-Fehler auf BigQuery normal.

### Import ausführen (manuell)

Mit einem `service_role` Token:

```bash
curl -sS -X POST \
  "$SUPABASE_URL/functions/v1/billing-sync-costs" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"all","start_date":"2026-05-01","end_date":"2026-05-06"}'
```

### Monitoring zuerst testen (empfohlen)

Wenn der Billing-Export noch nicht bereit ist, nur Monitoring importieren:

```bash
curl -sS -X POST \
  "http://127.0.0.1:54321/functions/v1/billing-sync-costs" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q" \
  -H "Content-Type: application/json" \
  -d '{"mode":"monitoring","monitoring_start_iso":"2026-05-06T00:00:00Z","monitoring_end_iso":"2026-05-06T23:59:59Z"}'
```

Monitoring prüfen:

```sql
select observed_at, provider, metric_type, response_code, value
from public.api_usage_monitoring_timeseries
order by observed_at desc
limit 100;
```

### Wichtige Views

```sql
select * from public.v_api_cost_live;
select * from public.v_api_cost_actual_live;
select * from public.v_api_cost_estimated_vs_actual_daily order by usage_date desc, provider;
```

Nur Maps-relevante Monitoring-Events:

```sql
select observed_at, provider, response_code, value
from public.api_usage_monitoring_timeseries
where provider in ('google-maps-platform', 'directions-backend.googleapis.com')
order by observed_at desc
limit 100;
```

### Grafana Monitoring

- URL: `http://localhost:3001`
- Login: `admin` / `admin`
- Dashboard: `Trisar / API Token & Usage Monitor`

Hinweis:
- `bigquery.googleapis.com` mit `404` in Monitoring kann während der Initialphase normal sein, wenn die Billing-Export-Tabelle noch nicht existiert.

## Sicherheits-Hinweis vor dem Teilen

- Frontend darf keinen `service_role`-Supabase-Key enthalten.
- Für öffentliche Links nur einen eingeschränkten `anon` Key nutzen.
- Wenn sensible Daten in der DB sind, besser Demo-Datenbank verwenden.
