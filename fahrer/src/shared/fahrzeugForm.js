// Unsichtbare Form eines Fahrzeugmodells fuer "Schaden melden" (werkzeuge/fahrzeugbilder/form-bauen.py).
// Aus den 36 Umrissen geschnittenes Volumen plus Kamera des Drehtellers. Damit wird ein Tipp auf das
// Bild zu einem Punkt am Auto, und dieser Punkt laesst sich in jeder Ansicht wiederfinden.
// Koordinaten in Metern (Massstab geschaetzt): x quer (+ = links), y hoch, z (+ = vorne).
// Bildpunkte immer im Drehbild (satz.breite x satz.hoehe, 800 px breit).

const BASIS = `${import.meta.env.BASE_URL || '/'}fahrzeug-dreh/`;
const geladen = new Map();

// Ist die Stelle aus dieser Ansicht zu sehen? Der Strahl dorthin darf hoechstens so viel vorher auf das Auto treffen.
const SICHT_TOLERANZ = 0.11;

function formBauen(info, puffer) {
  const b = new Uint8Array(puffer);
  const [nx, ny, nz] = info.n;
  const anfang = new Uint32Array(nx * ny);
  const anzahl = new Uint8Array(nx * ny);
  const laeufe = new Uint16Array(info.laeufe * 2 || b.length);
  let i = 0; let l = 0;
  for (let c = 0; c < nx * ny; c += 1) {
    const n = b[i]; i += 1;
    anfang[c] = l; anzahl[c] = n;
    for (let r = 0; r < n; r += 1) {
      laeufe[l] = b[i] | (b[i + 1] << 8);
      laeufe[l + 1] = b[i + 2] | (b[i + 3] << 8);
      l += 2; i += 4;
    }
  }
  const [ox, oy, oz] = info.o;
  const sch = info.schritt;
  const belegt = (x, y, z) => {
    const ix = Math.floor((x - ox) / sch); const iy = Math.floor((y - oy) / sch); const iz = Math.floor((z - oz) / sch);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return false;
    const c = ix * ny + iy;
    for (let r = 0, a = anfang[c]; r < anzahl[c]; r += 1, a += 2) if (iz >= laeufe[a] && iz < laeufe[a + 1]) return true;
    return false;
  };

  const { s, D, phi, cx, cy, h0 } = info.kamera;
  const f = s * D;
  const ph = (phi * Math.PI) / 180;
  const [gx0, gx1, gy0, gy1, gz0, gz1] = info.grenzen;
  const radius = Math.hypot(Math.max(-gx0, gx1), Math.max(-gz0, gz1), Math.max(-gy0, gy1)) + 0.1;

  // Punkt am Auto -> [u, v, Tiefe] im Drehbild der Ansicht k
  const abbilden = (P, k) => {
    const th = (k * 10 * Math.PI) / 180;
    const x = P[0] * Math.cos(th) + P[2] * Math.sin(th);
    const z = -P[0] * Math.sin(th) + P[2] * Math.cos(th);
    const y = P[1] - h0;
    const y2 = y * Math.cos(ph) - z * Math.sin(ph);
    const z2 = y * Math.sin(ph) + z * Math.cos(ph);
    const d = D - z2;
    return [cx + (f * x) / d, cy - (f * y2) / d, d];
  };

  // Strahl durch Bildpunkt (u, v) der Ansicht k: erster belegter Wuerfel als [Punkt, Tiefe] oder null
  const strahl = (k, u, v, bis = D + radius) => {
    const th = (k * 10 * Math.PI) / 180;
    const a = (u - cx) / f; const bb = (cy - v) / f;
    for (let t = Math.max(0.1, D - radius); t <= bis; t += sch / 2) {
      const xs = a * t; const y2 = bb * t; const z2 = D - t;
      const y = y2 * Math.cos(ph) + z2 * Math.sin(ph);
      const z = -y2 * Math.sin(ph) + z2 * Math.cos(ph);
      const X = xs * Math.cos(th) - z * Math.sin(th);
      const Z = xs * Math.sin(th) + z * Math.cos(th);
      const Y = y + h0;
      if (belegt(X, Y, Z)) return [[X, Y, Z], t];
    }
    return null;
  };

  // Richtung der Flaeche bei P (nach aussen, grob): vom Schwerpunkt der belegten Nachbarn weg
  const normale = (P) => {
    let nx0 = 0; let ny0 = 0; let nz0 = 0;
    for (let a = -3; a <= 3; a += 1) for (let b2 = -3; b2 <= 3; b2 += 1) for (let c = -3; c <= 3; c += 1) {
      if (belegt(P[0] + a * sch, P[1] + b2 * sch, P[2] + c * sch)) { nx0 -= a; ny0 -= b2; nz0 -= c; }
    }
    const l = Math.hypot(nx0, ny0, nz0) || 1;
    return [nx0 / l, ny0 / l, nz0 / l];
  };

  return {
    // Tipp auf (u, v) in Ansicht k -> Punkt am Auto oder null (daneben getippt)
    treffen: (k, u, v) => { const r = strahl(k, u, v); return r ? r[0] : null; },
    abbilden,
    // [u, v] wenn die Stelle in Ansicht k zu sehen ist, sonst null
    sichtbar: (P, k) => {
      const [u, v, d] = abbilden(P, k);
      const r = strahl(k, u, v, d + 0.05);
      return r && d - r[1] < SICHT_TOLERANZ ? [u, v] : null;
    },
    // Bereich wie im bisherigen Bericht: zeile front/seite/heck, seite links/mitte/rechts
    bereich: (P) => {
      const L = gz1 - gz0; const W = gx1 - gx0; const H = gy1 - gy0; const mitte = (gx0 + gx1) / 2;
      const zeile = P[2] > gz1 - 0.22 * L ? 'front' : P[2] < gz0 + 0.2 * L ? 'heck' : 'seite';
      let seite = P[0] - mitte > 0.18 * W ? 'links' : P[0] - mitte < -0.18 * W ? 'rechts' : 'mitte';
      // Dach: Flaeche zeigt nach oben und liegt oben (Motorhaube und Heckklappe bleiben vorne/hinten)
      if (zeile === 'seite' && P[1] > gy0 + 0.6 * H && normale(P)[1] > 0.6) seite = 'mitte';
      return { zeile, seite };
    },
    // Lage auf der bisherigen Aufsicht (120 x 240, Front oben), damit alte Anzeigen weiter passen
    aufsicht: (P) => ({
      x: Math.round((16 + (88 * (gx1 - P[0])) / (gx1 - gx0)) * 10) / 10,
      y: Math.round((4 + (232 * (gz1 - P[2])) / (gz1 - gz0)) * 10) / 10,
    }),
  };
}

