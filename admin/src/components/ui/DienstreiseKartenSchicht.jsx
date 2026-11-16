// Fahrer auf Dienstreise auf der Dispo-Karte (Entwurf 14.11.): offene Strecke blau, gefahrenes Stueck grau,
// darauf das Fahrzeug (Bus/U-Bahn/Zug/Flug) mit dem Fahrer-Punkt in seiner Statusfarbe und einer Zeile
// "ICE 612 → Mannheim 10:29 +3". Position: Handy-Standort (frisch), sonst aus Fahrplan und Verspaetung.
// Zeichnet direkt in die MapLibre-Karte der Kartenansicht (kartenRef.current.karte).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { hm, useAbschnittVerbindungen } from '../../shared/dienstreise';
import { fahrzeugMarkerElement, reiseLage, umstiegMarkerElement, umstiegPunkte, verspaetungMin } from '../../shared/reiseLage';

const BLAU = '#0059FF';
const GEFAHREN = '#5c5c5c';
const kurz = (t) => String(t || '').split(',')[0].replace(/\s*Hbf$/i, '').trim();
const daten = (pfad) => ({ type: 'FeatureCollection', features: pfad && pfad.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pfad }, properties: {} }] : [] });

export default function DienstreiseKartenSchicht({ kartenRef, reise, fahrer, standort = null, punktFarbe = '#59BE80', onWaehlen = null, nurLinie = false, mitLinie = true, onAbgeschlossen = null }) {
  const liveJe = useAbschnittVerbindungen(reise);
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => { const uhr = setInterval(() => setJetzt(Date.now()), 30000); return () => clearInterval(uhr); }, []);

  // Ohne Abschnitte: die Reise als ein Abschnitt.
  const teile = useMemo(() => ((reise.abschnitte || []).length ? reise.abschnitte : [{
    id: 'haupt', art: reise.flugnummer ? 'flug' : 'zug', nummer: reise.zugnummer || reise.flugnummer || '',
    von_name: reise.start_name, von_lat: reise.start_lat, von_lng: reise.start_lng,
    nach_name: reise.ziel_name, nach_lat: reise.ziel_lat, nach_lng: reise.ziel_lng,
    ab_datum: reise.datum, ab_zeit: reise.start_zeit, an_zeit: null,
  }]), [reise]);
  const lage = useMemo(() => reiseLage({ teile, liveJe, datum: reise.datum, standort, jetzt }), [teile, liveJe, reise.datum, standort, jetzt]);
  // 15 min nach der letzten Ankunft (15.11.): Kartenansicht nimmt die Reise raus, der normale Pin kommt zurueck.
  const abgeschlossen = !!lage?.abgeschlossen;
  useEffect(() => { if (abgeschlossen) onAbgeschlossen?.(); }, [abgeschlossen, onAbgeschlossen]);
  const text = (() => {
    const a = lage?.aktuell;
    if (!a) return '';
    const live = liveJe[a.id];
    // Vor dem Start und im Umstieg wie beim Fahrer: "Bus 192 ab 06:45".
    if (lage.vorStart || lage.imUmstieg) return `${a.nummer || ''} ab ${live?.abfahrt || hm(a.ab_zeit)}`.trim();
    const an = live?.ankunft || hm(a.an_zeit);
    const spaet = verspaetungMin(live);
    return `${a.nummer || ''} → ${kurz(a.nach_name)}${an ? ` ${an}` : ''}${spaet ? ` +${spaet}` : ''}`.trim();
  })();

  const kennung = `dienstreise-${reise.id}-${fahrer.driver_id}`;
  const fahrzeug = useRef(null);
  const zeichen = useRef([]);
  const umstiege = useMemo(() => (teile.length > 1 ? umstiegPunkte(teile, liveJe) : []), [teile, liveJe]);
  const ziel = reise.ziel_lat != null ? [reise.ziel_lng, reise.ziel_lat] : null;
  const zielSchluessel = ziel ? ziel.join(',') : '';
  const nummer = fahrer?.profil?.driver_number ?? '';
  // Karte noch nicht da (Kartenansicht baut sie gerade): kurz spaeter nochmal versuchen.
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    const karte = kartenRef?.current?.karte;
    if (!lage) return undefined;
    if (!karte) {
      const uhr = setTimeout(() => setVersuch((v) => v + 1), 500);
      return () => clearTimeout(uhr);
    }
    const zeichnen = () => {
      const quelle = (id, pfad, farbe) => {
        if (karte.getSource(id)) karte.getSource(id).setData(daten(pfad));
        else {
          karte.addSource(id, { type: 'geojson', data: daten(pfad) });
          karte.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': farbe, 'line-width': 5 } });
        }
      };
      // nurLinie (vor dem Start): ganze Strecke blau, kein Fahrzeug.
      // Strecke, Umstiege und Ziel nur beim gewaehlten Fahrer (mitLinie), sonst nur das Fahrzeug.
      quelle(`${kennung}-offen`, !mitLinie ? [] : nurLinie ? lage.gesamt : lage.offen, BLAU);
      quelle(`${kennung}-gefahren`, !mitLinie || nurLinie ? [] : lage.gefahren, GEFAHREN);
      // Umstiege (Fahrzeug des naechsten Abschnitts, "U2 ab 06:56") und Zielflagge wie in der Fahrer-App.
      zeichen.current.forEach((m) => m.remove());
      zeichen.current = (mitLinie ? umstiege : []).map((u) => new maplibregl.Marker({ element: umstiegMarkerElement({ art: u.art, text: u.text }), anchor: 'center' })
        .setLngLat([u.lng, u.lat]).addTo(karte));
      if (ziel && mitLinie) {
        const flagge = document.createElement('img');
        flagge.src = '/icon/_Icon_Karte/Ziel_Pin_Trisar_01.svg';
        flagge.style.cssText = 'width:35px;height:41px;pointer-events:none';
        zeichen.current.push(new maplibregl.Marker({ element: flagge, anchor: 'bottom' }).setLngLat(ziel).addTo(karte));
      }
      if (nurLinie || !lage.position) return;
      const schluessel = `${lage.art}|${nummer}|${text}|${punktFarbe}`;
      if (!fahrzeug.current || fahrzeug.current.schluessel !== schluessel) {
        fahrzeug.current?.marker.remove();
        const el = fahrzeugMarkerElement({ art: lage.art, nummer, text, punktFarbe });
        if (onWaehlen) {
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => onWaehlen(fahrer.driver_id));
        }
        el.style.zIndex = '2500';
        const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lage.position.lng, lage.position.lat]).addTo(karte);
        fahrzeug.current = { marker: m, schluessel };
      } else {
        fahrzeug.current.marker.setLngLat([lage.position.lng, lage.position.lat]);
      }
    };
    if (karte.isStyleLoaded()) zeichnen();
    else karte.once('load', zeichnen);
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kartenRef, lage, text, nummer, punktFarbe, kennung, onWaehlen, fahrer.driver_id, versuch, nurLinie, mitLinie, umstiege, zielSchluessel]);

  // Aufraeumen, wenn die Reise endet oder die Karte geht.
  useEffect(() => () => {
    const karte = kartenRef?.current?.karte;
    fahrzeug.current?.marker.remove();
    fahrzeug.current = null;
    zeichen.current.forEach((m) => m.remove());
    zeichen.current = [];
    if (!karte) return;
    for (const id of [`${kennung}-offen`, `${kennung}-gefahren`]) {
      try { if (karte.getLayer(id)) karte.removeLayer(id); if (karte.getSource(id)) karte.removeSource(id); } catch { /* Karte schon weg */ }
    }
  }, [kartenRef, kennung]);

  return null;
}
