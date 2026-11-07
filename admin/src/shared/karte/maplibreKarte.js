// Kartenschicht der Demo: MapLibre GL mit dem dunklen Carto-Basiskartenstil,
// genau dem, den mapcn (github.com/SoftCodefr/mapcn-vue) als Dunkelstil setzt.
// mapcn selbst ist fuer Vue geschrieben, die Demo laeuft auf React. Uebernommen
// ist deshalb der Unterbau: MapLibre GL, Carto-Basiskarte, keine Weltkopien,
// eingeklappter Quellenhinweis.
//
// Die Fahrtansichten sprechen die Karte weiterhin ueber die Aufrufe an, die sie
// von Google Maps her kannten (Marker, Polyline, OverlayView, DirectionsService
// und so weiter). Diese Datei bildet genau die Teile davon nach, die in der Demo
// vorkommen. So bleibt der Umstieg auf eine Datei beschraenkt, statt in jeder
// der acht Kartenstellen einzeln zu stecken. Angesprochen wird sie ueber
// window.trisarKarte.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre laedt seinen Arbeiter zur Laufzeit ueber einen Pfad relativ zum
// eigenen Modul. Nach dem Buendeln gibt es den nicht mehr, die Karte bliebe
// schwarz. Also die gebaute Datei mitliefern und den Pfad selbst setzen.
import arbeiterAdresse from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import orteDerDemo from '../../demo/data/orte.json';

// Dauer einer Kamerafahrt. Lang genug, dass man ihr folgen kann.
const KAMERA_FAHRT_MS = 750;

maplibregl.setWorkerUrl(arbeiterAdresse);

export const KARTEN_STIL_DUNKEL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// Grundflaeche des dunklen Carto-Stils (Ebene "background").
const KARTEN_GRUND = '#0e0e0e';

// Muenchen, falls eine Ansicht ohne Mittelpunkt startet.
const MITTE_VORGABE = { lat: 48.1374, lng: 11.5755 };

let laufendeNummer = 0;
const naechsteNummer = () => { laufendeNummer += 1; return laufendeNummer; };

const zahl = (wert) => {
  const geparst = Number(wert);
  return Number.isFinite(geparst) ? geparst : null;
};

// Nimmt alles an, was in den Ansichten als Position herumgereicht wird:
// LatLng-Objekt, {lat, lng} mit Zahlen oder Funktionen, [lng, lat].
export const zuLngLat = (wert) => {
  if (!wert) return null;
  if (typeof wert.lat === 'function' && typeof wert.lng === 'function') {
    const lat = zahl(wert.lat());
    const lng = zahl(wert.lng());
    return lat === null || lng === null ? null : { lat, lng };
  }
  if (Array.isArray(wert)) {
    const lng = zahl(wert[0]);
    const lat = zahl(wert[1]);
    return lat === null || lng === null ? null : { lat, lng };
  }
  const lat = zahl(wert.lat);
  const lng = zahl(wert.lng ?? wert.lon ?? wert.lngs);
  return lat === null || lng === null ? null : { lat, lng };
};


// Weltbreite in Pixeln bei Zoom 0 (MapLibre-Kachelgroesse).
const WELT_PX = 512;
class LatLng {
  constructor(lat, lng) {
    const gelesen = typeof lat === 'object' && lat !== null ? zuLngLat(lat) : { lat: zahl(lat), lng: zahl(lng) };
    this._lat = gelesen?.lat ?? NaN;
    this._lng = gelesen?.lng ?? NaN;
  }

  lat() { return this._lat; }

  lng() { return this._lng; }

  toJSON() { return { lat: this._lat, lng: this._lng }; }

  equals(anderer) {
    const gegen = zuLngLat(anderer);
    return Boolean(gegen) && gegen.lat === this._lat && gegen.lng === this._lng;
  }
}

class LatLngBounds {
  constructor() {
    this.punkte = [];
  }

  extend(position) {
    const punkt = zuLngLat(position);
    if (punkt) this.punkte.push(punkt);
    return this;
  }

  isEmpty() { return this.punkte.length === 0; }

  getCenter() {
    if (this.isEmpty()) return new LatLng(MITTE_VORGABE.lat, MITTE_VORGABE.lng);
    const summe = this.punkte.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    return new LatLng(summe.lat / this.punkte.length, summe.lng / this.punkte.length);
  }

  // Fuer MapLibre: Suedwest- und Nordostecke.
  alsEcken() {
    if (this.isEmpty()) return null;
    let west = this.punkte[0].lng;
    let ost = this.punkte[0].lng;
    let sued = this.punkte[0].lat;
    let nord = this.punkte[0].lat;
    this.punkte.forEach((p) => {
      west = Math.min(west, p.lng);
      ost = Math.max(ost, p.lng);
      sued = Math.min(sued, p.lat);
      nord = Math.max(nord, p.lat);
    });
    return [[west, sued], [ost, nord]];
  }
}

class Size {
  constructor(breite, hoehe) {
    this.width = Number(breite);
    this.height = Number(hoehe);
  }
}

class Point {
  constructor(x, y) {
    this.x = Number(x);
    this.y = Number(y);
  }
}

const SymbolPath = { CIRCLE: 'kreis', FORWARD_CLOSED_ARROW: 'pfeil', FORWARD_OPEN_ARROW: 'pfeil-offen' };
const TravelMode = { DRIVING: 'DRIVING', WALKING: 'WALKING' };

// --- Karte --------------------------------------------------------------