// Form zum Bildsatz (useDrehSatz) laden. null, wenn es fuer das Modell keine gibt.
export function formLaden(satz) {
  const m = satz?.info?.modelle?.find((x) => x.id === satz.modell);
  if (!m?.form) return Promise.resolve(null);
  if (!geladen.has(m.id)) {
    geladen.set(m.id, fetch(`${BASIS}${m.id}-form.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((p) => (p ? formBauen(m.form, p) : null))
      .catch(() => null));
  }
  return geladen.get(m.id);
}

// Ansicht k (0 = von vorne, 9 = rechte Seite, 27 = linke Seite) -> Schluessel fuer den Namen
export function ansichtSchluessel(k) {
  const w = (((k * 10) % 360) + 360) % 360;
  const namen = [[20, 'viewFront'], [70, 'viewFrontRight'], [110, 'viewRight'], [160, 'viewRearRight'], [200, 'viewRear'],
    [250, 'viewRearLeft'], [290, 'viewLeft'], [340, 'viewFrontLeft'], [360, 'viewFront']];
  return `misc.${namen.find(([bis]) => w < bis)[1]}`;
}

export const drehBildAdresse = (satz, k) => `${BASIS}${satz.modell}-${satz.lack}-${String(k).padStart(2, '0')}.webp`;

// Meldung mit Punkt im Drehbild, die zum Bildsatz des Fahrzeugs passt (gleiches Modell)?
export const passtZuSatz = (stelle, satz) => Boolean(
  satz && stelle && stelle.modell === satz.modell && Number.isFinite(stelle.ansicht) && Array.isArray(stelle.bild),
);
