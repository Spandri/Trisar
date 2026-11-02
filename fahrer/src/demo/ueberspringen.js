// Easter Egg: die Startanimation ueberspringen.
//
// Beim ersten Aufruf laeuft erst das Logo-Video, dann tippt sich der Login
// selbst aus. Wer die Demo zum wiederholten Mal zeigt, will da nicht warten —
// ein Doppelklick irgendwohin oder die Esc-Taste springt ans Ende. Bewusst
// ohne sichtbaren Knopf: der Erstbesucher soll den Trailer ganz sehen.
//
// Die Wache laeuft in der App. Klicks neben das iPhone landen im Rahmen
// (deploy/index.html); der schickt sie als Nachricht herueber.

export const UEBERSPRINGEN = 'trisar:trailer-ueberspringen';

let gemeldet = false;

export const ueberspringenMelden = () => {
  if (gemeldet) return;
  gemeldet = true;
  window.dispatchEvent(new CustomEvent(UEBERSPRINGEN));
};

// Auf das Ueberspringen reagieren. Wer sich anmeldet, nachdem es schon
// passiert ist, wird sofort benachrichtigt.
export const beiUeberspringen = (melde) => {
  if (gemeldet) { melde(); return () => {}; }
  window.addEventListener(UEBERSPRINGEN, melde);
  return () => window.removeEventListener(UEBERSPRINGEN, melde);
};

// Doppelklick und Esc abfangen, dazu die Weiterleitung aus dem Rahmen.
export const wacheStarten = () => {
  const taste = (e) => { if (e.key === 'Escape') ueberspringenMelden(); };
  const nachricht = (e) => {
    if (e && e.data && e.data.trisar === 'trailer-ueberspringen') ueberspringenMelden();
  };
  window.addEventListener('dblclick', ueberspringenMelden);
  window.addEventListener('keydown', taste);
  window.addEventListener('message', nachricht);
  return () => {
    window.removeEventListener('dblclick', ueberspringenMelden);
    window.removeEventListener('keydown', taste);
    window.removeEventListener('message', nachricht);
  };
};