class Karte {
  constructor(element, optionen = {}) {
    const mitte = zuLngLat(optionen.center) || MITTE_VORGABE;
    this.geladen = false;
    this.wartende = [];
    this.ueberlagerungen = new Set();
    this.linien = new Map(); // Ebenen-Kennung -> Hoehe (frueher zIndex)

    // MapLibre setzt seiner Wurzel die Klasse maplibregl-map mit
    // position: relative. Auf einem Feld, das die App per absolute inset-0
    // aufspannt, hebt das die Positionierung auf und die Karte waechst auf die
    // Hoehe ihres Inhalts. Deshalb bekommt MapLibre ein eigenes Feld darin.
    this.feld = document.createElement('div');
    // isolation trennt die Karte von der Umgebung: Marker und Zeitblasen
    // tragen Hoehen bis 400, ohne diese Trennung legen sie sich ueber das
    // Infoblatt und ueber Blaetter wie die Notiz, die darueber liegen.
    Object.assign(this.feld.style, { position: 'absolute', inset: '0', isolation: 'isolate' });
    element.appendChild(this.feld);

    this.karte = new maplibregl.Map({
      container: this.feld,
      style: optionen.style || KARTEN_STIL_DUNKEL,
      center: [mitte.lng, mitte.lat],
      zoom: zahl(optionen.zoom) ?? 12,
      attributionControl: { compact: true },
      renderWorldCopies: false,
      // Die Ansichten haben Googles Bedienelemente abgeschaltet, MapLibre
      // bekommt hier von vornherein keine.
    });

    // Eigene Ebene fuer die Aufsaetze (Zeitblasen, Flugzeug). Sie liegt ueber
    // den Markern, deren Hoehen aus der Google-Zeit bis 330 reichen.
    this.paneWurzel = document.createElement('div');
    Object.assign(this.paneWurzel.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '400', overflow: 'hidden',
    });
    const overlayLayer = document.createElement('div');
    const floatPane = document.createElement('div');
    [overlayLayer, floatPane].forEach((pane) => {
      Object.assign(pane.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      this.paneWurzel.appendChild(pane);
    });
    this.panes = { overlayLayer, floatPane, mapPane: overlayLayer, markerLayer: overlayLayer, overlayMouseTarget: floatPane };
    this.karte.getContainer().appendChild(this.paneWurzel);

    this.karte.on('load', () => {
      this.geladen = true;
      this.geladenUm = Date.now();
      this.wartende.splice(0).forEach((aufgabe) => aufgabe());
      // Wird die Karte angelegt, waehrend ihr Feld noch nicht fertig im Bild
      // steht, rechnet MapLibre mit den falschen Pixeln und malt daneben. Nach
      // dem Laden noch ein paar Mal nachmessen raeumt das auf.
      [0, 120, 400, 1000].forEach((verzug) => window.setTimeout(() => this.nachmessen(), verzug));
    });

    // Stand die Karte beim Anlegen noch ohne Groesse da (das Blatt der
    // Dispo-Ansicht wird erst danach vermessen), rechnet MapLibre mit falschen
    // Pixeln und die Marker landen weit unter dem Bild. Also mitmessen.
    if (typeof ResizeObserver !== 'undefined') {
      this.beobachter = new ResizeObserver(() => { if (this.geladen) this.nachmessen(); });
      this.beobachter.observe(this.karte.getContainer());
    }
    // Wird die Karte angelegt, waehrend ihr Feld noch nicht fertig im Bild
    // steht, rechnet MapLibre einmal mit den falschen Pixeln und malt daneben.
    // Ein Nachmessen in den ersten Momenten raeumt das auf.

    // Aufsaetze haengen an Pixelpositionen, also bei jedem Bild neu setzen.
    this.karte.on('render', () => this.ueberlagerungen.forEach((auf) => auf.draw?.()));
    this.karte.on('error', (fehler) => console.warn('[Karte] MapLibre meldet', fehler?.error?.message || fehler));
    // Griff zum Nachschauen im Browser, etwa beim Pruefen der Demo.
    if (typeof window !== 'undefined') {
      window.__trisarKarten = window.__trisarKarten || [];
      window.__trisarKarten.push(this);
    }
  }

  // Neu vermessen und die Kamera einmal bestaetigen. Der Sprung auf die
  // eigene Stelle sieht man nicht, er setzt aber alle Marker neu, die noch mit
  // den alten Pixeln gesetzt worden sind.
  nachmessen() {
    try {
      this.karte.resize();
      this.karte.jumpTo({
        center: this.karte.getCenter(),
        zoom: this.karte.getZoom(),
        bearing: this.karte.getBearing(),
        pitch: this.karte.getPitch(),
      });
    } catch (fehler) { /* Karte ist schon abgebaut */ }
  }

  // Ebenen und Quellen darf MapLibre erst nach dem Stil annehmen.
  bereit(aufgabe) {
    if (this.geladen) aufgabe();
    else this.wartende.push(aufgabe);
  }

  fitBounds(bounds, rand, optionen = {}) {
    const ecken = bounds?.alsEcken?.();
    if (!ecken) return;
    const abstand = typeof rand === 'number'
      ? rand
      : (rand && typeof rand === 'object'
        ? { top: zahl(rand.top) ?? 0, bottom: zahl(rand.bottom) ?? 0, left: zahl(rand.left) ?? 0, right: zahl(rand.right) ?? 0 }
        : 48);
    // Der Ausschnitt beim Oeffnen steht sofort. Alles danach, etwa ein
    // gewaehlter Fahrer oder das hochgezogene Infoblatt, faehrt weich hin.
    const gleichNachDemLaden = !this.geladen || Date.now() - (this.geladenUm || 0) < 900;
    const dauer = this.ersterAusschnitt === false && !gleichNachDemLaden ? KAMERA_FAHRT_MS : 0;
    this.ersterAusschnitt = false;
    const maxZoom = zahl(optionen?.maxZoom) ?? 15.5;
    this.karte.fitBounds(ecken, { padding: abstand, duration: dauer, maxZoom, essential: true });
  }

  // Weich auf eine Zoomstufe fahren.
  zoomTo(stufe) {
    const wert = zahl(stufe);
    if (wert !== null) this.karte.easeTo({ zoom: wert, duration: KAMERA_FAHRT_MS, essential: true });
  }

