-- 02.11.2026: Beweissicherung. Cloudflare-Anfrage-ID (Ray-ID) und Rohdaten des Seitenaufrufs,
-- dazu Zeit, Ray-ID und Rohdaten der Rueckmeldung aus dem Browser (functions/besuch-da.js).
ALTER TABLE besuche ADD COLUMN ray TEXT;
ALTER TABLE besuche ADD COLUMN roh TEXT;
ALTER TABLE besuche ADD COLUMN js_t INTEGER;
ALTER TABLE besuche ADD COLUMN js_ray TEXT;
ALTER TABLE besuche ADD COLUMN js_roh TEXT;
