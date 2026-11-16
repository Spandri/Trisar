// Wo ist der Fahrer gerade auf seiner Dienstreise? (14.11.2026, gleich in admin/src/shared/reiseLage.js,
// iOS ReiseLage.swift, Android ReiseLage.kt)
//
// - Laufender Abschnitt nach Uhrzeit (Abfahrt/Ankunft live, sonst aus Ticket/Plan).
// - Position: Handy-Standort des Fahrers, wenn hoechstens 3 Minuten alt und vom Handy (nicht vom OBD-Tracker,
//   das Auto steht waehrend der Reise woanders). Sonst errechnet: Anteil der Fahrzeit entlang der Linie
//   des Abschnitts. Beim Umstieg wartet er am Start des naechsten Abschnitts.
// - Linie geteilt: gefahren (grau) bis zur Position, offen (blau) danach.

const FRISCH_MS = 3 * 60 * 1000;
const NACHLAUF_MS = 15 * 60 * 1000;
const hm = (v) => String(v || '').slice(0, 5);

// "HH:MM" am Tag (YYYY-MM-DD) in Berlin -> ms. Grob ueber die lokale Zeit des Geraets (Fahrer/Dispo in DE).
const zeitpunkt = (tag, uhr) => {
  if (!tag || !/^\d{1,2}:\d{2}/.test(String(uhr || ''))) return null;
  const t = new Date(`${tag}T${hm(uhr).padStart(5, '0')}:00`).getTime();
  return Number.isFinite(t) ? t : null;
};

