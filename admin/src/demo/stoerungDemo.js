// Störung am Einsatztag für die Demo: Erst wird der Tag vorab geplant und
// angenommen. Danach meldet der KI-Assistent die Störung (vorgerechnet in
// engine-ergebnisse.json, Tag "stoerung") und verlinkt in den Planer, der nur
// noch die Änderungen zum Übernehmen zeigt.
import { engineTag } from './engineErgebnisse';

const PLAN_STORAGE_KEY = 'trisar_planer_cache_v1';   // KiPlanerDemoView
const ZIEL_KEY = 'trisar_neuplanung_ziel_v1';        // Assistent -> Planer
const STATUS_KEY = 'trisar_neuplanung_status_v1';    // { [iso]: 'uebernommen' | 'abgelehnt' }

const lesen = (key, fallback) => {
  try {
    const roh = window.sessionStorage.getItem(key);
    return roh ? JSON.parse(roh) : fallback;
  } catch {
    return fallback;
  }
};
const schreiben = (key, wert) => {
  try {
    if (wert == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(wert));
  } catch {
    // Speicher nicht verfügbar: die Demo läuft dann ohne Merken weiter.
  }
};

const ERZWUNGEN_KEY = 'trisar_stoerung_erzwungen_v1';   // Tutorial: Meldung auch ohne Annahme

// Tutorial: zustand { stoerungTag: <Tagesnummer, 0 = heute> } zeigt die Meldung
// dieses Tages im Assistenten, auch wenn der Tag (noch) nicht angenommen ist.
if (typeof window !== 'undefined') {
  window.addEventListener('trisar:tutorial-zustand', (e) => {
    const nr = e?.detail?.stoerungTag;
    if (!Number.isFinite(nr)) return;
    const d = new Date();
    d.setDate(d.getDate() + nr);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const liste = lesen(ERZWUNGEN_KEY, []);
    if (!liste.includes(iso)) schreiben(ERZWUNGEN_KEY, [...liste, iso]);
  });
}

// Tage mit vorgerechneter Störung, deren Vorabplanung angenommen ist.
export const stoerungenNachAnnahme = async () => {
  const angenommen = lesen(PLAN_STORAGE_KEY, null)?.accepted || {};
  const tage = [...new Set([
    ...Object.keys(angenommen).filter((iso) => (angenommen[iso] || []).length),
    ...lesen(ERZWUNGEN_KEY, []),
  ])];
  const liste = await Promise.all(tage.map(async (iso) => {
    const tag = await engineTag(iso);
    return tag?.stoerung ? { iso, tag } : null;
  }));
  return liste.filter(Boolean);
};

export const neuplanungZielSetzen = (iso) => schreiben(ZIEL_KEY, iso);
// Der Planer öffnet die Neuplanung nur direkt nach dem Link: lesen beim Öffnen,
// danach löschen (getrennt, weil React den Startwert im Entwicklungsmodus doppelt rechnet).
export const neuplanungZielLesen = () => lesen(ZIEL_KEY, null);
export const neuplanungZielLoeschen = () => schreiben(ZIEL_KEY, null);

export const neuplanungStatus = (iso) => lesen(STATUS_KEY, {})[iso] || null;
export const neuplanungStatusSetzen = (iso, status) => schreiben(STATUS_KEY, { ...lesen(STATUS_KEY, {}), [iso]: status });

const datumKurz = (iso) => new Date(`${iso}T12:00:00`)
  .toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

// Kurze Erklärung für den Assistenten.
export const stoerungText = (iso, st) => {
  const ohne = st.ohne_neuplanung;
  const bis = ohne.anzahl ? Math.max(...Object.values(ohne.spaete_abholungen)) : 0;
  const stau = Object.keys(st.spaetere_ankunft || {}).length;
  const name = st.ereignis.name.split(' (')[0];
  return [
    `Störung am ${datumKurz(iso)}, ${st.meldung} Uhr: ${name}.`,
    ohne.anzahl
      ? `Ohne Eingriff ${ohne.anzahl === 1 ? 'wird 1 Gast' : `werden ${ohne.anzahl} Gäste`} zu spät abgeholt, bis ${bis} min.`
      : 'Der Plan hält, kein Gast wird zu spät abgeholt.',
    st.aenderungen.length
      ? `Ich habe eine Neuplanung vorbereitet: ${st.aenderungen.length} Fahrten bekommen einen anderen Fahrer, danach ${st.mit_neuplanung.anzahl ? `noch ${st.mit_neuplanung.anzahl} zu spät` : 'sind alle pünktlich'}.`
      : '',
    stau ? `${stau} Gäste stehen selbst im Stau. Sie und das Ziel werden automatisch informiert.` : '',
  ].filter(Boolean).join('\n\n');
};
