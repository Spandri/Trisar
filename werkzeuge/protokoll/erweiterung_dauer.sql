-- 02.11.2026: Verweildauer. aktiv_s = Sekunden, in denen der Tab sichtbar war; zuletzt = letztes Lebenszeichen.
ALTER TABLE besuche ADD COLUMN aktiv_s INTEGER;
ALTER TABLE besuche ADD COLUMN zuletzt INTEGER;
