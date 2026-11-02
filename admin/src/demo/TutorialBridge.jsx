// Kopie von fahrer-app-demo/src/demo/TutorialBridge.jsx — Aenderungen in beiden Dateien synchron halten
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Tutorial-Bruecke zum Demo-Rahmen (deploy/index.html).
//
// Der Rahmen schickt pro Tutorial-Schritt eine Nachricht; die App stellt den
// gewuenschten Zustand her, dunkelt alles ausser dem Fokus-Element ab und
// fuehrt Aktionen mit einem sichtbaren iPad-Cursor vor. Laeuft komplett ueber
// postMessage, damit die App ohne Rahmen (Handy, lokal) unveraendert bleibt.
//
// Nachrichten vom Rahmen:  { trisar: 'tutorial', cmd: 'schritt', zustand, ort, fokus, aktion }
//                          { trisar: 'tutorial', cmd: 'ende' }
//   zustand  wird als Event 'trisar:tutorial-zustand' an FahrerApp weitergereicht
//            (nur noch fuer Datenkorrekturen, nicht mehr fuer Ansichtswechsel)
//   ort      Ziel im Navigationsgraphen (siehe deploy/tutorial-fahrer.js). Die
//            Bruecke fuehrt den Cursor selbst dorthin: erst ueber die Zurueck-
//            Knoepfe nach oben, dann hinein — wie ein Mensch es taete.
//   luft     Abstand zwischen Schrift und Ausschnittkante (Vorgabe 8 px)
//   fokus    data-tutorial-Marker oder Liste davon (je Marker ein eigener Ausschnitt;
//            ein verschachteltes Array fasst mehrere Marker zu EINEM Ausschnitt
//            zusammen, z. B. [['etd-label','etd-zeit'], ['eta-label','eta-zeit']]
//            um alle, z. B. Karte plus die Knoepfe darunter); bei Bedarf wird
//            ins Bild gewischt
//   aktion   ein Schritt oder eine Liste:
//              { klick: '<marker>', nach: ms, tippen: 'Text' } — Cursor gleitet zum
//                Element, drueckt (15 % kleiner, dunkler), loest den echten Klick aus;
//                mit 'tippen' wird danach Text ins Feld geschrieben.
//              { scrollZu: '<marker>', nach: ms } — nach einer Pause wischt der
//                Finger nach oben, bis das Element im Bild ist (Inhalt folgt der
//                Bewegung, wie auf einem echten Telefon).
//              { ziehen: '<marker>', dy: 260, dx: -120, nach: ms } — Finger fasst das
//                Element in der Mitte, zieht um dx/dy (px) und laesst los; Maus- und
//                Pointer-Ereignisse (Wischkarten der Disposition). dx ist optional.
//              { umkreisen: '<css-auswahl>', runden: 2, nach: ms } — Zeiger kreist.
// Nachricht an den Rahmen: { trisar: 'tutorial-bereit' }  (einmal nach dem Login)

const ABDUNKLUNG = 'rgba(0, 0, 0, 0.74)';
const LUFT = 8;   // Abstand zwischen Element und Ausschnitt
const ECKE = 10;  // Eckenradius des Ausschnitts

// iPad-Cursor (Figma 2473-11817 normal, 2473-11818 gedrueckt): 22 px Kreis,
// gedrueckt 15 % kleiner und dunkler, alle Uebergaenge ease-in-out.
const CURSOR_PX = 22;
const CURSOR_GLEITEN_MS = 720;
const CURSOR_DRUCK_MS = 150;
const CURSOR_LEBT_NACH_KLICK_MS = 900;
const TIPPEN_MS_PRO_ZEICHEN = 55;
// Nach dem Tippen ins Feld faehrt die Bildschirmtastatur sofort hoch (460 ms).
// Erst wenn sie steht, folgt eine Sekunde Pause — dann beginnt das Schreiben.
const TASTATUR_AUSFAHREN_MS = 460;
const PAUSE_VOR_TIPPEN_MS = 1000;

// Wischgeste: der Finger legt sich auf, zieht nach oben und der Inhalt folgt.
// Laengere Strecken werden auf mehrere Zuege verteilt, wie beim echten Wischen.
const WISCH_MAX_PX = 300;      // Strecke eines gewoehnlichen Zuges
// Liegt das Ziel sehr weit weg — etwa weil der Zuschauer selbst ans Listenende
// gescrollt hat — wischt man kraeftiger, statt zehnmal kurz zu ziehen.
const WISCH_WEIT_AB_PX = 900;
const WISCH_WEIT_PX = 700;
const WISCH_MAX_ZUEGE = 10;
const WISCH_DAUER_MS = 560;    // Dauer eines Zuges
const WISCH_ANSETZEN_MS = 460; // Weg zum Aufsetzpunkt (abgehobener Finger)
const WISCH_ABHEBEN_MS = 200;  // kurz verharren, bevor der Finger abhebt
const WISCH_RAND_PX = 90;      // Abstand des Fingers zum oberen/unteren Rand
// Weite Wege (lange Listen): ein schneller Wischer mit Schwung wie am echten
// Telefon, die Liste gleitet den Grossteil nach. Erst das letzte Stueck wischt
// der Finger Zug um Zug. Ab dieser Strecke gibt es Schwung:
const SCHWUNG_AB_PX = 1400;
const SCHWUNG_FINGER_MS = 220; // kurzer, schneller Wischer
const SCHWUNG_GLEITEN_MS = 1100;

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
// Weich anfahren und ausrollen (ease-in-out), damit die Geste natuerlich wirkt.
const weich = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

// Naechster scrollbarer Vorfahr — die Ansichten scrollen in einem eigenen
// Container, nicht im Fenster.
const scrollVater = (el) => {
  let p = el?.parentElement;
  while (p) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    p = p.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

// Wie weit muss gescrollt werden, damit das Element mittig im Bild steht?
// Wie weit muss gescrollt werden, damit 'ziel' mittig im Sichtfeld steht?
// zielRect erlaubt es, statt eines einzelnen Elements einen ganzen Bereich
// (z. B. Ueberschrift plus alle Notizen) zu zentrieren.
const scrollStrecke = (el, behaelter, zielRect = null) => {
  const ziel = zielRect || el.getBoundingClientRect();
  const feld = sichtfeldFuer(el);
  const sichtHoehe = Math.max(1, feld.unten - feld.oben);
  // Passt der Bereich nicht ins Sichtfeld, oben anlegen statt zentrieren —
  // sonst ragt er oben UND unten heraus.
  const wunsch = ziel.height >= sichtHoehe
    ? feld.oben + 8
    : feld.oben + (sichtHoehe - ziel.height) / 2;
  const rest = behaelter.scrollHeight - behaelter.clientHeight - behaelter.scrollTop;
  return Math.max(-behaelter.scrollTop, Math.min(rest, Math.round(ziel.top - wunsch)));
};

const mitte = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const sichtbar = (el) => el && el.getClientRects().length > 0;
const imBild = (r) => r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
// Sichtfeld eines Elements: das Fenster, beschnitten um den scrollenden
// Bereich, in dem es liegt. In den Fahrtdetails ist das nur das untere Blatt —
// oberhalb davon liegt die Karte, dort ist nichts zu sehen, auch wenn das
// Element rechnerisch noch im Fenster steht.
// Fest stehende Leisten (Fussleiste, Bildschirmtastatur) decken den unteren
// Rand ab — was darunter liegt, ist nicht zu sehen.
// Schwebende Leisten (etwa die Navigationsleiste der Disposition, 40 px ueber
// dem Rand) zaehlen ebenfalls: sichtbar ist nur, was ueber ihrer Oberkante liegt.
const SCHWEBE_ABSTAND_PX = 64;
const festerUnterrand = () => {
  const vh = window.innerHeight;
  let oberkante = vh;
  document.querySelectorAll('footer, [data-feste-leiste]').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    // Nur Leisten unten: entweder direkt am Rand klebend oder knapp darueber
    // schwebend und in der unteren Bildhaelfte beginnend.
    const klebt = r.bottom >= vh - 2;
    const schwebt = r.bottom >= vh - SCHWEBE_ABSTAND_PX && r.top > vh * 0.4;
    if ((klebt || schwebt) && r.top < oberkante) oberkante = r.top;
  });
  return oberkante;
};