const abstand2 = (a, b) => {
  const dx = (a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

// Punkt auf einer Linie nach Anteil der Laenge (0..1).
const punktBeiAnteil = (linie, anteil) => {
  if (!linie.length) return null;
  if (linie.length === 1 || anteil <= 0) return linie[0];
  const laengen = [];
  let summe = 0;
  for (let i = 1; i < linie.length; i += 1) {
    const l = Math.sqrt(abstand2(linie[i - 1], linie[i]));
    laengen.push(l);
    summe += l;
  }
  let rest = Math.min(anteil, 1) * summe;
  for (let i = 0; i < laengen.length; i += 1) {
    if (rest <= laengen[i] || i === laengen.length - 1) {
      const f = laengen[i] ? Math.min(1, rest / laengen[i]) : 0;
      const a = linie[i]; const b = linie[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    rest -= laengen[i];
  }
  return linie[linie.length - 1];
};

/** Linie eines Abschnitts ([lng, lat]): Gleise (live), sonst Halte, sonst gespeicherte Linie, sonst gerade. */
export const abschnittLinie = (a, live) => {
  if (live?.linie?.length >= 2) return live.linie;
  if (live?.strecke?.length >= 2) return live.strecke.map((h) => [h.lng, h.lat]);
  // Bus entlang der Strassen, U-Bahn/Tram entlang der Gleise (vom Server, Edge Function abschnitt-linie).
  if (Array.isArray(a.linie) && a.linie.length >= 2) return a.linie;
  if (a.von_lat != null && a.nach_lat != null) return [[a.von_lng, a.von_lat], [a.nach_lng, a.nach_lat]];
  return [];
};

/**
 * @param teile    Abschnitte (dienstreise_abschnitt)
 * @param liveJe   Live-Stand je Abschnitt-ID (abfahrt, ankunft, linie, strecke)
 * @param datum    Tag der Reise
 * @param standort { lat, lng, erfasst, quelle } des Fahrers oder null
 */
export const reiseLage = ({ teile = [], liveJe = {}, datum, standort = null, jetzt = Date.now() }) => {
  if (!teile.length) return null;
  const zeiten = teile.map((a) => {
    const live = liveJe[a.id];
    const tag = a.ab_datum || datum;
    const ab = zeitpunkt(tag, live?.abfahrt || a.ab_zeit);
    let an = zeitpunkt(a.an_datum || tag, live?.ankunft || a.an_zeit);
    if (ab != null && an != null && an < ab) an += 24 * 3600 * 1000;
    return { ab, an };
  });

  // Laufender Abschnitt: erster, dessen Ankunft noch nicht vorbei ist.
  let index = zeiten.findIndex((z) => z.an == null || jetzt < z.an);
  const vorbei = index < 0;
  if (vorbei) index = teile.length - 1;
  const vorStart = !vorbei && index === 0 && zeiten[0].ab != null && jetzt < zeiten[0].ab;
  const status = teile.map((_, i) => {
    if (vorbei || i < index) return 'fertig';
    if (i === index && !vorStart && (zeiten[i].ab == null || jetzt >= zeiten[i].ab)) return 'jetzt';
    return 'offen';
  });
  // Zwischen Ankunft und naechster Abfahrt: Umstieg (wartet am Start des Abschnitts `index`).
  const imUmstieg = !vorbei && !vorStart && status[index] === 'offen';
  // 15.11.: 15 min nach der letzten Ankunft ist die Reise abgeschlossen. Dann kein GPS mehr am Zug (der Fahrer
  // sitzt womoeglich schon im Auto), Dispo-Karten zeigen wieder den normalen Pin.
  const letzteAn = zeiten[zeiten.length - 1].an;
  const abgeschlossen = vorbei && letzteAn != null && jetzt > letzteAn + NACHLAUF_MS;

  // Linien je Abschnitt und gesamt (mit Grenzen, um die Position einzuordnen).
  const linien = teile.map((a) => abschnittLinie(a, liveJe[a.id]));
  const gesamt = [];
  const grenzen = [];
  linien.forEach((l) => { grenzen.push(gesamt.length); gesamt.push(...l); });
  grenzen.push(gesamt.length);

  // Position: Handy (frisch), sonst errechnet.
  const handy = standort && Number.isFinite(Number(standort.lat)) && Number.isFinite(Number(standort.lng))
    && !/teltonika|obd|tracker/i.test(String(standort.quelle || ''))
    && (!standort.erfasst || jetzt - new Date(standort.erfasst).getTime() <= FRISCH_MS);
  let position;
  let quelle;
  if (handy && !abgeschlossen) {
    position = [Number(standort.lng), Number(standort.lat)];
    quelle = 'gps';
  } else {
    quelle = 'fahrplan';
    const l = linien[index];
    const z = zeiten[index];
    if (vorbei) position = l[l.length - 1];
    else if (vorStart || imUmstieg) position = l[0];
    else {
      const anteil = z.ab != null && z.an != null && z.an > z.ab ? (jetzt - z.ab) / (z.an - z.ab) : 0;
      position = punktBeiAnteil(l, Math.max(0, Math.min(1, anteil)));
    }
  }

  // Grenze grau/blau: naechster Punkt der Gesamtlinie zur Position (im Bereich des laufenden Abschnitts zuerst).
  let teilung = 0;
  if (position && gesamt.length) {
    const von = grenzen[index];
    const bis = Math.max(von, grenzen[index + 1] - 1);
    let besterAbstand = Infinity;
    for (let i = von; i <= bis; i += 1) {
      const d = abstand2(gesamt[i], position);
      if (d < besterAbstand) { besterAbstand = d; teilung = i; }
    }
    if (vorbei) teilung = gesamt.length - 1;
  }
  const gefahren = position ? [...gesamt.slice(0, teilung + 1), position] : [];
  const offen = position ? [position, ...gesamt.slice(teilung + 1)] : gesamt;

  const aktuell = teile[index];
  return {
    index,
    status,
    vorStart,
    imUmstieg,
    vorbei,
    abgeschlossen,
    position: position ? { lng: position[0], lat: position[1] } : null,
    quelle,
    art: aktuell?.art || 'zug',
    aktuell,
    gefahren,
    offen,
    gesamt,
  };
};

// Icon des Fahrzeugs auf der Karte (Lime).
export const fahrzeugIcon = (art) => ({
  bus: '/icon/_Icon_Lime/Bus_Trisar_Icons_01_Lime.svg',
  ubahn: '/icon/_Icon_Lime/U_Bahn_Trisar_Icons_01_Lime.svg',
  tram: '/icon/_Icon_Lime/U_Bahn_Trisar_Icons_01_Lime.svg',
  flug: '/icon/_Icon_Lime/Plain_Abflug_Trisar_Icons_01_Lime.svg',
}[art] || '/icon/_Icon_Lime/Bahnhof_Zug_Trisar_Icons_01_Lime.svg');

/**
 * Marker "Fahrer sitzt im Fahrzeug": schwarzer Kreis mit Lime-Rand und Fahrzeug, unten rechts der
 * Fahrer-Punkt mit Nummer (Fahrer-App blau, Dispo in Statusfarbe), daneben eine Zeile Text.
 */
export const fahrzeugMarkerElement = ({ art, nummer, text = '', punktFarbe = null, textLinks = false }) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:48px;height:48px;pointer-events:none';
  const kreis = document.createElement('div');
  kreis.style.cssText = 'width:48px;height:48px;border-radius:50%;background:#000;border:2.5px solid #E3F654;box-sizing:border-box;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.5)';
  const bild = document.createElement('img');
  bild.src = fahrzeugIcon(art);
  bild.style.cssText = 'width:26px;height:26px;object-fit:contain';
  kreis.appendChild(bild);
  el.appendChild(kreis);
  const punkt = document.createElement('div');
  punkt.textContent = nummer == null ? '' : String(nummer);
  punkt.style.cssText = punktFarbe
    ? `position:absolute;right:-12px;bottom:-8px;width:28px;height:28px;border-radius:50%;background:${punktFarbe};border:2px solid #000;box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:#000;font:700 12px 'Space Grotesk',sans-serif`
    : "position:absolute;right:-12px;bottom:-8px;width:28px;height:28px;border-radius:50%;background:url(/icon/_Icon_Karte/Fahrer_Standort_Trisar_01_blau.svg) center/contain no-repeat;display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px 'Space Grotesk',sans-serif";
  el.appendChild(punkt);
  if (text) {
    const schild = document.createElement('div');
    schild.textContent = text;
    schild.style.cssText = `position:absolute;${textLinks ? 'right:58px' : 'left:58px'};top:10px;white-space:nowrap;background:rgba(26,26,26,.92);color:#E3F654;font:700 13px 'Space Grotesk',sans-serif;padding:4px 8px;border-radius:6px`;
    el.appendChild(schild);
  }
  return el;
};

// Text am Fahrzeug: "ICE 612 · +3 min" (Fahrer) bzw. "ICE 612 → Mannheim 10:29 +3" (Dispo).
export const verspaetungMin = (live) => {
  const m = (x) => { const t = String(x || '').match(/^(\d{1,2}):(\d{2})/); return t ? Number(t[1]) * 60 + Number(t[2]) : null; };
  const a = m(live?.ankunft); const p = m(live?.ankunft_plan);
  return a != null && p != null ? ((a - p + 1440) % 1440) : null;
};

/**
 * Umstieg auf der Karte (14.11.): kleiner schwarzer Kreis mit dem Fahrzeug des naechsten Abschnitts
 * (Bus/U-Bahn/Zug/Flug, Lime) und daneben "U2 ab 06:56". Gleich in Fahrer- und Dispo-Karte.
 */
export const umstiegMarkerElement = ({ art, text = '' }) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:30px;height:30px;pointer-events:none';
  const kreis = document.createElement('div');
  kreis.style.cssText = 'width:30px;height:30px;border-radius:50%;background:#000;border:2px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center';
  const bild = document.createElement('img');
  bild.src = fahrzeugIcon(art);
  bild.style.cssText = 'width:17px;height:17px;object-fit:contain';
  kreis.appendChild(bild);
  el.appendChild(kreis);
  if (text) {
    const schild = document.createElement('div');
    schild.textContent = text;
    schild.style.cssText = "position:absolute;left:36px;top:4px;white-space:nowrap;background:rgba(26,26,26,.92);color:#fff;font:700 12px 'Space Grotesk',sans-serif;padding:3px 7px;border-radius:6px";
    el.appendChild(schild);
  }
  return el;
};

/** Umstiege einer Reise: Start jedes weiteren Abschnitts mit Art und "U2 ab 06:56" (live, sonst Plan). */
export const umstiegPunkte = (teile = [], liveJe = {}) => teile.slice(1)
  .filter((a) => a.von_lat != null && a.von_lng != null)
  .map((a) => {
    const ab = liveJe[a.id]?.abfahrt || String(a.ab_zeit || '').slice(0, 5);
    return { lat: a.von_lat, lng: a.von_lng, art: a.art || 'zug', text: `${a.nummer || ''}${ab ? ` ab ${ab}` : ''}`.trim() };
  });
