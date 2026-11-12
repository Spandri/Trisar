-- Eigene Orte: alle neuen Icons (werkzeuge/icons-neu) sind waehlbar. Die Apps kennen die Liste,
-- die Datenbank prueft nur noch die Form des Schluessels.
alter table public.orte drop constraint if exists orte_icon_check;
alter table public.orte add constraint orte_icon_check check (icon ~ '^[a-z][a-z0-9_]{0,40}$');