const sichtfeldFuer = (el) => {
  const behaelter = el ? scrollVater(el) : null;
  const amFenster = !behaelter
    || behaelter === document.scrollingElement
    || behaelter === document.documentElement;
  const unterrand = festerUnterrand();
  if (amFenster) return { oben: 0, unten: unterrand };
  const r = behaelter.getBoundingClientRect();
  return { oben: Math.max(0, r.top), unten: Math.min(unterrand, r.bottom) };
};
// Steht das Erklaerte ungefaehr in der Mitte seines Sichtfelds? Nur "irgendwo
// sichtbar" genuegt nicht: hat der Zuschauer vorher selbst gescrollt, klebt das
// Element sonst am Rand, obwohl es formal im Bild ist.
const MITTE_TOLERANZ_PX = 120;
const grobMittig = (el, bereich = null) => {
  if (!el) return false;
  const r = bereich || el.getBoundingClientRect();
  const feld = sichtfeldFuer(el);
  const hoehe = Math.max(1, feld.unten - feld.oben);
  if (r.top < feld.oben || r.bottom > feld.unten) return false;
  if (r.left < 0 || r.right > window.innerWidth) return false;
  const abstand = Math.abs((r.top + r.height / 2) - (feld.oben + hoehe / 2));
  // Sehr hohe Elemente fuellen das Sichtfeld ohnehin aus.
  return abstand <= MITTE_TOLERANZ_PX || r.height >= hoehe * 0.6;
};

const imRahmen = () => {
  try { return window.parent && window.parent !== window; } catch { return false; }
};

// Element per Marker finden — Ansichten wechseln animiert, deshalb kurz warten.
const markerElemente = (marker) => [...document.querySelectorAll(`[data-tutorial="${marker}"]`)].filter(sichtbar);
const markerElement = (marker) => markerElemente(marker)[0] || null;
const elementFinden = async (marker, versuche = 25) => {
  for (let i = 0; i < versuche; i += 1) {
    const el = markerElement(marker);
    if (el) return el;
     
    await schlafen(100);
  }
  return null;
};

// Nach oben wischen, bis das Element im Bild ist. Der Finger bewegt sich
// entgegen der Leserichtung: er zieht den Inhalt nach oben, also steigt er
// selbst — genau wie an einem echten Telefon.
//
// Jede Bewegung ist geglitten: der Finger faehrt sichtbar zum Aufsetzpunkt und
// zwischen zwei Zuegen wieder nach unten. Frueher wurde er dafuer aus- und
// eingeblendet, was als Sprung wirkte.
const wischenZu = async (el, setCursor, abgebrochen, startPos, zielRect = null) => {
  const behaelter = scrollVater(el);
  // Der Finger muss INNERHALB des scrollenden Bereichs wischen. In den
  // Fahrtdetails ist das nur das untere Blatt — die Karte darueber scrollt
  // nicht, dort zu wischen sieht falsch aus.
  const amFenster = behaelter === document.scrollingElement || behaelter === document.documentElement;
  const feld = amFenster
    ? { oben: 0, unten: window.innerHeight, links: 0, rechts: window.innerWidth }
    : (() => {
      const r = behaelter.getBoundingClientRect();
      return {
        oben: Math.max(0, r.top),
        unten: Math.min(window.innerHeight, r.bottom),
        links: Math.max(0, r.left),
        rechts: Math.min(window.innerWidth, r.right),
      };
    })();
  const feldHoehe = Math.max(0, feld.unten - feld.oben);
  const feldMitte = feld.oben + feldHoehe / 2;
  const x = (feld.links + feld.rechts) / 2;
  // Im Feld bleibt oben und unten etwas Rand; daraus folgt der laengste Zug,
  // den eine einzelne Wischbewegung hier ueberhaupt zurueeklegen kann.
  const rand = Math.min(WISCH_RAND_PX, Math.max(12, feldHoehe / 6));
  const maxZugImFeld = Math.max(40, feldHoehe - 2 * rand);
  // Abstand zwischen Bereichsoberkante und Ankerelement — EINMAL bestimmt.
  // Innerhalb der Schleife neu berechnet wuerde er sich mit jedem Zug
  // aufaddieren und die Bruecke wuerde weit ueber das Ziel hinausscrollen.
  const bereichVersatz = zielRect ? zielRect.top - el.getBoundingClientRect().top : 0;
  let hier = startPos ? { ...startPos } : null;

  // Sanft zu einem Punkt fahren, ohne Bodenkontakt.
  const fahrenZu = async (y, dauer) => {
    if (!hier) {
      // Kein Finger auf dem Bild: an Ort und Stelle einblenden.
      setCursor({ x, y, gedrueckt: false, sichtbar: false, sofort: true });
      await schlafen(30);
      setCursor({ x, y, gedrueckt: false, sichtbar: true, sofort: true });
      await schlafen(220);
      hier = { x, y };
      return;
    }
    // Erst einen Frame lang an der alten Stelle stehen, damit der Uebergang
    // ueberhaupt greift — sonst wechselt die Position im selben Frame.
    setCursor({ ...hier, gedrueckt: false, sichtbar: true, dauerMs: dauer });
    await schlafen(30);
    setCursor({ x, y, gedrueckt: false, sichtbar: true, dauerMs: dauer });
    await schlafen(dauer + 60);
    hier = { x, y };
  };

  // Schwung: weit entfernte Ziele mit einem Wischer anfahren, bis auf ein
  // gewoehnliches Stueck vor dem Ziel.
  {
    const offen = scrollStrecke(el, behaelter, zielRect);
    if (Math.abs(offen) > SCHWUNG_AB_PX) {
      const richtung = Math.sign(offen);
      const gleiten = offen - richtung * Math.min(WISCH_MAX_PX, maxZugImFeld) * 0.8;
      const zug = Math.min(maxZugImFeld, WISCH_MAX_PX) * 0.6;
      const start = richtung > 0 ? Math.min(feld.unten - rand, feldMitte + zug / 2) : Math.max(feld.oben + rand, feldMitte - zug / 2);
      const ende = start - richtung * zug;
      await fahrenZu(start, WISCH_ANSETZEN_MS);
      if (abgebrochen()) return hier;
      setCursor({ x, y: start, gedrueckt: true, sichtbar: true, gezogen: true });
      await schlafen(90);
      const beginnTop = behaelter.scrollTop;
      await new Promise((fertig) => {
        const t0 = performance.now();
        let losgelassen = false;
        const takt = () => {
          if (abgebrochen()) { fertig(); return; }
          const vergangen = performance.now() - t0;
          // Der Finger zieht kurz und hebt ab, der Inhalt gleitet weiter und bremst.
          const tf = Math.min(1, vergangen / SCHWUNG_FINGER_MS);
          if (!losgelassen) {
            setCursor({ x, y: start + (ende - start) * tf, gedrueckt: tf < 1, sichtbar: true, gezogen: true });
            if (tf >= 1) losgelassen = true;
          }
          const tg = Math.min(1, vergangen / SCHWUNG_GLEITEN_MS);
          behaelter.scrollTop = beginnTop + gleiten * (1 - (1 - tg) ** 3);
          if (tg >= 1) { fertig(); return; }
          requestAnimationFrame(takt);
        };
        requestAnimationFrame(takt);
      });
      if (abgebrochen()) return hier;
      hier = { x, y: ende };
      setCursor({ x, y: ende, gedrueckt: false, sichtbar: true, gezogen: true });
      await schlafen(WISCH_ABHEBEN_MS);
    }
  }

  for (let zug = 0; zug < WISCH_MAX_ZUEGE; zug += 1) {
    if (abgebrochen()) return hier;
    // Bereich mitfuehren: er verschiebt sich beim Scrollen genauso wie das Element.
    const aktuellesZiel = zielRect
      ? { top: el.getBoundingClientRect().top + bereichVersatz, height: zielRect.height }
      : null;
    const offen = scrollStrecke(el, behaelter, aktuellesZiel);
    if (Math.abs(offen) < 12) return hier;
    const zugLaenge = Math.min(
      Math.abs(offen) > WISCH_WEIT_AB_PX ? WISCH_WEIT_PX : WISCH_MAX_PX,
      maxZugImFeld,
    );
    const strecke = Math.sign(offen) * Math.min(Math.abs(offen), zugLaenge);
    // Runterscrollen (strecke > 0) heisst: Finger faehrt nach oben. Start und
    // Ende liegen immer im scrollenden Feld.
    const start = strecke > 0
      ? Math.min(feld.unten - rand, feldMitte + strecke / 2)
      : Math.max(feld.oben + rand, feldMitte - Math.abs(strecke) / 2);
    const ende = start - strecke;

     
    await fahrenZu(start, WISCH_ANSETZEN_MS);
    if (abgebrochen()) return hier;

    // Aufsetzen.
    setCursor({ x, y: start, gedrueckt: true, sichtbar: true, gezogen: true });
     
    await schlafen(140);
    if (abgebrochen()) return hier;

    // Ziehen: Finger und Inhalt bewegen sich im selben Frame. Der Takt kommt von
    // requestAnimationFrame, damit die Bewegung am Bildaufbau haengt — mit
    // setTimeout driftet sie gegen die Bildrate und wirkt ruckelig.
    const beginnTop = behaelter.scrollTop;
     
    await new Promise((fertig) => {
      const t0 = performance.now();
      const takt = () => {
        if (abgebrochen()) { fertig(); return; }
        const t = Math.min(1, (performance.now() - t0) / WISCH_DAUER_MS);
        const e = weich(t);
        behaelter.scrollTop = beginnTop + strecke * e;
        setCursor({ x, y: start + (ende - start) * e, gedrueckt: true, sichtbar: true, gezogen: true });
        if (t >= 1) { fertig(); return; }
        requestAnimationFrame(takt);
      };
      requestAnimationFrame(takt);
    });
    if (abgebrochen()) return hier;
    hier = { x, y: ende };

    // Abheben — der Finger bleibt sichtbar und faehrt beim naechsten Zug
    // wieder nach unten.
    setCursor({ x, y: ende, gedrueckt: false, sichtbar: true, gezogen: true });
     
    await schlafen(WISCH_ABHEBEN_MS);
  }
  return hier;
};

