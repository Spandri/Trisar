# Koordinaten App (lokal)

## Start

```bash
cp .env.example .env.local
npm ci --no-audit --no-fund
npm run dev
```

Die App laeuft dann unter `http://127.0.0.1:5175`.

## Teltonika Gateway (FMB010 ohne Traccar)

### 1) Mapping-Tabelle anlegen

Fuehre in Supabase SQL zuerst aus:

`db/add_imei_driver_map.sql`

Dann ein Mapping setzen:

```sql
insert into public.imei_driver_map (imei, driver_id)
values ('123456789012345', '00000000-0000-0000-0000-000000000000')
on conflict (imei) do update
set driver_id = excluded.driver_id, is_active = true;
```

### 2) Gateway starten

```bash
npm run teltonika:gateway
```

ENV:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional `TELTONIKA_TCP_HOST` (default `0.0.0.0`)
- optional `TELTONIKA_TCP_PORT` (default `5027`)
- optional `TELTONIKA_HEALTH_PORT` (default `8788`)
- optional `TELTONIKA_SOURCE` (default `teltonika_fmb010`)
- optional `TELTONIKA_BLOCK_NO_GPS_FIX_FOR_LIVE` (default `false`; `true` blockiert Live-Updates bei `Sat < TELTONIKA_MIN_SATELLITES_FOR_FIX`)
- optional `TELTONIKA_COMMAND_DEFAULT` (default `getgps`)
- optional `TELTONIKA_COMMAND_RESPONSE_TIMEOUT_MS` (default `15000`)
- optional `TELTONIKA_COMMAND_TOKEN` (wenn gesetzt: Pflicht-Header `x-command-token`)

Healthcheck:

`http://localhost:8788/healthz`

Command API:

- Queue/Status: `GET http://localhost:8788/commands`
- Queue/Status pro IMEI: `GET http://localhost:8788/commands?imei=<IMEI>`
- Command senden: `POST http://localhost:8788/command`

Beispiel:

```bash
curl -X POST http://127.0.0.1:8788/command \
  -H 'content-type: application/json' \
  --data '{"imei":"357544371355146","command":"getgps","requestedBy":"manual"}'
```

Alternativ per `driverId`:

```bash
curl -X POST http://127.0.0.1:8788/command \
  -H 'content-type: application/json' \
  --data '{"driverId":"<driver-uuid>","command":"getgps","requestedBy":"manual"}'
```

## KI RAG (Ollama + Supabase pgvector)

### 1) SQL einmalig ausfuehren

Im Supabase SQL Editor:

- `db/add_rag_ai_documents.sql`

### 2) ENV setzen (`.env.local`)

```env
VITE_KI_PROVIDER=ollama
VITE_OLLAMA_URL=http://127.0.0.1:11434
VITE_OLLAMA_MODEL=llama3.1:8b
VITE_OLLAMA_EMBED_MODEL=nomic-embed-text
VITE_OLLAMA_EMBED_ENDPOINT=/api/embeddings
VITE_PGVECTOR_ENABLED=true
VITE_RAG_MATCH_COUNT=8
VITE_RAG_MIN_SIMILARITY=0.42
```

### 3) Wissensdokumente ablegen

Dateien in `rag-docs/` ablegen (z. B. `.md`, `.txt`, `.csv`, `.json`).

### 4) Ingestion starten

```bash
npm run rag:ingest
```

Optional alles vom Projekt root indexieren:

```bash
npm run rag:ingest:all
```
