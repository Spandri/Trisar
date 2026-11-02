// Fahrsimulation der Demo: bewegt Fahrer auf echten Strassen ueber die Karte.
//
// Die Dispo-Karte fragt fuer jeden Fahrer nur ab, wo er gerade steht, in welche
// Richtung er faehrt und wie schnell (stand). Genau diese Werte liefert im
// Betrieb das Fahrzeug selbst ueber die OBD-Daten (lat/lng, heading_deg,
// speed_mps in driver_live_locations). Bis dahin rechnet diese Datei sie aus:
//
//   - Aktive Fahrer haben den Gast an Bord und sind mitten in der Fahrt: ihre
//     Strecke fuehrt vom Abholort ueber ihren jetzigen Standort zum Ziel. Das
//     Stueck bis zu ihnen ist schon gefahren, sie selbst stehen beim Oeffnen
//     der Karte genau dort, wo die Daten sie zeigen, und fahren von da weiter.
//   - Inaktive Fahrer fahren von ihrem Standort zum Abholort ihrer naechsten
//     Fahrt und warten dort.
//   - Freie Fahrer stehen.
//
// Jeder Fahrer faehrt in seinem eigenen Tempo. Strecken kommen ueber den
// Routendienst der Karte; schlaegt eine Anfrage fehl, wird spaeter erneut
// gefragt statt quer durch die Stadt zu fahren.

const GLEICHZEITIGE_ANFRAGEN = 2;
const PAUSE_ZWISCHEN_ANFRAGEN_MS = 250;
const ERNEUT_FRAGEN_MS = 20000;

const zuBogen = (grad) => (grad * Math.PI) / 180;