  setCenter(position) {
    const punkt = zuLngLat(position);
    if (punkt) this.karte.setCenter([punkt.lng, punkt.lat]);
  }

  panTo(position) {
    const punkt = zuLngLat(position);
    if (punkt) this.karte.panTo([punkt.lng, punkt.lat]);
  }

  setZoom(stufe) {
    const wert = zahl(stufe);
    if (wert !== null) this.karte.setZoom(wert);
  }

  getZoom() { return this.karte.getZoom(); }

  getCenter() {
    const mitte = this.karte.getCenter();
    return new LatLng(mitte.lat, mitte.lng);
  }

  getDiv() { return this.karte.getContainer(); }

  // Weltkoordinaten nach Web-Mercator. Die Dispo-Karte multipliziert sie mit
  // 2^zoom und rechnet so aus, welche Fahrer sich auf dem Bildschirm
  // ueberdecken und zu einer Gruppe werden. MapLibre legt der Welt bei
  // Zoom 0 512 px zugrunde (Google: 256 px) — mit 256 waeren alle Abstaende
  // nur halb so gross wie auf dem Bildschirm und die Fahrer wuerden schon
  // zusammengezogen, solange noch eine Pinbreite Platz zwischen ihnen ist.
  getProjection() {
    return {
      fromLatLngToPoint: (position) => {
        const punkt = zuLngLat(position);
        if (!punkt) return null;
        const sinus = Math.min(Math.max(Math.sin((punkt.lat * Math.PI) / 180), -0.9999), 0.9999);
        return {
          x: ((punkt.lng + 180) / 360) * WELT_PX,
          y: (0.5 - Math.log((1 + sinus) / (1 - sinus)) / (4 * Math.PI)) * WELT_PX,
        };
      },
    };
  }

  // Sichtbarer Ausschnitt, mit contains() wie bei Google.
  getBounds() {
    const grenzen = this.karte.getBounds();
    return {
      contains: (position) => {
        const punkt = zuLngLat(position);
        return Boolean(punkt) && grenzen.contains([punkt.lng, punkt.lat]);
      },
    };
  }

  // Breite des sichtbaren Ausschnitts in Metern, gemessen auf der Kartenmitte.
  getBreiteMeter() {
    const mitte = this.karte.getCenter();
    const meterJePixel = (156543.03392 * Math.cos((mitte.lat * Math.PI) / 180)) / 2 ** this.karte.getZoom();
    return this.karte.getContainer().clientWidth * meterJePixel;
  }

  addListener(ereignis, rueckmeldung) {
    const uebersetzt = { idle: 'idle', click: 'click', dragend: 'dragend', zoom_changed: 'zoom', bounds_changed: 'moveend' }[ereignis] || ereignis;
    const behandler = (e) => {
      // domEvent wie bei Google: daran erkennt die Ansicht, ob ein Pin oder
      // die leere Karte getroffen wurde.
      if (uebersetzt === 'click' && e?.lngLat) rueckmeldung({ latLng: new LatLng(e.lngLat.lat, e.lngLat.lng), domEvent: e.originalEvent });
      else rueckmeldung(e);
    };
    this.karte.on(uebersetzt, behandler);
    return { remove: () => this.karte.off(uebersetzt, behandler) };
  }

  ueberlagerungAnmelden(auf) { this.ueberlagerungen.add(auf); }

  ueberlagerungAbmelden(auf) { this.ueberlagerungen.delete(auf); }

  // Linien liegen in MapLibre in Reihenfolge ihres Einbaus. Die Ansichten
  // geben stattdessen Hoehen an, also nach jedem Einbau neu sortieren.
  linienSortieren() {
    [...this.linien.entries()]
      .sort((a, b) => a[1] - b[1])
      .forEach(([kennung]) => {
        if (this.karte.getLayer(kennung)) this.karte.moveLayer(kennung);
      });
  }

  abbauen() {
    this.ueberlagerungen.clear();
    this.beobachter?.disconnect();
    this.karte.remove();
  }
}

// --- Marker -------------------------------------------------------------