// Text so eintippen, dass React den Wert uebernimmt (nativer Setter + input-Event).
const tippen = async (el, text, abgebrochen) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  try { el.focus(); } catch { /* egal */ }
  for (let i = 1; i <= text.length; i += 1) {
    if (abgebrochen()) return;
    if (setter) setter.call(el, text.slice(0, i)); else el.value = text.slice(0, i);
    el.dispatchEvent(new Event('input', { bubbles: true }));
     
    await schlafen(TIPPEN_MS_PRO_ZEICHEN);
  }
};

// Ein Element greifen und ziehen (z. B. das Infoblatt am Griff nach unten oder
// eine Karte in der Disposition zur Seite, um die Wisch-Knoepfe freizulegen).
// Der Finger fasst an, bewegt sich mit echten Maus- UND Pointer-Ereignissen und
// laesst los — die Ansicht folgt also ihrer eigenen Zieh-Logik, nichts wird
// nachgebaut. Die Fahrer-App hoert auf Maus-Ereignisse, die Wischkarten der
// Disposition auf Pointer-Ereignisse mit setPointerCapture.
const ZIEH_DAUER_MS = 620;
const ZIEH_POINTER_ID = 1;

// Ein kuenstlicher Pointer ist dem Browser unbekannt: setPointerCapture und
// releasePointerCapture werfen dann "InvalidPointerId". Die Karten rufen beides
// VOR dem Zuruecksetzen ihres Zieh-Zustands auf — ein Fehler dort liesse sie
// im Zieh-Modus haengen. Waehrend der Geste werden beide Aufrufe darum
// abgefedert; danach gilt wieder das Original.
const pointerFangAbfedern = () => {
  const proto = typeof Element !== 'undefined' ? Element.prototype : null;
  if (!proto || typeof proto.setPointerCapture !== 'function') return () => {};
  const altSetzen = proto.setPointerCapture;
  const altLoesen = proto.releasePointerCapture;
  proto.setPointerCapture = function setPointerCaptureAbgefedert(id) {
    try { return altSetzen.call(this, id); } catch { return undefined; }
  };
  proto.releasePointerCapture = function releasePointerCaptureAbgefedert(id) {
    try { return altLoesen.call(this, id); } catch { return undefined; }
  };
  // Nur einmal zuruecksetzen — ein zweiter Aufruf koennte sonst die Abfederung
  // einer inzwischen begonnenen neuen Geste wieder entfernen.
  let zurueckgesetzt = false;
  return () => {
    if (zurueckgesetzt) return;
    zurueckgesetzt = true;
    proto.setPointerCapture = altSetzen;
    proto.releasePointerCapture = altLoesen;
  };
};

const zieheMarker = async (marker, dy, setCursor, abgebrochen, pos, dx = 0) => {
  const el = await elementFinden(marker);
  if (!el || abgebrochen()) return pos;
  const start = mitte(el);
  let hier = pos;

  // Finger sichtbar zum Griff fuehren.
  if (!hier) {
    const anfang = { x: start.x + 60, y: Math.min(window.innerHeight - 40, start.y + 90) };
    setCursor({ ...anfang, gedrueckt: false, sichtbar: false, sofort: true });
    await schlafen(30);
    setCursor({ ...anfang, gedrueckt: false, sichtbar: true, sofort: true });
    await schlafen(200);
    hier = anfang;
  }
  setCursor({ x: start.x, y: start.y, gedrueckt: false, sichtbar: true });
  await schlafen(CURSOR_GLEITEN_MS + 60);
  if (abgebrochen()) return hier;

  // Maus-Ereignisse gehen wie bisher an das markierte Element (Griff der
  // Fahrer-App). Pointer-Ereignisse gehen an das innerste Element unter dem
  // Finger — der Marker kann auf einer Huelle sitzen, deren Kind die
  // Pointer-Handler traegt; von dort steigen sie durch alle Vorfahren auf.
  const getroffen = document.elementFromPoint(start.x, start.y);
  const pointerZiel = getroffen && el.contains(getroffen) ? getroffen : el;
  const maus = (typ, x, y) => el.dispatchEvent(new MouseEvent(typ, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
  }));
  const zeiger = (typ, x, y) => {
    if (typeof PointerEvent !== 'function') return;
    pointerZiel.dispatchEvent(new PointerEvent(typ, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: ZIEH_POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: typ === 'pointerup' ? 0 : 1,
      pressure: typ === 'pointerup' ? 0 : 0.5,
    }));
  };
  const entfedern = pointerFangAbfedern();

  try {
    setCursor({ x: start.x, y: start.y, gedrueckt: true, sichtbar: true, gezogen: true });
    zeiger('pointerdown', start.x, start.y);
    maus('mousedown', start.x, start.y);
    // Kurz warten: die Ansicht merkt sich erst im naechsten Rendern, dass gezogen wird.
    await schlafen(80);
    if (abgebrochen()) {
      zeiger('pointercancel', start.x, start.y);
      return hier;
    }

    let jetzt = { x: start.x, y: start.y };
    await new Promise((fertig) => {
      const t0 = performance.now();
      const takt = () => {
        if (abgebrochen()) { fertig(); return; }
        const t = Math.min(1, (performance.now() - t0) / ZIEH_DAUER_MS);
        const e = weich(t);
        jetzt = { x: start.x + dx * e, y: start.y + dy * e };
        setCursor({ ...jetzt, gedrueckt: true, sichtbar: true, gezogen: true });
        zeiger('pointermove', jetzt.x, jetzt.y);
        maus('mousemove', jetzt.x, jetzt.y);
        if (t >= 1) { fertig(); return; }
        requestAnimationFrame(takt);
      };
      requestAnimationFrame(takt);
    });
    if (abgebrochen()) {
      // Geste sauber beenden, damit keine Karte im Zieh-Modus haengen bleibt.
      zeiger('pointercancel', jetzt.x, jetzt.y);
      return hier;
    }

    const ende = { x: start.x + dx, y: start.y + dy };
    zeiger('pointerup', ende.x, ende.y);
    maus('mouseup', ende.x, ende.y);
    if (dx !== 0) {
      // Wie bei einer echten Maus folgt dem Loslassen ein Klick. Die Wischkarten
      // merken sich nach dem Ziehen, den naechsten Klick zu schlucken — ohne
      // diesen Klick ginge sonst der naechste echte Tipp auf die Karte verloren.
      // Nur bei seitlichem Ziehen, damit das Infoblatt der Fahrer-App
      // unveraendert bleibt.
      pointerZiel.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: ende.x, clientY: ende.y,
      }));
    }
    setCursor({ ...ende, gedrueckt: false, sichtbar: true, gezogen: true });
    // Pointer-Handler laufen synchron; die Abfederung erst nach dem naechsten
    // Rendern aufheben, falls eine Ansicht die Freigabe in einem Effekt nachholt.
    await schlafen(60);
    entfedern();
    await schlafen(260);
    return ende;
  } finally {
    entfedern();
  }
};

