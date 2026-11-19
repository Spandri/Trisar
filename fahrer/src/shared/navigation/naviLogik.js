// Eigene Navigation der Fahrer-App (16.11.): Rechenteil ohne Karte und ohne React.
// Nur bei Fahrten mit Route von Dispo (jobs.routen_punkte). Google Maps laesst sich per Link keine
// Route vorgeben, deshalb fuehrt die App selbst entlang der Route vom Server (places-proxy navi_route).
// Gleiche Logik in iOS (NavigationAnsicht) und Android (NavigationSeite).

export const ABSEITS_M = 50; // weiter weg von der Linie = abseits
export const ABSEITS_FOLGE = 3; // so viele Standorte in Folge
export const NEU_RECHNEN_MS = 8000; // fruehestens so oft neu anfordern
export const ANKUNFT_M = 30;

export const dekodierePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const punkte = [];
  const wert = () => {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (index < encoded.length) {
    lat += wert();
    lng += wert();
    punkte.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return punkte;
};

const meter = (a, b) => {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
};

// Antwort des Servers -> Plan mit Metern je Stuetzpunkt. faktor gleicht die Laenge der Linie
// an die Meterangaben der Hinweise an (TomTom misst etwas anders als die Luftlinie der Stuecke).
export const planAusAntwort = (antwort) => {
  const punkte = dekodierePolyline(antwort?.polyline);
  if (!antwort?.ok || punkte.length < 2) return null;
  const strecke = [0];
  for (let i = 1; i < punkte.length; i += 1) strecke.push(strecke[i - 1] + meter(punkte[i - 1], punkte[i]));
  const linie = strecke[strecke.length - 1];
  const laenge = Number(antwort.laenge_m) || linie;
  return {
    punkte,
    strecke,
    faktor: linie > 0 ? laenge / linie : 1,
    laenge,
    dauer: Number(antwort.dauer_s) || 0,
    hinweise: Array.isArray(antwort.hinweise) ? antwort.hinweise : [],
    wegpunkte: Array.isArray(antwort.wegpunkte) ? antwort.wegpunkte : [],
    vorschau: vorschauAusAntwort(antwort),
  };
};

// Bei der Anfahrt (bis_abholung) schickt der Server die Route der Dispo vom Abholort bis zum Ziel mit.
export function vorschauAusAntwort(antwort) {
  const v = antwort?.vorschau;
  const punkte = dekodierePolyline(v?.polyline);
  if (punkte.length < 2) return null;
  return { punkte, laenge: Number(v.laenge_m) || 0, dauer: Number(v.dauer_s) || 0 };
}

// "38 km · 41 min": ab 10 km ganze km, darunter eine Nachkommastelle, Minuten aufgerundet.
export const vorschauText = (vorschau) => {
  if (!vorschau) return '';
  const km = vorschau.laenge / 1000;
  const kmText = km >= 10
    ? `${Math.round(km)}`
    : km.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const teile = [];
  if (vorschau.laenge > 0) teile.push(`${kmText} km`);
  if (vorschau.dauer > 0) teile.push(`${Math.ceil(vorschau.dauer / 60)} min`);
  return teile.join(' · ');
};

// Standort auf die Linie legen. Gesucht wird nur ab der letzten Stelle (kleines Fenster), damit
// Schleifen und Gegenrichtung nicht springen. Liegt das Fenster daneben, einmal bis zum Ende suchen.
export const projizieren = (plan, pos, letzterIndex = 0) => {
  const { punkte, strecke, faktor } = plan;
  const kosLat = Math.cos(pos.lat * Math.PI / 180);
  const suche = (von, bis) => {
    let bester = null;
    for (let i = Math.max(0, von); i <= Math.min(punkte.length - 2, bis); i += 1) {
      const a = punkte[i];
      const b = punkte[i + 1];
      const bx = (b.lng - a.lng) * 111320 * kosLat;
      const by = (b.lat - a.lat) * 111320;
      const px = (pos.lng - a.lng) * 111320 * kosLat;
      const py = (pos.lat - a.lat) * 111320;
      const lang2 = bx * bx + by * by;
      const anteil = lang2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / lang2)) : 0;
      const abstand = Math.hypot(px - anteil * bx, py - anteil * by);
      if (!bester || abstand < bester.abstand) {
        bester = {
          abstand,
          index: i,
          s: (strecke[i] + anteil * (strecke[i + 1] - strecke[i])) * faktor,
          // Richtung der Strasse an dieser Stelle (0 = Norden, im Uhrzeigersinn).
          kurs: lang2 > 0 ? (Math.atan2(bx, by) * 180 / Math.PI + 360) % 360 : null,
          lat: a.lat + anteil * (b.lat - a.lat),
          lng: a.lng + anteil * (b.lng - a.lng),
        };
      }
    }
    return bester;
  };
  let treffer = suche(letzterIndex - 3, letzterIndex + 60);
  if (!treffer || treffer.abstand > ABSEITS_M) {
    const weit = suche(letzterIndex, punkte.length - 2);
    if (weit && (!treffer || weit.abstand < treffer.abstand)) treffer = weit;
  }
  return treffer;
};