const markerElementBauen = (icon) => {
  const huelle = document.createElement('div');
  huelle.style.pointerEvents = 'none';
  huelle.style.willChange = 'transform';

  if (icon?.url) {
    // ausschnitt: nur der obere Teil des Bildes wird gezeigt (etwa der Kreis
    // eines Pins ohne seine Spitze). Die Masse beziehen sich dann auf ihn.
    const bildBreite = zahl(icon.scaledSize?.width) ?? 30;
    const bildHoehe = zahl(icon.scaledSize?.height) ?? 30;
    const breite = zahl(icon.ausschnitt?.width) ?? bildBreite;
    const hoehe = zahl(icon.ausschnitt?.height) ?? bildHoehe;
    huelle.style.width = `${breite}px`;
    huelle.style.height = `${hoehe}px`;
    if (icon.ausschnitt) huelle.style.overflow = 'hidden';
    const bild = document.createElement('img');
    bild.src = icon.url;
    bild.alt = '';
    Object.assign(bild.style, icon.ausschnitt
      ? { width: `${bildBreite}px`, height: `${bildHoehe}px`, display: 'block', maxWidth: 'none' }
      : { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
    huelle.appendChild(bild);
    // Google verankert das Bild an einem Punkt darin, MapLibre an seiner Mitte.
    const ankerX = zahl(icon.anchor?.x);
    const ankerY = zahl(icon.anchor?.y);
    const versatz = ankerX === null || ankerY === null ? [0, 0] : [breite / 2 - ankerX, hoehe / 2 - ankerY];
    // Gedreht wird um den Ankerpunkt, damit er auf der Karte stehen bleibt.
    huelle.style.transformOrigin = `${ankerX ?? breite / 2}px ${ankerY ?? hoehe / 2}px`;
    if (zahl(icon.rotation) !== null) huelle.style.transform = `rotate(${zahl(icon.rotation)}deg)`;
    return { huelle, versatz };
  }

  if (icon?.path === SymbolPath.FORWARD_CLOSED_ARROW || icon?.path === SymbolPath.FORWARD_OPEN_ARROW) {
    const groesse = (zahl(icon.scale) ?? 6) * 2;
    huelle.style.width = `${groesse}px`;
    huelle.style.height = `${groesse}px`;
    huelle.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block"><path d="M12 2 21 21 12 16 3 21Z" fill="${icon.fillColor || '#f55757'}" fill-opacity="${icon.fillOpacity ?? 1}" stroke="${icon.strokeColor || '#ffffff'}" stroke-width="${zahl(icon.strokeWeight) ?? 1}"/></svg>`;
    huelle.style.transform = `rotate(${zahl(icon.rotation) ?? 0}deg)`;
    return { huelle, versatz: [0, 0] };
  }

  if (icon?.path === SymbolPath.CIRCLE) {
    const radius = zahl(icon.scale) ?? 6;
    const rand = zahl(icon.strokeWeight) ?? 0;
    Object.assign(huelle.style, {
      width: `${radius * 2}px`,
      height: `${radius * 2}px`,
      borderRadius: '9999px',
      background: icon.fillColor || '#e3f754',
      opacity: String(icon.fillOpacity ?? 1),
      border: rand ? `${rand}px solid ${icon.strokeColor || '#000'}` : 'none',
      boxSizing: 'content-box',
    });
    return { huelle, versatz: [0, 0] };
  }

  Object.assign(huelle.style, { width: '12px', height: '12px', borderRadius: '9999px', background: '#e3f754' });
  return { huelle, versatz: [0, 0] };
};

class Marker {
  constructor(optionen = {}) {
    this.optionen = { ...optionen };
    this.element = document.createElement('div');
    this.element.style.pointerEvents = 'none';
    this.marker = new maplibregl.Marker({ element: this.element, anchor: 'center', offset: [0, 0] });
    this.zeichnen();
    const punkt = zuLngLat(optionen.position);
    if (punkt) this.marker.setLngLat([punkt.lng, punkt.lat]);
    this.karte = null;
    if (optionen.map) this.setMap(optionen.map);
  }

  // Bild und Beschriftung stecken in einem Element, damit beides zusammen
  // sitzt. Bei jeder Aenderung wird es neu aufgebaut.
  zeichnen() {
    const { huelle, versatz } = markerElementBauen(this.optionen.icon);
    // Bild und Beschriftung kommen in ein eigenes Feld. Das aeussere Element
    // gehoert MapLibre: es traegt die Klasse maplibregl-marker und wird von
    // dort positioniert. Wuerde man ihm hier position oder transform setzen,
    // stuende der Marker nicht mehr auf der Karte, sondern im Textfluss.
    huelle.style.position = 'relative';
    this.element.replaceChildren(huelle);
    this.innen = huelle;
    this.element.style.pointerEvents = this.horcher ? 'auto' : 'none';
    if (this.optionen.zIndex !== undefined) this.element.style.zIndex = String(this.optionen.zIndex);
    // Deckkraft ueber MapLibre setzen: der Marker schreibt sie bei jedem
    // Neuzeichnen selbst ins Element und wuerde einen eigenen Wert ueberdecken.
    if (this.optionen.opacity !== undefined) this.marker?.setOpacity(String(this.optionen.opacity));
    if (this.optionen.title) this.element.title = String(this.optionen.title);

    const beschriftung = this.optionen.label;
    if (beschriftung && beschriftung.text) {
      const feld = document.createElement('span');
      const ursprung = this.optionen.icon?.labelOrigin;
      const breite = zahl(this.optionen.icon?.scaledSize?.width);
      const hoehe = zahl(this.optionen.icon?.scaledSize?.height);
      Object.assign(feld.style, {
        position: 'absolute',
        left: `${zahl(ursprung?.x) ?? (breite ? breite / 2 : 0)}px`,
        top: `${zahl(ursprung?.y) ?? (hoehe ? hoehe / 2 : 0)}px`,
        transform: 'translate(-50%, -50%)',
        color: beschriftung.color || '#000',
        fontSize: beschriftung.fontSize || '13px',
        fontWeight: beschriftung.fontWeight || '700',
        fontFamily: 'Space Grotesk, sans-serif',
        lineHeight: '1',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      });
      feld.textContent = String(beschriftung.text);
      huelle.appendChild(feld);
    }
    this.abblendenAnwenden(huelle);
    this.marker.setOffset(versatz);
  }

  // Abgeblendete Zeichen sollen blass wirken, ohne dass die Karte durch sie
  // hindurchscheint. Deshalb liegt unter dem blassen Bild eine deckende Flaeche
  // in der Grundfarbe der Karte, genau in der Form des Zeichens.
  abblendenAnwenden(huelle) {
    const wert = zahl(this.optionen.abblenden);
    const bild = huelle.querySelector('img');
    if (wert === null || wert >= 1 || !bild || !this.optionen.icon?.url) return;
    const maske = `url("${this.optionen.icon.url}")`;
    const unterlage = document.createElement('div');
    Object.assign(unterlage.style, {
      position: 'absolute',
      inset: '0',
      background: this.optionen.abblendenGrund || KARTEN_GRUND,
      maskImage: maske,
      WebkitMaskImage: maske,
      maskSize: '100% 100%',
      WebkitMaskSize: '100% 100%',
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      pointerEvents: 'none',
    });
    // Bild und Nummer werden gemeinsam blass, genau wie vorher das ganze
    // Zeichen. Einzeln abgeblendet verschwaende die Nummer fast ganz.
    const gruppe = document.createElement('div');
    Object.assign(gruppe.style, { position: 'absolute', inset: '0', opacity: String(wert), pointerEvents: 'none' });
    [...huelle.childNodes].forEach((kind) => gruppe.appendChild(kind));
    huelle.appendChild(unterlage);
    huelle.appendChild(gruppe);
  }

  setAbblenden(wert) {
    const neu = zahl(wert) ?? 1;
    if (zahl(this.optionen.abblenden) === neu) return;
    this.optionen.abblenden = neu;
    this.zeichnen();
  }

  setPosition(position) {
    const punkt = zuLngLat(position);
    if (!punkt) return;
    this.marker.setLngLat([punkt.lng, punkt.lat]);
    // Wartete der Marker mangels Position auf seine Karte: jetzt einhaengen.
    if (this.karte && !this.eingehaengt) this.einhaengen();
  }

  getPosition() {
    const stelle = this.marker.getLngLat();
    return new LatLng(stelle.lat, stelle.lng);
  }

  setIcon(icon) {
    this.optionen.icon = icon;
    this.zeichnen();
  }

  setLabel(label) {
    this.optionen.label = label;
    this.zeichnen();
  }

  // Nur die Drehung aendern, ohne das Element neu aufzubauen: die Fahrtrichtung
  // wird mehrmals je Sekunde nachgefuehrt.
  setRotation(grad) {
    const wert = zahl(grad);
    if (wert === null) return;
    if (this.optionen.icon) this.optionen.icon.rotation = wert;
    if (this.innen) this.innen.style.transform = `rotate(${wert}deg)`;
  }

  setTitle(titel) {
    this.optionen.title = titel;
    this.element.title = String(titel || '');
  }

  setOpacity(deckung) {
    this.optionen.opacity = deckung;
    this.marker.setOpacity(String(deckung));
  }

  setZIndex(hoehe) {
    this.optionen.zIndex = hoehe;
    this.element.style.zIndex = String(hoehe);
  }

  setVisible(sichtbar) {
    this.element.style.display = sichtbar === false ? 'none' : '';
  }

  addListener(ereignis, rueckmeldung) {
    this.horcher = true;
    this.element.style.pointerEvents = 'auto';
    this.element.addEventListener(ereignis, rueckmeldung);
    return { remove: () => this.element.removeEventListener(ereignis, rueckmeldung) };
  }

  // MapLibre bricht ab, wenn ein Marker ohne Position auf die Karte kommt
  // (Google Maps hat das hingenommen). Ohne Position wartet er deshalb, bis
  // setPosition ihm eine gibt — sonst stuerzte z. B. die Fahrt-Simulation ab.
  einhaengen() {
    if (!this.karte || !this.marker.getLngLat()) return;
    this.marker.addTo(this.karte.karte);
    this.eingehaengt = true;
    // Erst mit Karte nimmt MapLibre die Deckkraft wirklich an.
    if (this.optionen.opacity !== undefined) this.marker.setOpacity(String(this.optionen.opacity));
  }

  setMap(karte) {
    if (karte) {
      // Schon auf dieser Karte: nicht neu einhaengen, sonst flackert das Bild
      // bei jedem Neubilden der Gruppen.
      if (this.karte === karte && this.eingehaengt) return;
      this.karte = karte;
      this.einhaengen();
    } else {
      this.marker.remove();
      this.karte = null;
      this.eingehaengt = false;
    }
  }
}

// --- Linien -------------------------------------------------------------

const pfadZuKoordinaten = (pfad) => (Array.isArray(pfad) ? pfad : [])
  .map((punkt) => zuLngLat(punkt))
  .filter(Boolean)
  .map((punkt) => [punkt.lng, punkt.lat]);

class Polyline {
  constructor(optionen = {}) {
    this.optionen = optionen;
    this.kennung = `trisar-linie-${naechsteNummer()}`;
    this.koordinaten = pfadZuKoordinaten(optionen.path);
    this.karte = null;
    if (optionen.map) this.setMap(optionen.map);
  }

  // Google zeichnet Striche ueber wiederholte Symbole auf einer unsichtbaren
  // Linie. In MapLibre ist das ein Strichmuster auf der Linie selbst.
  linienBild() {
    const gestrichelt = Array.isArray(this.optionen.icons) && this.optionen.icons.length > 0;
    const symbol = gestrichelt ? this.optionen.icons[0]?.icon : null;
    const farbe = (gestrichelt ? symbol?.strokeColor : null) || this.optionen.strokeColor || '#0059FF';
    const breite = zahl(this.optionen.strokeWeight) ?? 5;
    // linienDeckkraft gilt fuer volle und gestrichelte Linien gleichermassen,
    // etwa fuer den schon gefahrenen Teil einer Route.
    const deckung = zahl(this.optionen.linienDeckkraft) ?? (gestrichelt ? 1 : (zahl(this.optionen.strokeOpacity) ?? 1));
    const bild = {
      'line-color': farbe,
      'line-width': breite,
      'line-opacity': deckung,
    };
    if (gestrichelt) bild['line-dasharray'] = [0.8, 1.6];
    return bild;
  }

  // Eine Linie mit weniger als zwei Punkten ist leer, aber schon eingebaut:
  // so kann sie spaeter per setPath wachsen (gefahrener Teil einer Route).
  geoDaten() {
    return this.koordinaten.length < 2
      ? { type: 'FeatureCollection', features: [] }
      : { type: 'Feature', geometry: { type: 'LineString', coordinates: this.koordinaten }, properties: {} };
  }

  einbauen() {
    const karte = this.karte?.karte;
    if (!karte) return;
    if (!karte.getSource(this.kennung)) {
      karte.addSource(this.kennung, { type: 'geojson', data: this.geoDaten() });
    }
    if (!karte.getLayer(this.kennung)) {
      karte.addLayer({
        id: this.kennung,
        type: 'line',
        source: this.kennung,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: this.linienBild(),
      });
    }
    this.karte.linien.set(this.kennung, zahl(this.optionen.zIndex) ?? 0);
    this.karte.linienSortieren();
  }

  getPath() {
    return this.koordinaten.map(([lng, lat]) => new LatLng(lat, lng));
  }

  setPath(pfad) {
    this.koordinaten = pfadZuKoordinaten(pfad);
    const karte = this.karte?.karte;
    const quelle = karte?.getSource(this.kennung);
    if (quelle) {
      quelle.setData(this.geoDaten());
    } else if (this.karte) {
      this.karte.bereit(() => this.einbauen());
    }
  }

  setMap(karte) {
    if (karte) {
      this.karte = karte;
      karte.bereit(() => this.einbauen());
      return;
    }
    const alt = this.karte?.karte;
    if (alt) {
      if (alt.getLayer(this.kennung)) alt.removeLayer(this.kennung);
      if (alt.getSource(this.kennung)) alt.removeSource(this.kennung);
      this.karte.linien.delete(this.kennung);
    }
    this.karte = null;
  }
}

// --- Aufsaetze ----------------------------------------------------------

class OverlayView {
  constructor() {
    this.karte = null;
    this.eingebaut = false;
  }

  getPanes() { return this.karte?.panes || null; }

  getProjection() {
    const karte = this.karte;
    return {
      // Unsere Pane-Wurzel liegt deckungsgleich auf dem Kartenfeld, damit
      // stimmen Container-Pixel und Pane-Pixel ueberein.
      fromLatLngToDivPixel: (position) => {
        const punkt = zuLngLat(position);
        if (!punkt || !karte) return null;
        const pixel = karte.karte.project([punkt.lng, punkt.lat]);
        return { x: pixel.x, y: pixel.y };
      },
      fromLatLngToContainerPixel: (position) => {
        const punkt = zuLngLat(position);
        if (!punkt || !karte) return null;
        const pixel = karte.karte.project([punkt.lng, punkt.lat]);
        return { x: pixel.x, y: pixel.y };
      },
    };
  }

  setMap(karte) {
    if (karte) {
      this.karte = karte;
      karte.ueberlagerungAnmelden(this);
      if (!this.eingebaut) {
        this.eingebaut = true;
        this.onAdd?.();
      }
      this.draw?.();
      return;
    }
    this.karte?.ueberlagerungAbmelden(this);
    if (this.eingebaut) {
      this.eingebaut = false;
      this.onRemove?.();
    }
    this.karte = null;
  }
}

// --- Routen -------------------------------------------------------------

// Oeffentlicher OSRM-Dienst. Antworten werden im Speicher behalten, damit das
// Hin und Her zwischen den Ansichten nicht jedes Mal neu anfragt.
const OSRM_BASIS = 'https://router.project-osrm.org/route/v1/driving/';
const routenSpeicher = new Map();
// Strecken bleiben ueber das Neuladen hinaus im Browser, damit die Demo nicht
// bei jedem Aufruf dieselben Wege erneut beim oeffentlichen Dienst anfragt.
// Gespeichert werden sie ausgeduennt (Punkte unter 4 m Abweichung fallen weg).
const ROUTEN_SCHLUESSEL = 'trisar-routen-v1';
const ROUTEN_HOECHSTENS = 250;
let routenGemerkt = {};
try { routenGemerkt = JSON.parse(localStorage.getItem(ROUTEN_SCHLUESSEL) || '{}') || {}; } catch (fehler) { routenGemerkt = {}; }

const ausduennen = (koordinaten, toleranzMeter = 4) => {
  if (koordinaten.length <= 2) return koordinaten;
  const meterX = 111320 * Math.cos((koordinaten[0][1] * Math.PI) / 180);
  const meterY = 110540;
  const abstand = (p, a, b) => {
    const [px, py] = [(p[0] - a[0]) * meterX, (p[1] - a[1]) * meterY];
    const [bx, by] = [(b[0] - a[0]) * meterX, (b[1] - a[1]) * meterY];
    const laenge = bx * bx + by * by || 1;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / laenge));
    return Math.hypot(px - t * bx, py - t * by);
  };
  const behalten = new Array(koordinaten.length).fill(false);
  behalten[0] = true;
  behalten[koordinaten.length - 1] = true;
  const stapel = [[0, koordinaten.length - 1]];
  while (stapel.length) {
    const [anfang, ende] = stapel.pop();
    let weitester = -1;
    let groesste = 0;
    for (let i = anfang + 1; i < ende; i += 1) {
      const d = abstand(koordinaten[i], koordinaten[anfang], koordinaten[ende]);
      if (d > groesste) { groesste = d; weitester = i; }
    }
    if (weitester > 0 && groesste > toleranzMeter) {
      behalten[weitester] = true;
      stapel.push([anfang, weitester], [weitester, ende]);
    }
  }
  return koordinaten.filter((_, i) => behalten[i]).map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
};