// Etwas auf der Karte zeigen, das kein Knopf ist: der Zeiger faehrt hin und
// zieht ein paar Kreise darum. Kartenfahnen und Pins sind Bilder von Google
// Maps ohne eigene Marker, darum wird hier per CSS-Auswahl gesucht.
const UMKREIS_MS_PRO_RUNDE = 900;
const elementNachWahl = async (wahl, versuche = 25) => {
  for (let i = 0; i < versuche; i += 1) {
    const treffer = [...document.querySelectorAll(wahl)].filter(sichtbar);
    if (treffer[0]) return treffer[0];
     
    await schlafen(100);
  }
  return null;
};

const umkreiseZiel = async (wahl, runden, setCursor, abgebrochen, pos) => {
  const el = await elementNachWahl(wahl);
  if (!el || abgebrochen()) return pos;
  const r = el.getBoundingClientRect();
  const ziel = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // Radius nach der Groesse des Gezeigten, aber nie so klein, dass die Runde
  // als Zittern wirkt.
  const radius = Math.max(26, Math.max(r.width, r.height) * 0.9);
  let hier = pos;

  if (!hier) {
    const anfang = { x: ziel.x + 70, y: Math.min(window.innerHeight - 40, ziel.y + 96) };
    setCursor({ ...anfang, gedrueckt: false, sichtbar: false, sofort: true });
    await schlafen(30);
    setCursor({ ...anfang, gedrueckt: false, sichtbar: true, sofort: true });
    await schlafen(200);
    hier = anfang;
  }

  // Erst sichtbar hinfahren, dann kreisen.
  const eintritt = { x: ziel.x + radius, y: ziel.y };
  setCursor({ ...eintritt, gedrueckt: false, sichtbar: true });
  await schlafen(CURSOR_GLEITEN_MS + 80);
  if (abgebrochen()) return eintritt;

  const dauer = Math.max(1, runden) * UMKREIS_MS_PRO_RUNDE;
  await new Promise((fertig) => {
    const t0 = performance.now();
    const takt = () => {
      if (abgebrochen()) { fertig(); return; }
      const t = Math.min(1, (performance.now() - t0) / dauer);
      // Jede Runde gleich schnell, Anfang und Ende weich.
      const winkel = weich(t) * Math.max(1, runden) * 2 * Math.PI;
      setCursor({
        x: ziel.x + Math.cos(winkel) * radius,
        y: ziel.y + Math.sin(winkel) * radius,
        gedrueckt: false,
        sichtbar: true,
        sofort: true,
      });
      if (t >= 1) { fertig(); return; }
      requestAnimationFrame(takt);
    };
    requestAnimationFrame(takt);
  });
  if (abgebrochen()) return eintritt;

  setCursor({ ...eintritt, gedrueckt: false, sichtbar: true, sofort: true });
  await schlafen(160);
  return eintritt;
};

// Einen Knopf so anfahren und druecken, wie ein Mensch es taete: Finger gleitet
// hin, drueckt (15 % kleiner, dunkler), loest den echten Klick aus. Steht das
// Ziel nicht ungefaehr mittig, wird vorher sichtbar dorthin gewischt.
// Rueckgabe: neue Fingerposition (oder null, wenn das Ziel nicht auftauchte).
// Mehrfach belegtes Feld der Navigationsleiste, das diese Moeglichkeit anbietet.
const schnellwahlFeld = (marker) => [...document.querySelectorAll('[data-schnellwahl-optionen]')]
  .filter(sichtbar)
  .find((feld) => (feld.dataset.schnellwahlOptionen || '').split(' ').includes(marker)) || null;

// Element, das den gesuchten Marker erst hervorbringt, etwa eine Gruppe von
// Fahrern auf der Karte (data-oeffnet="karte-fahrer-1 karte-fahrer-2 ...").
const oeffnerFuer = (marker) => [...document.querySelectorAll('[data-oeffnet]')]
  .filter(sichtbar)
  .find((el) => (el.dataset.oeffnet || '').split(' ').includes(marker)) || null;
const OEFFNER_WARTEN_MS = 1500;