// Naechster Hinweis vor dem Fahrer und der danach.
export const naechsterHinweis = (plan, s) => {
  const index = plan.hinweise.findIndex((h) => h.pfeil !== 'start' && h.m > s - 10);
  if (index === -1) return { index: -1, hinweis: null, entfernung: 0, danach: null };
  const hinweis = plan.hinweise[index];
  const folgender = plan.hinweise[index + 1] || null;
  return {
    index,
    hinweis,
    entfernung: Math.max(0, hinweis.m - s),
    // "dann" nur zeigen, wenn es kurz danach weitergeht.
    danach: folgender && folgender.m - hinweis.m < 300 ? folgender : null,
  };
};

export const entfernungText = (m) => {
  if (m < 30) return 'Jetzt';
  if (m < 100) return `${Math.round(m / 10) * 10} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
};

// Restzeit in Sekunden: Fahrzeit bis zur Stelle s zwischen den Hinweisen geschaetzt.
export const restSekunden = (plan, s) => {
  const h = plan.hinweise;
  if (h.length < 2 || plan.dauer <= 0) return Math.max(0, plan.dauer * (1 - s / Math.max(1, plan.laenge)));
  let i = 0;
  while (i < h.length - 2 && h[i + 1].m <= s) i += 1;
  const a = h[i];
  const b = h[i + 1];
  const anteil = b.m > a.m ? Math.min(1, Math.max(0, (s - a.m) / (b.m - a.m))) : 1;
  return Math.max(0, plan.dauer - (a.t + anteil * (b.t - a.t)));
};

export const restText = (plan, s) => {
  const minuten = Math.max(1, Math.round(restSekunden(plan, s) / 60));
  const km = Math.max(0, plan.laenge - s) / 1000;
  return `${minuten} min · ${km.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
};

export const ankunftText = (plan, s, jetzt = new Date()) => (
  new Date(jetzt.getTime() + restSekunden(plan, s) * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
);

// Was jetzt anzusagen ist. merker = {} je Plan, wird hier fortgeschrieben.
// Je Hinweis hoechstens zweimal: vorab ("In 300 Metern ...") und an der Stelle.
export const ansagen = (plan, s, merker) => {
  const { index, hinweis, entfernung } = naechsterHinweis(plan, s);
  if (!hinweis) return [];
  const stand = merker[index] || (merker[index] = { weit: false, vorab: false, da: false });
  if (entfernung > 500) stand.weit = true;
  if (hinweis.pfeil === 'ziel') {
    if (entfernung <= ANKUNFT_M && !stand.da) {
      stand.da = true;
      return [hinweis.text];
    }
    return [];
  }
  if (entfernung <= 50 && !stand.da) {
    stand.da = true;
    stand.vorab = true;
    return [hinweis.text];
  }
  if (entfernung <= 400 && entfernung > 150 && stand.weit && !stand.vorab) {
    stand.vorab = true;
    const text = String(hinweis.text || '');
    return [`In ${Math.round(entfernung / 50) * 50} Metern ${text.charAt(0).toLowerCase()}${text.slice(1)}`];
  }
  return [];
};

// Erreichte Wegpunkte: neuer Stand "ab" (erste noch offene Stelle der Folge).
export const abNachFortschritt = (plan, s, ab) => {
  let neu = ab;
  plan.wegpunkte.forEach((w) => {
    if (w.art !== 'ziel' && s >= w.m - ANKUNFT_M) neu = Math.max(neu, w.ab + 1);
  });
  return neu;
};

export const istAngekommen = (plan, s) => s >= plan.laenge - ANKUNFT_M;

// Womit die Route endet: Abholort (Anfahrt), Zwischenstopp oder Ziel.
export const endArt = (plan) => plan.wegpunkte[plan.wegpunkte.length - 1]?.art || 'ziel';

const MIT_GAST = ['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
const VORBEI = ['done', 'completed', 'arrived', 'beendet', 'cancelled', 'canceled', 'refused', 'storniert'];
const status = (job) => String(job?.status || '').trim().toLowerCase();
export const gastAnBord = (job) => MIT_GAST.includes(status(job));
// Knopf "Navigation starten": nur bei Route von Dispo und solange die Fahrt laeuft oder ansteht.
export const hatNavigation = (job) => (
  Array.isArray(job?.routenPunkte) && job.routenPunkte.length > 0 && !VORBEI.includes(status(job))
);
// Platz, den der Knopf im Fahrtblatt braucht (56 Knopf + 16 Abstand).
export const naviVersatz = (job) => (hatNavigation(job) ? 72 : 0);