const routeMerken = (adresse, koordinaten, sekunden, meter) => {
  routenGemerkt[adresse] = { k: ausduennen(koordinaten), s: sekunden, m: meter, z: Date.now() };
  const schluessel = Object.keys(routenGemerkt);
  if (schluessel.length > ROUTEN_HOECHSTENS) {
    schluessel.sort((a, b) => routenGemerkt[a].z - routenGemerkt[b].z)
      .slice(0, schluessel.length - ROUTEN_HOECHSTENS)
      .forEach((alt) => delete routenGemerkt[alt]);
  }
  try { localStorage.setItem(ROUTEN_SCHLUESSEL, JSON.stringify(routenGemerkt)); } catch (fehler) { /* Speicher voll */ }
};

const ERDRADIUS_M = 6371000;
const luftlinieMeter = (von, bis) => {
  const zuBogen = (grad) => (grad * Math.PI) / 180;
  const dLat = zuBogen(bis.lat - von.lat);
  const dLng = zuBogen(bis.lng - von.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(zuBogen(von.lat)) * Math.cos(zuBogen(bis.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * ERDRADIUS_M * Math.asin(Math.sqrt(a));
};

const dauerText = (sekunden) => {
  const minuten = Math.max(1, Math.round(sekunden / 60));
  if (minuten < 60) return `${minuten} Min.`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest ? `${stunden} Std. ${rest} Min.` : `${stunden} Std.`;
};

const ergebnisBauen = (koordinaten, sekunden, meter, von, bis) => {
  const pfad = koordinaten.map(([lng, lat]) => new LatLng(lat, lng));
  const grenzen = new LatLngBounds();
  pfad.forEach((punkt) => grenzen.extend(punkt));
  return {
    routes: [{
      overview_path: pfad,
      bounds: grenzen,
      legs: [{
        duration: { value: sekunden, text: dauerText(sekunden) },
        distance: { value: meter, text: `${(meter / 1000).toFixed(1)} km` },
        start_location: new LatLng(von.lat, von.lng),
        end_location: new LatLng(bis.lat, bis.lng),
        steps: [],
      }],
    }],
  };
};

// Faellt der Routendienst aus, bleibt die Karte nicht leer: dann zeigt sie die
// Luftlinie und eine Schaetzung bei 45 km/h Durchschnitt.
const notErgebnis = (von, bis) => {
  const meter = luftlinieMeter(von, bis);
  const ergebnis = ergebnisBauen([[von.lng, von.lat], [bis.lng, bis.lat]], Math.round((meter / 1000) * 80), meter, von, bis);
  // Kennzeichen fuer Aufrufer, die lieber spaeter erneut fragen (Fahrsimulation).
  ergebnis.notloesung = true;
  return ergebnis;
};

// --- Adressen ------------------------------------------------------------

// Die Fahrten der Demo tragen Adressen als Text, Google hat daraus im
// Routendienst selbst Koordinaten gemacht. OSRM kann das nicht, deshalb liegen
// die Orte der Demo als Tabelle bei (einmalig ueber Nominatim bestimmt).
// Alles, was dort fehlt, wird zur Laufzeit bei Nominatim erfragt und im
// Browser gemerkt.
const ortNormalisieren = (text) => String(text || '')
  .trim()
  .toLowerCase()
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ');

const ORTE_TABELLE = new Map(Object.entries(orteDerDemo).map(([text, punkt]) => [ortNormalisieren(text), punkt]));
const ORTE_SPEICHER = new Map();
const ORTE_LAUFEND = new Map();
const ORTE_SCHLUESSEL = 'trisar-orte';

try {
  const gemerkt = JSON.parse(localStorage.getItem(ORTE_SCHLUESSEL) || '{}');
  Object.entries(gemerkt).forEach(([schluessel, punkt]) => ORTE_SPEICHER.set(schluessel, punkt));
} catch (fehler) { /* kein Speicher, dann wird jedes Mal gefragt */ }

const ortMerken = (schluessel, punkt) => {
  ORTE_SPEICHER.set(schluessel, punkt);
  try {
    localStorage.setItem(ORTE_SCHLUESSEL, JSON.stringify(Object.fromEntries(ORTE_SPEICHER)));
  } catch (fehler) { /* Speicher voll oder gesperrt */ }
};

export const adresseAufloesen = (text) => {
  const schluessel = ortNormalisieren(text);
  if (!schluessel) return Promise.resolve(null);
  if (ORTE_TABELLE.has(schluessel)) return Promise.resolve(ORTE_TABELLE.get(schluessel));
  // Die Dispo baut Suchtexte aus Name und Adresse zusammen ("MUC Terminal 2,
  // Flughafen Muenchen ..."). Dann zaehlt der erste Teil, der in der Tabelle
  // steht, ehe jemand Nominatim fragt.
  const teil = schluessel.split(',').map((stueck) => stueck.trim()).find((stueck) => ORTE_TABELLE.has(stueck));
  if (teil) return Promise.resolve(ORTE_TABELLE.get(teil));
  const laengster = [...ORTE_TABELLE.keys()]
    .filter((eintrag) => eintrag.length >= 8 && schluessel.includes(eintrag))
    .sort((a, b) => b.length - a.length)[0];
  if (laengster) return Promise.resolve(ORTE_TABELLE.get(laengster));
  // Die Karte der Disposition fragt "Name, Strasse, PLZ Ort" an — die Tabelle
  // kennt den Ort unter seinem Namen. Ohne diesen Abgleich ging jede Anfrage an
  // Nominatim, und blieb die Antwort aus, wurde gar keine Route gezeichnet.
  const name = ortNormalisieren(String(text).split(',')[0]);
  if (name && name !== schluessel && ORTE_TABELLE.has(name)) return Promise.resolve(ORTE_TABELLE.get(name));
  if (ORTE_SPEICHER.has(schluessel)) return Promise.resolve(ORTE_SPEICHER.get(schluessel));
  if (ORTE_LAUFEND.has(schluessel)) return ORTE_LAUFEND.get(schluessel);

  const adresse = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`;
  const lauf = fetch(adresse, { headers: { Accept: 'application/json' } })
    .then((antwort) => (antwort.ok ? antwort.json() : []))
    .then((treffer) => {
      const erster = Array.isArray(treffer) ? treffer[0] : null;
      const punkt = erster ? { lat: Number(erster.lat), lng: Number(erster.lon) } : null;
      if (punkt) ortMerken(schluessel, punkt);
      return punkt;
    })
    .catch(() => null)
    .finally(() => ORTE_LAUFEND.delete(schluessel));
  ORTE_LAUFEND.set(schluessel, lauf);
  return lauf;
};

// Routenziele kommen als Text oder als Koordinate herein.
const ortBestimmen = (wert) => {
  if (typeof wert === 'string') return adresseAufloesen(wert);
  return Promise.resolve(zuLngLat(wert));
};

// Adresssuche im Zuschnitt von Google, die FahrerApp fragt darueber nach.
class Geocoder {
  geocode(anfrage, rueckmeldung) {
    adresseAufloesen(anfrage?.address).then((punkt) => {
      if (!punkt) {
        rueckmeldung?.([], 'ZERO_RESULTS');
        return;
      }
      rueckmeldung?.([{ geometry: { location: new LatLng(punkt.lat, punkt.lng) } }], 'OK');
    });
  }
}

class DirectionsService {
  route(anfrage, rueckmeldung) {
    const zwischen = (Array.isArray(anfrage?.waypoints) ? anfrage.waypoints : [])
      .map((halt) => ortBestimmen(halt?.location ?? halt));
    Promise.all([ortBestimmen(anfrage?.origin), ortBestimmen(anfrage?.destination), ...zwischen])
      .then(([von, bis, ...ueber]) => this.strecke(von, bis, rueckmeldung, ueber.filter(Boolean)));
  }

  strecke(von, bis, rueckmeldung, ueber = []) {
    if (!von || !bis) {
      rueckmeldung?.(null, 'ZERO_RESULTS');
      return;
    }
    const punkte = [von, ...ueber, bis].map((punkt) => `${punkt.lng},${punkt.lat}`).join(';');
    const adresse = `${OSRM_BASIS}${punkte}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const gespeichert = routenSpeicher.get(adresse);
    if (gespeichert) {
      gespeichert.then((ergebnis) => rueckmeldung?.(ergebnis, 'OK'));
      return;
    }
    const gemerkt = routenGemerkt[adresse];
    if (gemerkt?.k?.length >= 2) {
      const ergebnis = ergebnisBauen(gemerkt.k, gemerkt.s, gemerkt.m, von, bis);
      routenSpeicher.set(adresse, Promise.resolve(ergebnis));
      rueckmeldung?.(ergebnis, 'OK');
      return;
    }
    const anfrageLauf = fetch(adresse)
      .then((antwort) => (antwort.ok ? antwort.json() : Promise.reject(new Error(`OSRM ${antwort.status}`))))
      .then((daten) => {
        const route = daten?.routes?.[0];
        const koordinaten = route?.geometry?.coordinates;
        if (!Array.isArray(koordinaten) || koordinaten.length < 2) return notErgebnis(von, bis);
        routeMerken(adresse, koordinaten, Math.round(route.duration || 0), Math.round(route.distance || 0));
        return ergebnisBauen(koordinaten, Math.round(route.duration || 0), Math.round(route.distance || 0), von, bis);
      })
      .catch(() => notErgebnis(von, bis));
    routenSpeicher.set(adresse, anfrageLauf);
    // Eine Notloesung nicht festhalten: beim naechsten Aufruf neu fragen.
    anfrageLauf.then((ergebnis) => { if (ergebnis?.notloesung) routenSpeicher.delete(adresse); });
    anfrageLauf.then((ergebnis) => rueckmeldung?.(ergebnis, 'OK'));
  }
}

class DirectionsRenderer {
  constructor(optionen = {}) {
    this.optionen = optionen;
    this.karte = optionen.map || null;
    this.linie = null;
  }

  setDirections(ergebnis) {
    const pfad = ergebnis?.routes?.[0]?.overview_path || [];
    if (!pfad.length || !this.karte) return;
    this.linie?.setMap(null);
    this.linie = new Polyline({
      path: pfad,
      strokeColor: this.optionen.polylineOptions?.strokeColor || '#0059FF',
      strokeWeight: this.optionen.polylineOptions?.strokeWeight ?? 6,
      strokeOpacity: this.optionen.polylineOptions?.strokeOpacity ?? 1,
      zIndex: this.optionen.polylineOptions?.zIndex ?? 200,
      map: this.karte,
    });
  }

  setMap(karte) {
    this.karte = karte;
    if (!karte) {
      this.linie?.setMap(null);
      this.linie = null;
    }
  }
}

// Verkehrslage gibt es in der offenen Karte nicht. Die Ansichten duerfen den
// Aufruf behalten, er bewirkt nur nichts mehr.
class TrafficLayer {
  setMap() {}
}

class InfoWindow {
  constructor(optionen = {}) {
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 12 });
    if (optionen.content) this.setContent(optionen.content);
    if (optionen.position) this.setPosition(optionen.position);
  }

  setContent(inhalt) {
    if (typeof inhalt === 'string') this.popup.setHTML(inhalt);
    else if (inhalt) this.popup.setDOMContent(inhalt);
  }

  setPosition(position) {
    const punkt = zuLngLat(position);
    if (punkt) this.popup.setLngLat([punkt.lng, punkt.lat]);
  }

  open(karte, anker) {
    const stelle = anker?.getPosition?.();
    if (stelle) this.setPosition(stelle);
    if (karte?.karte) this.popup.addTo(karte.karte);
  }

  close() { this.popup.remove(); }
}

export const KARTE = {
  Map: Karte,
  Marker,
  Polyline,
  OverlayView,
  LatLng,
  LatLngBounds,
  Size,
  Point,
  DirectionsService,
  DirectionsRenderer,
  TrafficLayer,
  InfoWindow,
  TravelMode,
  SymbolPath,
  Geocoder,
};

// Die Ansichten fragen window.trisarKarte ab, so wie sie frueher window.google
// abgefragt haben. Der Aufruf ist unmittelbar fertig, es wird nichts nachgeladen.
export const karteBereitstellen = () => {
  if (typeof window !== 'undefined' && !window.trisarKarte) window.trisarKarte = KARTE;
  return KARTE;
};

export default KARTE;