const klickeMarker = async (marker, setCursor, abgebrochen, pos, tippText) => {
  // Steckt das Ziel in einer Gruppe, tippt der Finger zuerst die Gruppe an und
  // wartet, bis die Karte hineingefahren ist. Verschachtelt geht es mehrmals.
  // Die Gruppen entstehen erst, wenn die Karte steht, darum kurz auf beides warten.
  for (let runde = 0, versuche = 0; runde < 4 && versuche < 30 && !markerElement(marker); versuche += 1) {
    const oeffner = oeffnerFuer(marker);
    if (!oeffner) {
      if (!document.querySelector('[data-oeffnet]')) break;
      await schlafen(100);
      continue;
    }
    runde += 1;
    const kennung = `oeffner-${Date.now()}-${runde}`;
    const alteKennung = oeffner.getAttribute('data-tutorial');
    // Kurzzeitig eine eigene Kennung, damit genau dieses Element getroffen wird.
    oeffner.setAttribute('data-tutorial', kennung);
    pos = await klickeMarker(kennung, setCursor, abgebrochen, pos);
    if (oeffner.isConnected) {
      if (alteKennung) oeffner.setAttribute('data-tutorial', alteKennung);
      else oeffner.removeAttribute('data-tutorial');
    }
    if (abgebrochen()) return pos;
    await schlafen(OEFFNER_WARTEN_MS);
  }
  // Eine Moeglichkeit eines mehrfach belegten Felds: steht sie vorne, genuegt ein
  // Tipp aufs Feld. Sonst zieht der Finger sie hoch, wie man es selbst taete.
  for (let i = 0; i < 25 && !markerElement(marker); i += 1) {
    const feld = schnellwahlFeld(marker);
    if (feld) {
      if (feld.dataset.schnellwahlVorne !== marker) {
        return wechsleMarker(feld.dataset.tutorial, marker, setCursor, abgebrochen, pos);
      }
      marker = feld.dataset.tutorial;
      break;
    }
    await schlafen(100);
  }
  const el = await elementFinden(marker);
  if (!el || abgebrochen()) return pos;
  let hier = pos;
  if (!grobMittig(el)) {
    hier = await wischenZu(el, setCursor, abgebrochen, hier);
    if (abgebrochen()) return hier;
  }
  const ziel = mitte(el);
  if (!hier) {
    // Erster Auftritt: versetzt daneben einblenden, damit der Finger nicht
    // aus dem Nichts auf dem Knopf steht.
    const anfang = { x: ziel.x + 70, y: Math.min(window.innerHeight - 40, ziel.y + 96) };
    setCursor({ ...anfang, gedrueckt: false, sichtbar: false, sofort: true });
    await schlafen(30);
    setCursor({ ...anfang, gedrueckt: false, sichtbar: true, sofort: true });
    await schlafen(220);
    hier = anfang;
    if (abgebrochen()) return hier;
  }
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: false, sichtbar: true });
  await schlafen(CURSOR_GLEITEN_MS + 80);
  if (abgebrochen()) return { x: ziel.x, y: ziel.y };
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: true, sichtbar: true });
  await schlafen(CURSOR_DRUCK_MS);
  if (abgebrochen()) return { x: ziel.x, y: ziel.y };
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: false, sichtbar: true });
  try {
    // SVG-Elemente kennen kein click() — dort ein echtes Maus-Ereignis mit den
    // Koordinaten des Ziels schicken, damit die Ansicht weiss, wo getippt wurde.
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: ziel.x, clientY: ziel.y,
    }));
  } catch { /* Element ohne Klick-Handler */ }
  if (typeof tippText === 'string' && tippText) {
    // Erst ins Feld gehen — dadurch faehrt die Bildschirmtastatur sofort hoch.
    // Danach steht das Bild eine Sekunde still, bevor geschrieben wird.
    try { el.focus(); } catch { /* egal */ }
    await schlafen(TASTATUR_AUSFAHREN_MS + PAUSE_VOR_TIPPEN_MS);
    if (abgebrochen()) return { x: ziel.x, y: ziel.y };
    await tippen(el, tippText, abgebrochen);
    // Feld verlassen, damit eine eingeblendete Bildschirmtastatur wieder
    // einfaehrt, bevor der naechste Knopf (z. B. Abschicken) gedrueckt wird.
    try { el.blur(); } catch { /* egal */ }
    await schlafen(520);
  }
  return { x: ziel.x, y: ziel.y };
};

// Lange druecken: der Finger haelt das Element gedrueckt, bis es reagiert
// (etwa die mehrfach belegten Felder der Navigationsleiste, die dann ihre
// weiteren Moeglichkeiten aufklappen), und laesst danach los.
const LANGE_DRUECKEN_MS = 700;
const langeDrueckeMarker = async (marker, setCursor, abgebrochen, pos) => {
  const el = await elementFinden(marker);
  if (!el || abgebrochen()) return pos;
  const ziel = mitte(el);
  if (!pos) {
    const anfang = { x: ziel.x + 70, y: Math.min(window.innerHeight - 40, ziel.y + 96) };
    setCursor({ ...anfang, gedrueckt: false, sichtbar: false, sofort: true });
    await schlafen(30);
    setCursor({ ...anfang, gedrueckt: false, sichtbar: true, sofort: true });
    await schlafen(220);
    if (abgebrochen()) return anfang;
  }
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: false, sichtbar: true });
  await schlafen(CURSOR_GLEITEN_MS + 80);
  if (abgebrochen()) return { x: ziel.x, y: ziel.y };
  const zeiger = (typ) => {
    try {
      el.dispatchEvent(new PointerEvent(typ, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: ziel.x, clientY: ziel.y,
      }));
    } catch { /* Element ohne Zeiger-Handler */ }
  };
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: true, sichtbar: true });
  zeiger('pointerdown');
  await schlafen(LANGE_DRUECKEN_MS);
  zeiger('pointerup');
  setCursor({ x: ziel.x, y: ziel.y, gedrueckt: false, sichtbar: true });
  await schlafen(250);
  return { x: ziel.x, y: ziel.y };
};

// Belegung eines mehrfach belegten Felds wechseln: der Finger haelt das Feld
// gedrueckt, bis die weiteren Moeglichkeiten aufklappen, zieht nach oben auf
// die gewuenschte und laesst dort los. Das Feld zeigt sie danach vorne und
// die passende Seite oeffnet sich.
const WECHSEL_HALTEN_MS = 650;
const WECHSEL_ZIEHEN_MS = 520;
const wechsleMarker = async (marker, zielMarker, setCursor, abgebrochen, pos) => {
  const el = await elementFinden(marker);
  if (!el || abgebrochen()) return pos;
  // Steht die Moeglichkeit schon vorne, genuegt ein Tipp.
  if (el.dataset.schnellwahlVorne === zielMarker) return klickeMarker(marker, setCursor, abgebrochen, pos);
  const start = mitte(el);
  if (!pos) {
    const anfang = { x: start.x + 70, y: Math.min(window.innerHeight - 40, start.y + 96) };
    setCursor({ ...anfang, gedrueckt: false, sichtbar: false, sofort: true });
    await schlafen(30);
    setCursor({ ...anfang, gedrueckt: false, sichtbar: true, sofort: true });
    await schlafen(220);
    if (abgebrochen()) return anfang;
  }
  setCursor({ x: start.x, y: start.y, gedrueckt: false, sichtbar: true });
  await schlafen(CURSOR_GLEITEN_MS + 80);
  if (abgebrochen()) return start;
  const zeiger = (typ, punkt) => {
    try {
      el.dispatchEvent(new PointerEvent(typ, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: punkt.x, clientY: punkt.y,
      }));
    } catch { /* Element ohne Zeiger-Handler */ }
  };
  setCursor({ x: start.x, y: start.y, gedrueckt: true, sichtbar: true });
  zeiger('pointerdown', start);
  await schlafen(WECHSEL_HALTEN_MS);
  const zielEl = await elementFinden(zielMarker, 10);
  if (!zielEl || abgebrochen()) {
    zeiger('pointercancel', start);
    setCursor({ x: start.x, y: start.y, gedrueckt: false, sichtbar: true });
    return start;
  }
  const ende = mitte(zielEl);
  // Gedrueckt nach oben gleiten, die Moeglichkeit unter dem Finger wird groesser.
  setCursor({ x: ende.x, y: ende.y, gedrueckt: true, sichtbar: true, dauerMs: WECHSEL_ZIEHEN_MS });
  const schritte = 8;
  for (let i = 1; i <= schritte; i += 1) {
    await schlafen(WECHSEL_ZIEHEN_MS / schritte);
    const t = i / schritte;
    zeiger('pointermove', { x: start.x + (ende.x - start.x) * t, y: start.y + (ende.y - start.y) * t });
  }
  await schlafen(260);
  if (abgebrochen()) {
    zeiger('pointercancel', ende);
    return ende;
  }
  zeiger('pointerup', ende);
  // Ein echter Finger loest nach dem Loslassen noch einen Klick aus. Das Feld
  // wartet darauf und verwirft ihn, sonst schluckte es den naechsten Tipp.
  try { el.click(); } catch { /* Element ohne Klick-Handler */ }
  setCursor({ x: ende.x, y: ende.y, gedrueckt: false, sichtbar: true });
  await schlafen(250);
  return ende;
};

// Fokus-Angabe vereinheitlichen: ein Marker, eine Liste von Markern oder
// Gruppen von Markern (die zusammen ein Loch bilden).
const markerListe = (wert) => {
  if (Array.isArray(wert)) {
    return wert
      .map((f) => (Array.isArray(f) ? f.filter((m) => typeof m === 'string' && m) : f))
      .filter((f) => (Array.isArray(f) ? f.length : typeof f === 'string' && f));
  }
  return typeof wert === 'string' && wert ? [wert] : null;
};

