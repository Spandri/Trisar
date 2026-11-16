import { useState } from 'react';
import { useI18n } from '../../i18n';
import { routenBasis, routenPunkteLesen } from '../../shared/routenPunkte';
import RoutenEditor from './RoutenEditor';

// Zeile "Route" im Fahrt-Formular samt Editor. adressen = [Start, ...Stopps, Ziel] (Texte).
// Aendern sich die Adressen nach dem Setzen, gelten die Punkte nicht mehr (Zeile springt auf "Schnellste").
// Die Spalte routen_punkte geht nur mit, wenn Punkte gesetzt sind oder die Fahrt vorher welche hatte.
export default function useRoutenZeile({ adressen, anfang = [], marker = 'route' }) {
  const { t } = useI18n();
  const liste = adressen.map((a) => String(a || '').trim());
  const basisVon = (werte) => {
    const l = werte.map((a) => String(a || '').trim());
    return routenBasis(l[0], l.slice(1, -1).filter(Boolean), l[l.length - 1]);
  };
  const basis = basisVon(liste);
  // Punkte aus der Datenbank gelten fuer die Adressen beim Oeffnen des Formulars.
  const [stand, setStand] = useState(() => ({ punkte: routenPunkteLesen(anfang), basis }));
  const [hatte, setHatte] = useState(() => routenPunkteLesen(anfang).length > 0);
  const [offen, setOffen] = useState(false);
  const sichtbar = Boolean(liste[0]) && Boolean(liste[liste.length - 1]);

  const punkte = stand.basis === basis ? stand.punkte : [];
  const anzahl = punkte.length;
  const row = sichtbar ? {
    key: 'route',
    label: t('route.zeile'),
    mode: 'knopf',
    value: anzahl ? t('route.angepasst') : t('route.schnellste'),
    chip: anzahl === 1 ? t('route.punktChip') : anzahl ? t('route.punkteChip', { n: anzahl }) : '',
    onClick: () => setOffen(true),
    marker,
  } : null;
  const editor = offen && sichtbar ? (
    <RoutenEditor
      adressen={liste.filter(Boolean)}
      anfang={punkte}
      onAbbrechen={() => setOffen(false)}
      onUebernehmen={(neu) => { setStand({ punkte: neu, basis }); setOffen(false); }}
    />
  ) : null;
  return {
    row,
    editor,
    // undefined = Spalte nicht anfassen.
    fuersSpeichern: anzahl > 0 || hatte ? punkte : undefined,
    // adressenNeu = Adressen, zu denen die Punkte gehoeren (beim Neuladen der Fahrt).
    zuruecksetzen: (werte = [], adressenNeu = adressen) => {
      setStand({ punkte: routenPunkteLesen(werte), basis: basisVon(adressenNeu) });
      setHatte(routenPunkteLesen(werte).length > 0);
    },
  };
}
