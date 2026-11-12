-- KI-Assistent: Modell laeuft ab 11.11. auf dem Mac mini (immer an), das M1-MacBook ist Ersatz.
-- dispo-admin/ki.ts prueft beide und nimmt den ersten erreichbaren (erst ollama_url, dann ollama_url_ersatz).
-- Ollama auf dem Mini: LaunchAgent de.trisar.ollama, lauscht nur auf der Tailscale-Adresse.

insert into public.integration_settings (key, value, description)
values ('ollama_url', to_jsonb('http://100.121.170.114:11434'::text), 'KI-Assistent: Ollama auf dem Mac mini (Tailnet)')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.integration_settings (key, value, description)
values ('ollama_url_ersatz', to_jsonb('http://100.91.160.11:11434'::text), 'KI-Assistent: Ersatz, wenn der Mac mini aus ist (M1-MacBook)')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.integration_settings (key, value, description)
values ('ollama_model', to_jsonb('llama3.1:8b'::text), 'KI-Assistent: Modell (auf beiden Rechnern geladen)')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
