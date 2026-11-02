-- 02.11.2026: Besuchskennung (vid) und Haken "im Browser geoeffnet" (js), siehe functions/besuch-da.js
ALTER TABLE besuche ADD COLUMN vid TEXT;
ALTER TABLE besuche ADD COLUMN js INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS besuche_vid ON besuche (vid);
