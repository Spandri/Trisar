import React, { useEffect, useRef, useState } from 'react';

// 360-Grad-Ansicht des Fahrzeugs aus 36 Einzelbildern (public/fahrzeug-dreh, erzeugt mit
// werkzeuge/fahrzeugbilder/dreh-einbauen.py). Beim Oeffnen dreht sich das Auto einmal und bleibt
// schraeg vorne links stehen (Bild 32, eng zugeschnitten wie das Standbild). Von Hand gedreht bleibt
// es dort, wo der Fahrer loslaesst.

const BASIS = `${import.meta.env.BASE_URL || '/'}fahrzeug-dreh/`;
let infoVersprechen = null;

function dreInfo() {
  if (!infoVersprechen) {
    infoVersprechen = fetch(`${BASIS}fahrzeug-dreh.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return infoVersprechen;
}

// klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d"
const glatt = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

// Passender Bildsatz zu brand_model und color, sonst null.
export function drehSatzFinden(info, vehicle) {
  if (!info || !vehicle) return null;
  const modell = glatt(vehicle.brand_model);
  const farbe = glatt(vehicle.color);
  if (!modell || !farbe) return null;
  for (const m of info.modelle || []) {
    if (!m.modell.some((w) => modell.includes(w))) continue;
    const treffer = m.farben.find(([wort]) => farbe.includes(wort));
    if (treffer && (m.lacke || []).includes(treffer[1])) return { info, modell: m.id, lack: treffer[1] };
  }
  return null;
}

export function useDrehSatz(vehicle) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let aktiv = true;
    dreInfo().then((i) => { if (aktiv) setInfo(i); });
    return () => { aktiv = false; };
  }, []);
  return drehSatzFinden(info, vehicle);
}

const bildAdresse = (satz, i) => `${BASIS}${satz.modell}-${satz.lack}-${String(i).padStart(2, '0')}.webp`;

export default function FahrzeugDrehung({ satz, alt = '', style }) {
  const { info } = satz;
  const N = info.bilder;
  const START = info.start;
  const [B0, B1, B2, B3] = info.endbox;
  const buehneRef = useRef(null);
  const bildRef = useRef(null);
  const zustand = useRef({ pos: START, frame: -1, anim: 0, x0: null, p0: 0 });

  // Abstand zur Endstellung in Bildern (0..N/2)
  const abstand = (p) => { const d = (((p - START) % N) + N) % N; return Math.min(d, N - d); };

  const zeig = (p) => {
    const z = zustand.current;
    const buehne = buehneRef.current;
    const bild = bildRef.current;
    if (!buehne || !bild) return;
    z.pos = p;
    const f = ((Math.round(p) % N) + N) % N;
    if (f !== z.frame) { z.frame = f; bild.src = bildAdresse(satz, f); }
    const W = buehne.clientWidth;
    const H = buehne.clientHeight;
    // Endstellung: Bild 32 fuellt die Buehne. Beim Drehen herauszoomen, damit Seite und Heck ganz zu sehen sind.
    const sE = Math.min(W / (B2 - B0), H / (B3 - B1));
    const xE = (W - (B2 - B0) * sE) / 2 - B0 * sE;
    const yE = (H - (B3 - B1) * sE) / 2 - B1 * sE;
    const sA = Math.min(W / info.breite, H / info.hoehe);
    const xA = (W - info.breite * sA) / 2;
    const yA = (H - info.hoehe * sA) / 2;
    let w = Math.min(abstand(p) / 4, 1);
    w = w * w * (3 - 2 * w);
    const s = sE + (sA - sE) * w;
    bild.style.transform = `translate(${xE + (xA - xE) * w}px, ${yE + (yA - yE) * w}px) scale(${s})`;
  };

  // einmal ganz herum und in der Endstellung aufhoeren
  const drehen = () => {
    const z = zustand.current;
    cancelAnimationFrame(z.anim);
    const von = z.pos;
    const r = Math.round(von);
    const nach = r + ((((START - r) % N) + N) % N) + N;
    const t0 = performance.now();
    const dauer = 1700;
    const schritt = (t) => {
      const q = Math.min((t - t0) / dauer, 1);
      const e = 1 - (1 - q) ** 3;
      zeig(von + (nach - von) * e);
      if (q < 1) z.anim = requestAnimationFrame(schritt);
    };
    z.anim = requestAnimationFrame(schritt);
  };

  useEffect(() => {
    const z = zustand.current;
    z.frame = -1;
    zeig(z.pos);
    // erst alle Bilder laden, dann einmal drehen (sonst ruckelt die erste Runde)
    let aktiv = true;
    const laden = Array.from({ length: N }, (_, i) => new Promise((fertig) => {
      const im = new Image();
      im.onload = fertig;
      im.onerror = fertig;
      im.src = bildAdresse(satz, i);
    }));
    Promise.all(laden).then(() => { if (aktiv) drehen(); });
    const neu = () => zeig(zustand.current.pos);
    window.addEventListener('resize', neu);
    return () => { aktiv = false; cancelAnimationFrame(z.anim); window.removeEventListener('resize', neu); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satz.modell, satz.lack]);

  const runter = (e) => {
    const z = zustand.current;
    cancelAnimationFrame(z.anim);
    z.x0 = e.clientX;
    z.p0 = z.pos;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const ziehen = (e) => {
    const z = zustand.current;
    if (z.x0 === null) return;
    zeig(z.p0 + (e.clientX - z.x0) / 9);
  };
  // von Hand gedreht: bleibt stehen, wo der Fahrer loslaesst
  const los = () => {
    const z = zustand.current;
    if (z.x0 === null) return;
    z.x0 = null;
    zeig(Math.round(z.pos));
  };

  return (
    <div
      ref={buehneRef}
      className="absolute overflow-hidden select-none cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'pan-y', ...style }}
      onPointerDown={runter}
      onPointerMove={ziehen}
      onPointerUp={los}
      onPointerCancel={los}
      data-tutorial="fahrzeug-drehung"
    >
      <img
        ref={bildRef}
        alt={alt}
        draggable={false}
        className="absolute left-0 top-0 pointer-events-none"
        style={{ width: `${info.breite}px`, height: `${info.hoehe}px`, maxWidth: 'none', transformOrigin: '0 0' }}
      />
    </div>
  );
}
