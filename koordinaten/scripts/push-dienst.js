#!/usr/bin/env node
// Push-Dienst: schickt Mitteilungen aus push_ausgang an iPhones (APNs) und Android (FCM)
// und ruft jede Minute push_erinnerungen() fuer die zeitgesteuerten Erinnerungen auf.
//
// Ohne Zusatzpakete (nur Node 22): Supabase ueber REST, APNs ueber HTTP/2, FCM ueber HTTP v1.
// Zugangsdaten stehen in integration_settings (nur service_role liest dort):
//   apns_key_p8, apns_key_id, apns_team_id      Apple-Push-Schluessel (.p8)
//   fcm_service_account                          Firebase-Dienstkonto (JSON)
// Fehlt einer davon, bleiben Mitteilungen fuer diese Plattform liegen, bis er da ist.
//
// Start: node scripts/push-dienst.js   (Umgebung: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.PUSH_ENV_PATH || path.join(HIER, '..', '.env.local');

const ladeUmgebung = (datei) => {
  if (!fs.existsSync(datei)) return;
  for (const zeile of fs.readFileSync(datei, 'utf8').split(/\r?\n/)) {
    const t = zeile.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
};
ladeUmgebung(ENV_PATH);

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const DIENST_SCHLUESSEL = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TAKT_MS = Number(process.env.PUSH_TAKT_MS || 3000);
const ERINNERUNG_MS = 60_000;
const BUNDLE = { fahrer: 'de.trisar.fahrer', dispo: 'de.trisar.dispo' };

if (!SUPABASE_URL || !DIENST_SCHLUESSEL) {
  console.error('[push] SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.');
  process.exit(1);
}

const log = (...teile) => console.log(new Date().toISOString(), '[push]', ...teile);

// --- Supabase REST -------------------------------------------------------------

const rest = async (pfad, { methode = 'GET', koerper, kopf = {} } = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    method: methode,
    headers: {
      apikey: DIENST_SCHLUESSEL,
      Authorization: `Bearer ${DIENST_SCHLUESSEL}`,
      'Content-Type': 'application/json',
      ...kopf,
    },
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${methode} ${pfad}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

let einstellungenZeit = 0;
let einstellungen = {};
const zugang = async () => {
  if (Date.now() - einstellungenZeit < 5 * 60_000) return einstellungen;
  const zeilen = await rest('integration_settings?select=key,value&key=in.(apns_key_p8,apns_key_id,apns_team_id,fcm_service_account)');
  einstellungen = Object.fromEntries((zeilen || []).map((z) => [z.key, typeof z.value === 'string' ? z.value : JSON.stringify(z.value)]));
  einstellungenZeit = Date.now();
  return einstellungen;
};

// --- APNs ----------------------------------------------------------------------

const b64url = (puffer) => Buffer.from(puffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let apnsJwt = { wert: '', zeit: 0, kid: '' };
const apnsToken = (z) => {
  if (apnsJwt.wert && apnsJwt.kid === z.apns_key_id && Date.now() - apnsJwt.zeit < 40 * 60_000) return apnsJwt.wert;
  const kopf = b64url(JSON.stringify({ alg: 'ES256', kid: z.apns_key_id }));
  const inhalt = b64url(JSON.stringify({ iss: z.apns_team_id, iat: Math.floor(Date.now() / 1000) }));
  const signatur = crypto.sign('sha256', Buffer.from(`${kopf}.${inhalt}`), { key: z.apns_key_p8, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { wert: `${kopf}.${inhalt}.${b64url(signatur)}`, zeit: Date.now(), kid: z.apns_key_id };
  return apnsJwt.wert;
};

const apnsVerbindungen = {};
const apnsVerbindung = (host) => {
  const alt = apnsVerbindungen[host];
  if (alt && !alt.closed && !alt.destroyed) return alt;
  const neu = http2.connect(`https://${host}`);
  neu.on('error', () => {});
  neu.on('goaway', () => neu.close());
  apnsVerbindungen[host] = neu;
  return neu;
};

const apnsSenden = (host, z, geraet, nachricht) => new Promise((fertig) => {
  const koerper = JSON.stringify({
    aps: {
      alert: { title: nachricht.titel, body: nachricht.text },
      sound: 'default',
      'thread-id': nachricht.art,
    },
    ...nachricht.daten,
    art: nachricht.art,
  });
  let anfrage;
  try {
    anfrage = apnsVerbindung(host).request({
      ':method': 'POST',
      ':path': `/3/device/${geraet.token}`,
      authorization: `bearer ${apnsToken(z)}`,
      'apns-topic': BUNDLE[geraet.app] || BUNDLE.fahrer,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
  } catch (fehler) {
    fertig({ ok: false, status: 0, grund: String(fehler.message || fehler) });
    return;
  }
  let status = 0;
  let antwort = '';
  anfrage.setTimeout(15_000, () => anfrage.close(http2.constants.NGHTTP2_CANCEL));
  anfrage.on('response', (h) => { status = h[':status']; });
  anfrage.on('data', (d) => { antwort += d; });
  anfrage.on('end', () => {
    let grund = '';
    try { grund = JSON.parse(antwort || '{}').reason || ''; } catch { grund = antwort; }
    fertig({ ok: status === 200, status, grund });
  });
  anfrage.on('error', (fehler) => fertig({ ok: false, status: 0, grund: String(fehler.message || fehler) }));
  anfrage.end(koerper);
});

// TestFlight und App Store nutzen Produktion, Xcode-Builds die Sandbox. Erst Produktion,
// bei einem Sandbox-Token (BadDeviceToken) die Sandbox.
const anApple = async (z, geraet, nachricht) => {
  let r = await apnsSenden('api.push.apple.com', z, geraet, nachricht);
  if (!r.ok && r.grund === 'BadDeviceToken') r = await apnsSenden('api.sandbox.push.apple.com', z, geraet, nachricht);
  const ungueltig = r.status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(r.grund);
  return { ok: r.ok, ungueltig, fehler: r.ok ? null : `apns ${r.status} ${r.grund}` };
};

// --- FCM -----------------------------------------------------------------------

let fcmZugang = { token: '', bis: 0, projekt: '' };
const fcmToken = async (z) => {
  if (fcmZugang.token && Date.now() < fcmZugang.bis - 60_000) return fcmZugang;
  const konto = JSON.parse(z.fcm_service_account);
  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const inhalt = b64url(JSON.stringify({
    iss: konto.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: jetzt,
    exp: jetzt + 3600,
  }));
  const signatur = crypto.sign('RSA-SHA256', Buffer.from(`${kopf}.${inhalt}`), konto.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${kopf}.${inhalt}.${b64url(signatur)}`,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`fcm oauth ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  fcmZugang = { token: json.access_token, bis: Date.now() + (json.expires_in || 3600) * 1000, projekt: konto.project_id };
  return fcmZugang;
};

const anAndroid = async (z, geraet, nachricht) => {
  const { token, projekt } = await fcmToken(z);
  const daten = Object.fromEntries(Object.entries({ ...nachricht.daten, art: nachricht.art, titel: nachricht.titel, text: nachricht.text })
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projekt}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: geraet.token,
        notification: { title: nachricht.titel, body: nachricht.text },
        data: daten,
        android: { priority: 'HIGH', notification: { channel_id: 'trisar', tag: nachricht.art } },
      },
    }),
  });
  if (res.ok) return { ok: true, ungueltig: false, fehler: null };
  const text = await res.text();
  const ungueltig = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(text);
  return { ok: false, ungueltig, fehler: `fcm ${res.status} ${text.slice(0, 160)}` };
};

// --- Ausgang abarbeiten ----------------------------------------------------------

let laeuft = false;
const ausgangAbarbeiten = async () => {
  if (laeuft) return;
  laeuft = true;
  try {
    const offen = await rest('push_ausgang?select=*&gesendet=is.null&versuche=lt.5&order=id.asc&limit=50');
    if (!offen?.length) return;
    const z = await zugang();
    const apple = Boolean(z.apns_key_p8 && z.apns_key_id && z.apns_team_id);
    const android = Boolean(z.fcm_service_account);
    const nutzer = [...new Set(offen.map((n) => n.user_id))];
    const geraete = await rest(`push_geraete?select=*&user_id=in.(${nutzer.join(',')})`);

    for (const n of offen) {
      // Was laenger als 30 min liegt (z. B. weil ein Schluessel fehlte), ist nicht mehr aktuell.
      if (Date.now() - Date.parse(n.erstellt) > 30 * 60_000) {
        await rest(`push_ausgang?id=eq.${n.id}`, { methode: 'PATCH', koerper: { gesendet: new Date().toISOString(), fehler: 'veraltet' } });
        continue;
      }
      const ziele = (geraete || []).filter((g) => g.user_id === n.user_id && g.app === n.app);
      const fehler = [];
      let wartet = false;
      let geschickt = 0;
      for (const g of ziele) {
        if ((g.plattform === 'ios' && !apple) || (g.plattform === 'android' && !android)) { wartet = true; continue; }
        try {
          const r = g.plattform === 'ios' ? await anApple(z, g, n) : await anAndroid(z, g, n);
          if (r.ok) geschickt += 1;
          else fehler.push(r.fehler);
          if (r.ungueltig) await rest(`push_geraete?token=eq.${encodeURIComponent(g.token)}`, { methode: 'DELETE' });
        } catch (e) {
          fehler.push(String(e.message || e));
        }
      }
      // Fehlt nur der Schluessel einer Plattform: liegen lassen und spaeter nochmal.
      if (wartet && geschickt === 0 && !fehler.length) continue;
      const fertig = geschickt > 0 || !ziele.length || n.versuche >= 4 || (!fehler.length && !wartet);
      await rest(`push_ausgang?id=eq.${n.id}`, {
        methode: 'PATCH',
        koerper: {
          gesendet: fertig ? new Date().toISOString() : null,
          versuche: n.versuche + 1,
          fehler: !ziele.length ? 'kein_geraet' : (fehler.join(' | ') || null),
        },
      });
      if (geschickt) log(`${n.art} an ${n.user_id.slice(0, 8)} (${geschickt} Gerät${geschickt > 1 ? 'e' : ''})`);
    }
  } catch (e) {
    log('Fehler beim Abarbeiten:', e.message || e);
  } finally {
    laeuft = false;
  }
};

const erinnern = async () => {
  try {
    const anzahl = await rest('rpc/push_erinnerungen', { methode: 'POST', koerper: {} });
    if (anzahl) log(`${anzahl} Erinnerung(en) angelegt`);
  } catch (e) {
    log('Fehler bei Erinnerungen:', e.message || e);
  }
};

log(`gestartet, ${SUPABASE_URL}`);
setInterval(ausgangAbarbeiten, TAKT_MS);
setInterval(erinnern, ERINNERUNG_MS);
ausgangAbarbeiten();
erinnern();