const abstandMeter = (a, b) => {
  const dLat = zuBogen(b.lat - a.lat);
  const dLng = zuBogen(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(zuBogen(a.lat)) * Math.cos(zuBogen(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

// Kompassrichtung von a nach b, 0 = Norden, im Uhrzeigersinn.
const richtungGrad = (a, b) => {
  const y = Math.sin(zuBogen(b.lng - a.lng)) * Math.cos(zuBogen(b.lat));
  const x = Math.cos(zuBogen(a.lat)) * Math.sin(zuBogen(b.lat))
    - Math.sin(zuBogen(a.lat)) * Math.cos(zuBogen(b.lat)) * Math.cos(zuBogen(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

// Fester Zufall je Fahrer, damit das Bild nach jedem Neuladen gleich aussieht.
const zufallAus = (text, salz = 0) => {
  let h = 2166136261 ^ salz;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
};

const strecke = (pfad) => {
  const summen = [0];
  for (let i = 1; i < pfad.length; i += 1) summen.push(summen[i - 1] + abstandMeter(pfad[i - 1], pfad[i]));
  return { pfad, summen, laenge: summen[summen.length - 1] || 0 };
};

const warten = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export class FahrSimulation {
  // wegSuchen(von, bis, ueber) => Promise<[{lat,lng}, ...] | null>
  // ortSuchen(text)            => Promise<{lat,lng} | null>
  constructor({ wegSuchen, ortSuchen = async () => null, beiGeplant = () => {}, jetzt = () => Date.now() }) {
    this.wegSuchen = wegSuchen;
    this.ortSuchen = ortSuchen;
    this.beiGeplant = beiGeplant;
    this.jetzt = jetzt;
    this.fahrer = new Map();
    this.fahrten = new Map();
    this.warteschlange = [];
    this.laufend = 0;
  }

  fahrerSetzen(liste) {
    (liste || []).forEach((fahrer) => {
      const id = String(fahrer?.id || '').trim();
      if (id) this.fahrer.set(id, fahrer);
    });
  }

  faehrtUeberhaupt(fahrer) {
    const zustand = fahrer?.driverState;
    return (zustand === 'aktiv' || zustand === 'inaktiv') && Boolean(fahrer?.activeRide?.from?.query);
  }

  // vorne: gewaehlte oder sichtbare Fahrer ruecken in der Warteschlange nach vorn.
  anfordern(ids, { vorne = false } = {}) {
    (ids || []).forEach((id) => {
      if (this.fahrten.has(id)) return;
      const fahrer = this.fahrer.get(id);
      if (!fahrer || !this.faehrtUeberhaupt(fahrer)) return;
      const stelle = this.warteschlange.indexOf(id);
      if (stelle >= 0) {
        if (!vorne) return;
        this.warteschlange.splice(stelle, 1);
      }
      if (vorne) this.warteschlange.unshift(id);
      else this.warteschlange.push(id);
    });
    this.abarbeiten();
  }

  abarbeiten() {
    while (this.laufend < GLEICHZEITIGE_ANFRAGEN && this.warteschlange.length) {
      const id = this.warteschlange.shift();
      this.laufend += 1;
      this.planen(id)
        .catch(() => {})
        .then(() => warten(PAUSE_ZWISCHEN_ANFRAGEN_MS))
        .finally(() => {
          this.laufend -= 1;
          this.abarbeiten();
        });
    }
  }

  async planen(id) {
    const fahrer = this.fahrer.get(id);
    if (!fahrer || this.fahrten.has(id)) return;
    const start = { lat: Number(fahrer.lat), lng: Number(fahrer.lng) };
    if (!Number.isFinite(start.lat) || !Number.isFinite(start.lng)) return;

    const fahrt = fahrer.activeRide;
    const aktiv = fahrer.driverState === 'aktiv';
    // Aktiv: Abholort -> jetziger Standort -> Ziel. Inaktiv: Standort -> Abholort.
    const pfad = aktiv
      ? await this.wegSuchen(fahrt.from.query, fahrt.to?.query, [start])
      : await this.wegSuchen(start, fahrt.from.query, []);
    if (!Array.isArray(pfad) || pfad.length < 2) {
      // Dienst nicht erreichbar: spaeter noch einmal.
      setTimeout(() => this.anfordern([id]), ERNEUT_FRAGEN_MS);
      return;
    }

    const weg = strecke(pfad);
    // Wo auf der Strecke der Fahrer gerade steht. Von dort geht es weiter,
    // es springt also niemand, wenn seine Strecke eintrifft.
    let hierIndex = 0;
    if (aktiv) {
      let kleinster = Infinity;
      pfad.forEach((punkt, i) => {
        const d = abstandMeter(punkt, start);
        if (d < kleinster) { kleinster = d; hierIndex = i; }
      });
    }
    const schonGefahren = weg.summen[hierIndex];

    // Jeder Fahrer in seinem eigenen Tempo, zwischen 30 und 50 km/h.
    const tempo = 8.5 + zufallAus(id, 3) * 5.5;
    this.fahrten.set(id, {
      ...weg,
      tempo,
      // Aktive haben den Gast schon an Bord, inaktive holen ihn am Ende ab.
      abholMeter: aktiv ? 0 : weg.laenge,
      beginn: this.jetzt() - (schonGefahren / tempo) * 1000,
    });
    this.beiGeplant(id);
  }

  // Wo der Fahrer gerade ist. null, solange er keine Strecke hat: dann gilt
  // der gespeicherte Standort aus den Daten.
  stand(id) {
    const fahrt = this.fahrten.get(id);
    if (!fahrt) return null;
    const { pfad, summen, laenge, tempo, abholMeter } = fahrt;
    const gefahren = Math.min(laenge, ((this.jetzt() - fahrt.beginn) / 1000) * tempo);
    // anfahrt: noch auf dem Weg zum Gast, fahrt: Gast an Bord, steht: am Ende.
    const phase = gefahren >= laenge ? 'steht' : (gefahren < abholMeter ? 'anfahrt' : 'fahrt');

    if (gefahren >= laenge) {
      const letzter = pfad[pfad.length - 1];
      const vorletzter = pfad[pfad.length - 2] || letzter;
      return { lat: letzter.lat, lng: letzter.lng, headingDeg: richtungGrad(vorletzter, letzter), speedMps: 0, phase };
    }

    let i = 1;
    while (i < summen.length && summen[i] < gefahren) i += 1;
    const a = pfad[i - 1];
    const b = pfad[i];
    const abschnitt = summen[i] - summen[i - 1] || 1;
    const anteil = (gefahren - summen[i - 1]) / abschnitt;
    const hier = { lat: a.lat + (b.lat - a.lat) * anteil, lng: a.lng + (b.lng - a.lng) * anteil };

    // Richtung ueber die naechsten 25 m, damit sie in Kurven nicht zappelt.
    let j = i;
    while (j < summen.length - 1 && summen[j] < gefahren + 25) j += 1;
    return { ...hier, headingDeg: richtungGrad(hier, pfad[j]), speedMps: tempo, phase };
  }

  // Die geplante Strecke, damit die Karte fuer den gewaehlten Fahrer genau den
  // Weg zeichnet, den er faehrt.
  pfad(id) {
    return this.fahrten.get(id)?.pfad || null;
  }

  // Restliche Fahrzeit bis zum Ende der Strecke in Minuten.
  restMinuten(id) {
    const fahrt = this.fahrten.get(id);
    if (!fahrt) return null;
    const gefahren = Math.min(fahrt.laenge, ((this.jetzt() - fahrt.beginn) / 1000) * fahrt.tempo);
    return Math.max(0, Math.ceil((fahrt.laenge - gefahren) / fahrt.tempo / 60));
  }

  aufraeumen() {
    this.fahrten.clear();
    this.warteschlange = [];
  }
}

export default FahrSimulation;