// --- Navigation ---------------------------------------------------------
// Der Rahmen liefert die Ortskarte (welcher Ort haengt an welchem, mit welchem
// Knopf geht es hinein und wieder heraus). Daraus berechnet die Bruecke den
// Klickweg von hier nach dort.
// Die Karte kommt vom Rahmen (anderes Fenster) und wird hier gemerkt.
let ORTE = {};
const ortsKarte = () => ORTE;

// Kette vom Ort bis zur Wurzel, z. B. verlauf -> profil -> list.
const kette = (ort) => {
  const karte = ortsKarte();
  const weg = [];
  let hier = ort;
  for (let i = 0; i < 12 && hier; i += 1) {
    weg.push(hier);
    hier = karte[hier]?.von || null;
  }
  return weg;
};

// Wo sind wir wirklich? Jeder Ort nennt in der Karte seine Kennung: Marker, die
// nur dort sichtbar sind. Tiefere Orte (Blaetter ueber Details) zuerst pruefen,
// weil darunterliegende Ansichten im DOM ebenfalls sichtbar bleiben.
const ortErkennen = () => {
  const karte = ortsKarte();
  const orte = Object.keys(karte)
    .filter((o) => karte[o]?.kennung)
    .sort((a, b) => kette(b).length - kette(a).length);
  for (const o of orte) {
    const kennungen = Array.isArray(karte[o].kennung) ? karte[o].kennung : [karte[o].kennung];
    if (kennungen.every((m) => markerElement(m))) return o;
  }
  return null;
};

// Klickfolge von 'vonOrt' nach 'nachOrt': erst so oft zurueck, bis beide Wege
// sich treffen, dann hinein. null = Weg unbekannt.
const wegBerechnen = (vonOrt, nachOrt) => {
  const karte = ortsKarte();
  if (!nachOrt || !karte[nachOrt]) return null;
  if (vonOrt === nachOrt) return [];
  const hin = kette(nachOrt);
  const her = vonOrt && karte[vonOrt] ? kette(vonOrt) : [kette(nachOrt)[kette(nachOrt).length - 1]];
  const treff = her.find((o) => hin.includes(o));
  if (!treff) return null;
  const schritte = [];
  for (const o of her) {
    if (o === treff) break;
    const zurueck = karte[o]?.zurueck;
    if (!zurueck) return null;
    schritte.push({ klick: zurueck, richtung: 'zurueck' });
  }
  const hinein = hin.slice(0, hin.indexOf(treff)).reverse();
  for (const o of hinein) {
    const rein = karte[o]?.hin;
    if (!rein) return null;
    schritte.push({ klick: rein, richtung: 'hinein' });
  }
  return schritte;
};

const TutorialBridge = () => {
  const [fokusId, setFokusId] = useState(null);
  const [fokusLuft, setFokusLuft] = useState(null);
  const [rect, setRect] = useState(null);
  // Cursor: null = unsichtbar; sonst Position, gedrueckt-Zustand, Sichtbarkeit.
  const [cursor, setCursor] = useState(null);
  // Ein Auftrag je Tutorial-Schritt: erst hinnavigieren, dann Fokus, dann Aktionen.
  const [auftrag, setAuftrag] = useState(null);
  // Wo der Finger gerade steht und in welcher Ansicht wir sind — beides ueberlebt
  // den Schrittwechsel, damit die naechste Bewegung dort ansetzt, wo die letzte endete.
  const ortRef = useRef(null);
  const posRef = useRef(null);
  const letztesRectRef = useRef(null);

  useEffect(() => {
    if (!imRahmen()) return undefined;
    const anNachricht = (e) => {
      const d = e?.data;
      if (!d || d.trisar !== 'tutorial') return;
      if (d.cmd === 'schritt') {
        if (d.orte && typeof d.orte === 'object') ORTE = d.orte;
        // Merkzeichen fuer die Ansichten: waehrend des Tutorials darf nichts
        // aufgehen, was den Ablauf anhaelt — etwa die Dateiauswahl beim Foto.
        window.__TRISAR_TUTORIAL_LAEUFT = true;
        const liste = Array.isArray(d.aktion) ? d.aktion : (d.aktion ? [d.aktion] : []);
        setAuftrag({
          zustand: d.zustand || null,
          ort: typeof d.ort === 'string' && d.ort ? d.ort : null,
          fokus: markerListe(d.fokus),
          // Zweite Hervorhebung: nach den Aktionen wandert das Licht weiter,
          // etwa vom oberen Kasten auf das, was daruntersteht. Waehrend der
          // Aktion ist nichts hervorgehoben — sonst laege das Loch beim
          // Scrollen ausserhalb des Bildes und alles waere dunkel.
          fokusDanach: markerListe(d.fokusDanach),
          luft: Number.isFinite(d.luft) ? d.luft : null,
          // Fokus erst nach den Aktionen setzen — etwa wenn das Blatt zuerst
          // heruntergezogen wird und die Karte dadurch erst ihre Groesse bekommt.
          // true = nach allen Aktionen, Zahl = nach so vielen Aktionen. So kann
          // die Hervorhebung schon stehen, waehrend der Zeiger noch etwas zeigt.
          fokusNachAktion: Number.isFinite(d.fokusNachAktion) ? d.fokusNachAktion : d.fokusNachAktion === true,
          // Aktionen vor Text und Hervorhebung ausfuehren — etwa wenn das Blatt
          // erst hochgezogen werden muss, bevor ueberhaupt etwas zu sehen ist.
          aktionZuerst: d.aktionZuerst === true,
          aktionen: liste.filter((a) => a && (typeof a.klick === 'string' || typeof a.scrollZu === 'string' || typeof a.ziehen === 'string' || typeof a.umkreisen === 'string' || typeof a.lange === 'string' || typeof a.wechseln === 'string')),
          // Neues Objekt pro Schritt, damit derselbe Schritt erneut ablaeuft.
          seq: Date.now(),
        });
      } else if (d.cmd === 'ende') {
        window.__TRISAR_TUTORIAL_LAEUFT = false;
        setAuftrag(null);
        setFokusId(null);
        setCursor(null);
      }
    };
    window.addEventListener('message', anNachricht);
    try { window.parent.postMessage({ trisar: 'tutorial-bereit' }, '*'); } catch { /* kein Rahmen */ }
    return () => window.removeEventListener('message', anNachricht);
  }, []);

  // Fokus-Element verfolgen: Ansichten wechseln animiert, Listen scrollen —
  // deshalb pro Frame nachmessen statt einmalig. Ohne Fokus laeuft nichts.
  useEffect(() => {
    let raf = 0;
    let zuletzt = '';
    // Geglaettete Werte des Ausschnitts. Kleine Aenderungen (Scrollen, Wischen)
    // uebernimmt er sofort — sonst zoege er sichtbar hinterher. Nur grosse
    // Spruenge (anderes Element im Fokus) laufen weich hinueber.
    let gezeigt = null;
    const marker = Array.isArray(fokusId) ? fokusId : (fokusId ? [fokusId] : []);
    const messen = () => {
      // Ausgeblendete Ansichten bleiben im DOM (display:none) — ihr Rect ist
      // 0/0/0/0 und wuerde das Loch auf 16 px kollabieren lassen. Nur sichtbare
      // Elemente zaehlen; sonst verschwindet das Overlay und die neue Ansicht
      // (z. B. nach einem Tipp auf die Fahrzeugkarte) bleibt bedienbar.
      // Jeder Marker bekommt seinen eigenen Ausschnitt — bei mehreren bleibt die
      // Flaeche dazwischen abgedunkelt und wird nicht unnoetig mitmarkiert.
      const huelle = (namen) => {
        const elemente = namen.flatMap(markerElemente);
        const teile = elemente.map((el) => el.getBoundingClientRect());
        if (!teile.length) return null;
        const links = Math.min(...teile.map((q) => q.left));
        const oben = Math.min(...teile.map((q) => q.top));
        // Eckenradius des Elements selbst — fuer buendige Ausschnitte (luft 0),
        // damit eckige Karten eckig und runde Knoepfe rund markiert werden.
        const ecke = Math.min(...elemente.map((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0));
        return {
          x: links,
          y: oben,
          w: Math.max(...teile.map((q) => q.right)) - links,
          h: Math.max(...teile.map((q) => q.bottom)) - oben,
          ecke,
        };
      };
      const rects = marker
        .map((eintrag) => huelle(Array.isArray(eintrag) ? eintrag : [eintrag]))
        .filter(Boolean);
      if (rects.length) {
        const schluessel = rects.map((q) => [q.x, q.y, q.w, q.h].map(Math.round).join(',')).join('|');
        // Grosse Distanz = Sprung auf ein anderes Element: in Schritten
        // annaehern. Kleine Distanz = laufende Bewegung: sofort uebernehmen.
        const SPRUNG_AB = 60;
        const naehern = (ziel, ist) => {
          if (ist == null) return ziel;
          const schritt = (a, b) => (Math.abs(b - a) > SPRUNG_AB ? a + (b - a) * 0.28 : b);
          return {
            x: schritt(ist.x, ziel.x),
            y: schritt(ist.y, ziel.y),
            w: schritt(ist.w, ziel.w),
            h: schritt(ist.h, ziel.h),
            ecke: ziel.ecke,
          };
        };
        gezeigt = rects.map((q, i) => naehern(q, gezeigt && gezeigt[i]));
        const gezeigtSchluessel = gezeigt.map((q) => [q.x, q.y, q.w, q.h].map(Math.round).join(',')).join('|');
        if (gezeigtSchluessel !== zuletzt) {
          zuletzt = gezeigtSchluessel;
          setRect(gezeigt);
        }
      } else if (zuletzt !== 'fehlt') {
        zuletzt = 'fehlt';
        gezeigt = null;
        setRect(null);
      }
      raf = requestAnimationFrame(messen);
    };
    raf = requestAnimationFrame(messen);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fokusId), fokusLuft]);

  // Ablauf eines Tutorial-Schritts: erst Daten richten, dann mit dem Finger
  // dorthin navigieren (ueber Zurueck-Knoepfe hinaus, ueber Knoepfe hinein),
  // dann den Fokus setzen und zuletzt die Aktionen des Schritts abspielen.
  // Es wird nie mehr zwischen Ansichten gesprungen.
  useEffect(() => {
    if (!auftrag) return undefined;
    let abgebrochen = false;
    const weg = () => abgebrochen;
    const setzePos = (c) => {
      setCursor(c);
      if (c && typeof c.x === 'number') posRef.current = { x: c.x, y: c.y };
      if (c === null) posRef.current = null;
    };

    (async () => {
      // 1. Datenstand (offene Fahrt, offene Dienstanfrage) wiederherstellen.
      if (auftrag.zustand) {
        window.dispatchEvent(new CustomEvent('trisar:tutorial-zustand', { detail: auftrag.zustand }));
        await schlafen(auftrag.zustand.patches ? 700 : 120);
        if (weg()) return;
      }

      // 2. Hinnavigieren. Der Ausgangsort wird am Bildschirm erkannt — ein
      //    gemerkter Wert stimmt nicht mehr, wenn ein frueherer Schritt mitten
      //    in einer Bewegung abgebrochen wurde (kreuz und quer vor/zurueck).
      //    Der Fokus wird vorher abgeschaltet, damit die Abdunklung nicht ueber
      //    Knoepfen liegt, die der Finger druecken muss.
      const ziel = auftrag.ort || 'list';
      const angekommen = () => {
        const k = ortsKarte()[ziel]?.kennung;
        if (!k) return true;
        return (Array.isArray(k) ? k : [k]).every((m) => markerElement(m));
      };
      for (let versuch = 0; versuch < 2; versuch += 1) {
        const hier = ortErkennen() || ortRef.current;
        let schritte = wegBerechnen(hier, ziel);
        if (schritte === null || versuch === 1) {
          // Weg unbekannt oder erster Anlauf gescheitert: auf die Startseite
          // zuruecksetzen und von dort aus neu anfahren.
          window.dispatchEvent(new CustomEvent('trisar:tutorial-zustand', { detail: { ansicht: 'list' } }));
          await schlafen(260);
          schritte = wegBerechnen('list', ziel) || [];
        }
        if (schritte.length) {
          setFokusId(null);
          for (const schritt of schritte) {
            if (weg()) return;
            posRef.current = await klickeMarker(schritt.klick, setzePos, weg, posRef.current);
            if (weg()) return;
            await schlafen(420); // Ansichtswechsel ausklingen lassen
          }
        }
        // Ankunft pruefen — die Kennung des Ziels muss sichtbar sein.
        let da = angekommen();
        for (let i = 0; i < 10 && !da; i += 1) {
          await schlafen(100);
          da = angekommen();
        }
        if (da) break;
      }
      ortRef.current = ziel;
      if (weg()) return;

      // 3. Fokus setzen — steht das Element nicht mittig, wischt der Finger hin.
      const fokusSetzen = async (welcher = auftrag.fokus) => {
        if (welcher && welcher.length) {
        // Der erste Eintrag kann eine Gruppe sein — dann zaehlt ihr erster Marker.
          const ersterMarker = Array.isArray(welcher[0]) ? welcher[0][0] : welcher[0];
          const el = await elementFinden(ersterMarker);
          if (weg()) return;
          // Huelle ueber ALLE Marker des Schritts: es soll alles zu sehen sein,
          // nicht nur das erste Element.
          const alleMarker = welcher.flatMap((e) => (Array.isArray(e) ? e : [e]));
          const teile = alleMarker
            .flatMap(markerElemente)
            .map((e) => e.getBoundingClientRect());
          // Vollstaendiges Rechteck (auch bottom/left/right): grobMittig prueft
          // damit, ob der Bereich unten aus dem Sichtfeld ragt — mit nur
          // top/height galt ein hoher Bereich faelschlich als "im Bild".
          const huelle = teile.length
            ? (() => {
              const oben = Math.min(...teile.map((q) => q.top));
              const unten = Math.max(...teile.map((q) => q.bottom));
              const links = Math.min(...teile.map((q) => q.left));
              const rechts = Math.max(...teile.map((q) => q.right));
              return { top: oben, bottom: unten, height: unten - oben, left: links, right: rechts };
            })()
            : null;
          if (el && !grobMittig(el, huelle)) {
            posRef.current = await wischenZu(el, setzePos, weg, posRef.current, huelle);
            if (weg()) return;
          }
          setFokusLuft(auftrag.luft);
          setFokusId(welcher);
        } else {
          setFokusId(null);
        }
      };
      // Zahl bei fokusNachAktion: nach so vielen Aktionen wird hervorgehoben.
      const fokusNachSovielen = Number.isFinite(auftrag.fokusNachAktion) ? auftrag.fokusNachAktion : null;
      let fokusSchonGesetzt = false;
      const aktionenLaufen = async () => {
        let nummer = 0;
        for (const a of auftrag.aktionen) {
          if (weg()) return;
          await schlafen(Number.isFinite(a.nach) ? a.nach : 500);
          if (weg()) return;
          // Wandert die Hervorhebung anschliessend weiter, wird sie jetzt —
          // wenn die Bewegung beginnt — abgeschaltet. Sonst laege das Loch
          // beim Scrollen ausserhalb des Bildes und alles waere dunkel.
          if (auftrag.fokusDanach) setFokusId(null);
          if (a.wechseln) {
            // Gedrueckt halten, nach oben ziehen und die Belegung wechseln.
            posRef.current = await wechsleMarker(a.wechseln, a.zu, setzePos, weg, posRef.current);
          } else if (a.lange) {
            // Gedrueckt halten, bis sich die weiteren Moeglichkeiten zeigen.
            posRef.current = await langeDrueckeMarker(a.lange, setzePos, weg, posRef.current);
          } else if (a.umkreisen) {
            // Etwas auf der Karte zeigen (gruene Startfahne, Zielfahne).
            posRef.current = await umkreiseZiel(a.umkreisen, a.runden || 2, setzePos, weg, posRef.current);
          } else if (a.ziehen) {
            // Griff fassen und ziehen (z. B. Infoblatt nach unten).
            posRef.current = await zieheMarker(a.ziehen, a.dy || 0, setzePos, weg, posRef.current, Number.isFinite(a.dx) ? a.dx : 0);
          } else if (!a.klick) {
            const el = await elementFinden(a.scrollZu);
            if (!el || weg()) return;
            posRef.current = await wischenZu(el, setzePos, weg, posRef.current);
          } else {
            posRef.current = await klickeMarker(a.klick, setzePos, weg, posRef.current, a.tippen);
            // Ein Klick innerhalb einer Aktion kann die Ansicht wechseln; der Ort
            // wird dann vom Schritt selbst gesetzt (siehe 'ort' des naechsten Schritts).
            if (typeof a.ortDanach === 'string') ortRef.current = a.ortDanach;
          }
          nummer += 1;
          if (fokusNachSovielen !== null && !fokusSchonGesetzt && nummer >= fokusNachSovielen) {
            fokusSchonGesetzt = true;
            await fokusSetzen();
            if (weg()) return;
          }
        }
      };

      setFokusId(null);
      // Aktionen, die vor allem anderen laufen (z. B. Blatt hochziehen, damit
      // ueberhaupt etwas zu sehen ist) — Text und Hervorhebung folgen danach.
      if (auftrag.aktionZuerst) {
        await aktionenLaufen();
        if (weg()) return;
      }
      if (!auftrag.fokusNachAktion) await fokusSetzen();
      if (weg()) return;

      // Dem Rahmen sagen, dass die Ansicht erreicht ist — erst jetzt zeigt er den Text.
      try { window.parent.postMessage({ trisar: 'tutorial-angekommen' }, '*'); } catch { /* kein Rahmen */ }

      // 4. Aktionen des Schritts (bei aktionZuerst liefen sie schon oben).
      if (!auftrag.aktionZuerst) await aktionenLaufen();
      if (weg()) return;
      if (auftrag.fokusDanach) {
        await fokusSetzen(auftrag.fokusDanach);
        if (weg()) return;
      }
      // Fokus, der auf das Ergebnis der Aktion zeigt (z. B. die freigelegte Karte).
      if (auftrag.fokusNachAktion && !fokusSchonGesetzt) {
        await fokusSetzen();
        if (weg()) return;
      }
      // Dem Rahmen melden, dass der Schritt komplett durch ist — er schickt ihn
      // dann beim Zurueckkehren in den Tab nicht erneut (sonst doppelte Aktionen).
      try { window.parent.postMessage({ trisar: 'tutorial-fertig' }, '*'); } catch { /* kein Rahmen */ }
      await schlafen(CURSOR_LEBT_NACH_KLICK_MS);
      if (weg()) return;
      setCursor((c) => (c ? { ...c, sichtbar: false } : c));
    })();
    return () => { abgebrochen = true; };
  }, [auftrag]);

  const cursorEl = cursor ? (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: CURSOR_PX,
        height: CURSOR_PX,
        borderRadius: '50%',
        // Neutrales Grau mit hellem Saum: sichtbar auf Schwarz wie auf Weiss.
        background: cursor.gedrueckt ? 'rgba(70, 70, 72, 0.9)' : 'rgba(128, 128, 130, 0.78)',
        boxShadow: cursor.gedrueckt
          ? '0 0 0 1px rgba(255,255,255,0.22), 0 1px 3px rgba(0,0,0,0.35)'
          : '0 0 0 1px rgba(255,255,255,0.38), 0 2px 6px rgba(0,0,0,0.35)',
        opacity: cursor.sichtbar ? 1 : 0,
        transform: `translate(${cursor.x - CURSOR_PX / 2}px, ${cursor.y - CURSOR_PX / 2}px) scale(${cursor.gedrueckt ? 0.85 : 1})`,
        transition: cursor.dauerMs
          ? `transform ${cursor.dauerMs}ms ease-in-out, background ${CURSOR_DRUCK_MS}ms ease-in-out, box-shadow ${CURSOR_DRUCK_MS}ms ease-in-out, opacity 260ms ease-in-out`
          : cursor.gezogen
          // Beim Wischen wird die Position pro Frame gesetzt; eine Transition
          // wuerde den Finger hinter dem Inhalt herhinken lassen.
          ? `background ${CURSOR_DRUCK_MS}ms ease-in-out, box-shadow ${CURSOR_DRUCK_MS}ms ease-in-out, opacity 200ms ease-in-out`
          : cursor.sofort
            ? 'opacity 220ms ease-in-out'
            : `transform ${cursor.gedrueckt ? CURSOR_DRUCK_MS : CURSOR_GLEITEN_MS}ms ease-in-out, background ${CURSOR_DRUCK_MS}ms ease-in-out, box-shadow ${CURSOR_DRUCK_MS}ms ease-in-out, opacity 260ms ease-in-out`,
        zIndex: 9500,
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    />
  ) : null;

  const aktiv = Boolean(fokusId && rect);
  // Letztes Rechteck behalten, damit die Abdunklung beim Ausblenden nicht
  // zusammenklappt, sondern an Ort und Stelle verblasst.
  const r = rect || letztesRectRef.current;
  if (rect) letztesRectRef.current = rect;
  if (!r) return cursorEl ? createPortal(cursorEl, document.body) : null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Jedes Rechteck um LUFT erweitern und auf den Bildschirm begrenzen.
  const abstandJetzt = Number.isFinite(fokusLuft) ? fokusLuft : LUFT;
  const loecher = (Array.isArray(r) ? r : [r]).map((q) => {
    const x = Math.max(0, q.x - abstandJetzt);
    const y = Math.max(0, q.y - abstandJetzt);
    return {
      x,
      y,
      b: Math.max(0, Math.min(vw, q.x + q.w + abstandJetzt) - x),
      h: Math.max(0, Math.min(vh, q.y + q.h + abstandJetzt) - y),
      // Mit Abstand: der gewohnte runde Ausschnitt. Buendig (luft 0 oder
      // weniger): genau die Rundung des Elements, sonst stuenden Ecken ab.
      ecke: abstandJetzt > 0 ? ECKE : Math.max(0, (q.ecke || 0) + Math.min(0, abstandJetzt)),
    };
  });
  // Kein CSS-Uebergang: die Bewegung des Ausschnitts wird oben pro Bild
  // berechnet, damit er beim Scrollen exakt auf dem Element sitzt.
  const weich = { transition: 'none' };
  // Klicks ausserhalb der Ausschnitte abfangen: eine Flaeche ueber alles, aus
  // der die Loecher per clip-path (Fuellregel evenodd) ausgestanzt sind. Das
  // traegt beliebig viele Ausschnitte, anders als vier feste Randstreifen.
  const stanze = `path(evenodd, "M0 0H${vw}V${vh}H0Z ${loecher
    .map((q) => `M${q.x} ${q.y}H${q.x + q.b}V${q.y + q.h}H${q.x}Z`)
    .join(' ')}")`;

  return createPortal(
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 9000, pointerEvents: 'none' }}>
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, opacity: aktiv ? 1 : 0, transition: 'opacity 320ms ease' }}
      >
        <defs>
          <mask id="trisar-tutorial-maske" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            {loecher.map((q, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <rect key={i} x={q.x} y={q.y} width={q.b} height={q.h} rx={q.ecke} fill="#000" style={weich} />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill={ABDUNKLUNG} mask="url(#trisar-tutorial-maske)" />
      </svg>
      {/* Klicks ausserhalb der Ausschnitte abfangen; hinein darf man tippen. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: aktiv ? 'auto' : 'none',
          clipPath: stanze,
          WebkitClipPath: stanze,
        }}
      />
      {cursorEl}
    </div>,
    document.body,
  );
};

export default TutorialBridge;
