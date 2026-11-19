// Dienstreise verschicken (Schalter "Fahrt | Standby | Dienstreise", Entwurf 14.11.): Datum, dann je Abschnitt
// Start Zeit, Start, Zug / Flug (mit Pruefung und Haken wie bei Flug/Zug in Fahrt hinzufuegen), dazwischen
// "Umstieg in ... · N min". "+ Umstieg hinzufuegen", Ziel, Fahrer, Ticket, Notiz, "Dienstreise senden".
// Upload-Icon oben rechts: Ticket (PDF) hochladen, der Server liest es (dispo-admin ticket_lesen) und die
// Felder werden hier ausgefuellt. Die Dispo prueft und schickt selbst ab.

import { useEffect, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import OrtVorschlag from '../ui/OrtVorschlag';
import { FormRow } from './FahrtAdd';
import ArtUmschalter from '../ui/ArtUmschalter';
import { orteZurEingabe, useOrte } from '../../shared/orte';
import { fahrerMarkierung } from '../../shared/fahrerMarkierung';
import { geocodeAddress } from '../../services/tomtomRoute';
import { supabase } from '../../services/supabase';
import { useI18n } from '../../i18n';
import { fahrerIdFinden } from '../../shared/standby';
import {
  abschnittArt, bahnhofOrten, dienstreiseAnlegen, istHaltArt, mitLiveAbfrage, ticketHochladenUndLesen, verbindungHolen,
} from '../../shared/dienstreise';

const GREEN = '#E3F654';
const ROW_STEP = 68;
const ROW_HEIGHT = 56;
const KOPF = 36;
const HINTERGRUND = 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const neueId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const neuerAbschnitt = (x = {}) => ({
  key: neueId(), zeit: '', start: { text: '', ortId: '' }, nummer: '', uebernommen: '', ticket: null, ...x,
});
const minuten = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const kurzOrt = (text) => String(text || '').split(',')[0].trim();

export default function DienstreiseAdd({ setView, onFetchPlaceSuggestions = async () => [], onGesendet = () => {} }) {
  const { t } = useI18n();
  const { orte } = useOrte();
  // ID schon jetzt: das Ticket liegt im Ordner der Dienstreise, auch bevor sie gesendet ist.
  const [reiseId] = useState(neueId);
  const [datum, setDatum] = useState(heute());
  const [abschnitte, setAbschnitte] = useState(() => [neuerAbschnitt()]);
  const [ziel, setZiel] = useState({ text: '', ortId: '' });
  const [pruefungen, setPruefungen] = useState({});
  const [notiz, setNotiz] = useState('');
  const [ticket, setTicket] = useState(null);
  const [reisender, setReisender] = useState('');
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [hinweis, setHinweis] = useState('');
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [sendet, setSendet] = useState(false);
  const [fahrerNamen, setFahrerNamen] = useState(() => {
    if (fahrerMarkierung.wirkt()) {
      const namen = fahrerMarkierung.lesen().fahrer.map((f) => f.name).filter(Boolean);
      if (namen.length) return [...namen, ''];
    }
    return [''];
  });
  const dateiFeld = useRef(null);

  // Ortsvorschlaege: immer nur ein Feld offen (Start eines Abschnitts oder Ziel).
  const [offenesFeld, setOffenesFeld] = useState('');
  const [vorschlaege, setVorschlaege] = useState([]);
  const vorschlagUhr = useRef(null);
  const vorschlagNr = useRef(0);
  useEffect(() => () => clearTimeout(vorschlagUhr.current), []);
  const vorschlaegeHolen = (feld, text) => {
    clearTimeout(vorschlagUhr.current);
    const q = text.trim();
    if (!q) { setVorschlaege([]); return; }
    setOffenesFeld(feld);
    const n = vorschlagNr.current + 1;
    vorschlagNr.current = n;
    vorschlagUhr.current = setTimeout(async () => {
      const liste = await onFetchPlaceSuggestions(q);
      if (vorschlagNr.current === n) setVorschlaege(liste || []);
    }, 250);
  };

  useEffect(() => { setFehler(''); }, [datum, abschnitte, ziel.text, fahrerNamen]);

  const abschnittSetzen = (key, aenderung) => setAbschnitte((alt) => alt.map((a) => (a.key === key ? { ...a, ...aenderung } : a)));
  const fahrerSetzen = (i, wert) => setFahrerNamen((alt) => {
    const neu = alt.map((n, j) => (j === i ? wert : n));
    return [...neu.filter((n) => String(n).trim()), ''];
  });

  // bahnhof (19.11.): Halt vom Ticket oder Start eines Zug-/Bus-Abschnitts. Dann erst der Bahnhof bei der Bahn
  // ("München-Trudering" ist der Bahnhof, nicht der Stadtteil), sonst "Bahnhof …" in der Adresssuche.
  const ortAufloesen = async (ort, bahnhof = false) => {
    const eigener = ort.ortId ? orte.find((o) => o.id === ort.ortId) : null;
    if (eigener) return { id: eigener.id, name: eigener.name, adresse: eigener.adresse, lat: eigener.lat, lng: eigener.lng };
    if (!ort.text.trim()) return null;
    if (bahnhof || ort.bahnhof) {
      const b = await bahnhofOrten(ort.text).catch(() => null);
      if (b) return { name: b.name, adresse: b.name, lat: b.lat, lng: b.lng };
      const ersatz = /bahnhof|hbf|\bbf\b/i.test(ort.text) ? null : await geocodeAddress(`Bahnhof ${ort.text}`).catch(() => null);
      if (ersatz) return { name: kurzOrt(ort.text), adresse: ort.text, lat: ersatz.lat, lng: ersatz.lon };
    }
    const pos = await geocodeAddress(ort.text);
    if (!pos) return null;
    return { name: kurzOrt(ort.text), adresse: ort.text, lat: pos.lat, lng: pos.lon };
  };

  // Verbindung eines Abschnitts pruefen. Ausstieg: Start des naechsten Abschnitts (Umstieg), sonst Ticket, sonst Ziel.
  const pruefNr = useRef({});
  const pruefen = async (a, index, liste = abschnitte) => {
    const nummer = a.nummer.trim();
    const art = abschnittArt(nummer);
    if (!nummer || !a.start.text.trim() || !datum) { setPruefungen((p) => ({ ...p, [a.key]: null })); return; }
    if (!mitLiveAbfrage(art)) { setPruefungen((p) => ({ ...p, [a.key]: { ohne: true } })); return; }
    const nr = (pruefNr.current[a.key] || 0) + 1;
    pruefNr.current[a.key] = nr;
    setPruefungen((p) => ({ ...p, [a.key]: { laeuft: true } }));
    const naechster = liste[index + 1];
    const startDaten = a.start.ortId ? await ortAufloesen(a.start, istHaltArt(art)).catch(() => null) : null;
    const zielDaten = !naechster && ziel.text.trim() ? await ortAufloesen(ziel).catch(() => null) : null;
    const v = await verbindungHolen({
      datum,
      start_zeit: a.zeit,
      start_name: startDaten?.name || kurzOrt(a.start.text),
      start_lat: startDaten?.lat, start_lng: startDaten?.lng,
      ziel_bahnhof: naechster ? kurzOrt(naechster.start.text) : (a.ticket?.nach ? kurzOrt(a.ticket.nach) : ''),
      ziel_lat: zielDaten?.lat, ziel_lng: zielDaten?.lng,
      ziel_name: zielDaten?.name || ziel.text,
      zugnummer: art === 'flug' ? '' : nummer,
      flugnummer: art === 'flug' ? nummer : '',
    }).catch(() => null);
    if (pruefNr.current[a.key] === nr) setPruefungen((p) => ({ ...p, [a.key]: v }));
  };

  // Automatisch pruefen, kurz nachdem Nummer, Start oder Datum eines Abschnitts geaendert wurden.
  const geprueft = useRef({});
  const signatur = abschnitte.map((a) => `${a.key}|${a.nummer.trim()}|${a.start.text.trim()}|${a.start.ortId}`).join('§') + `#${datum}`;
  useEffect(() => {
    const uhr = setTimeout(() => {
      abschnitte.forEach((a, i) => {
        const s = `${a.nummer.trim()}|${a.start.text.trim()}|${a.start.ortId}|${datum}|${abschnitte[i + 1]?.start.text || ''}`;
        if (geprueft.current[a.key] === s) return;
        geprueft.current[a.key] = s;
        if (a.nummer.trim() && a.start.text.trim()) pruefen(a, i);
      });
    }, 800);
    return () => clearTimeout(uhr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatur]);

  const pruefText = (p) => {
    if (!p) return null;
    if (p.ohne) return null;
    if (p.laeuft) return { text: 'prüfe …', colorClass: 'text-[#868687]' };
    if (p.fehler) return { text: 'nicht gefunden', colorClass: 'text-[#FF6F63]' };
    return { text: `ab ${p.abfahrt}${p.gleis ? ` · ${p.art === 'zug' ? 'Gl. ' : ''}${p.gleis}` : ''}`, colorClass: 'text-[#E3F654]' };
  };
  const nummerAktion = (a, index) => {
    const p = pruefungen[a.key];
    if (!a.nummer.trim() || p?.ohne) return null;
    const ist = Boolean(a.uebernommen && a.uebernommen === a.nummer.trim());
    const kann = Boolean(p && !p.laeuft && !p.fehler && p.abfahrt);
    return {
      type: ist ? 'x' : kann ? 'check' : 'arrow',
      ariaLabel: ist ? 'Verbindung zurücksetzen' : kann ? 'Abfahrt übernehmen' : 'Nummer prüfen',
      onClick: () => {
        if (ist) { abschnittSetzen(a.key, { uebernommen: '', nummer: '' }); setPruefungen((x) => ({ ...x, [a.key]: null })); return; }
        if (kann) { abschnittSetzen(a.key, { zeit: p.abfahrt, uebernommen: a.nummer.trim() }); return; }
        pruefen(a, index);
      },
    };
  };

  // Ankunft eines Abschnitts: live, sonst aus dem Ticket.
  const ankunft = (a) => pruefungen[a.key]?.ankunft || a.ticket?.an || '';
  const umstiegMinuten = (vorher, a) => {
    const an = minuten(ankunft(vorher));
    const ab = minuten(a.zeit);
    if (an == null || ab == null) return null;
    return (ab - an + 1440) % 1440;
  };

  // Ticket hochladen und Formular ausfuellen.
  const ticketGewaehlt = async (e) => {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    setLaedt(true);
    setHinweis('Ticket wird gelesen …');
    try {
      const r = await ticketHochladenUndLesen(reiseId, datei);
      if (!r.ok) { setHinweis(''); setFehler(r.fehler); return; }
      setTicket({ pfad: r.pfad, name: r.name });
      const g = r.gelesen;
      if (!g) { setHinweis(r.fehler || 'Ticket gespeichert. Bitte die Felder von Hand ausfüllen.'); return; }
      if (g.datum) setDatum(g.datum);
      const neu = (g.abschnitte || []).map((x) => neuerAbschnitt({
        zeit: x.ab,
        start: { text: x.von, ortId: '', bahnhof: true },
        nummer: x.nummer || '',
        ticket: { an: x.an, nach: x.nach, an_datum: x.an_datum, gleis_ab: x.gleis_ab, gleis_an: x.gleis_an, hinweis: x.hinweis },
      }));
      if (neu.length) setAbschnitte(neu);
      const letzter = (g.abschnitte || [])[g.abschnitte.length - 1];
      if (letzter?.nach) setZiel({ text: letzter.nach, ortId: '', bahnhof: true });
      setReisender(g.name || '');
      setAuftragsnummer(g.auftragsnummer || '');
      const reservierung = (g.abschnitte || []).map((x) => x.hinweis).filter(Boolean).join(', ');
      setNotiz([
        g.auftragsnummer ? `Auftrag ${g.auftragsnummer}` : '',
        [g.tarif, g.klasse].filter(Boolean).join(', '),
        g.zugbindung?.length ? `Zugbindung ${g.zugbindung.join(' und ')}` : '',
        reservierung,
        'Ausweis mitnehmen.',
      ].filter(Boolean).join('. ').replace(/\.\./g, '.'));
      // Reisender aus dem Ticket als Fahrer, wenn er in der Fahrerliste steht.
      let gefunden = false;
      if (g.name) {
        const { data: profile } = await supabase.from('profiles').select('id, first_name, last_name, driver_number');
        const id = fahrerIdFinden(g.name, profile || []);
        const p = (profile || []).find((x) => x.id === id);
        if (p) {
          gefunden = true;
          const anzeige = `${p.first_name || ''} ${p.last_name || ''}`.trim() + (p.driver_number != null ? ` (${p.driver_number})` : '');
          setFahrerNamen((alt) => [...new Set([anzeige, ...alt.filter((n) => String(n).trim())]), '']);
        }
      }
      setHinweis(gefunden || !g.name
        ? 'Aus dem Ticket ausgefüllt. Bitte prüfen und dann senden.'
        : `Aus dem Ticket ausgefüllt. ${g.name} steht nicht in der Fahrerliste, bitte Fahrer eintragen.`);
    } finally {
      setLaedt(false);
    }
  };

  const feldWert = (marker, wert) => wert || document.querySelector(`input[data-tutorial="${marker}"]`)?.value || '';

  const senden = async () => {
    setFehler('');
    const d = feldWert('reise-datum', datum);
    if (!d) { setFehler('Bitte ein Datum setzen.'); return; }
    const liste = abschnitte.map((a, i) => ({ ...a, zeit: feldWert(`reise-zeit-${i}`, a.zeit) }));
    if (liste.some((a) => !a.zeit)) { setFehler('Bitte bei jedem Abschnitt die Start Zeit setzen.'); return; }
    if (liste.some((a) => !a.start.text.trim())) { setFehler('Bitte bei jedem Abschnitt einen Start wählen.'); return; }
    if (!ziel.text.trim()) { setFehler('Bitte ein Ziel wählen.'); return; }
    const namen = fahrerNamen.map((n) => String(n).trim()).filter(Boolean);
    if (!namen.length) { setFehler('Bitte mindestens einen Fahrer eintragen.'); return; }
    setSendet(true);
    try {
      const starts = [];
      for (const a of liste) {
        const o = await ortAufloesen(a.start, istHaltArt(abschnittArt(a.nummer)));
        if (!o) { setFehler(`„${a.start.text}“ nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen.`); return; }
        starts.push(o);
      }
      const zielDaten = await ortAufloesen(ziel);
      if (!zielDaten) { setFehler('Ziel nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen.'); return; }
      const { data: profile } = await supabase.from('profiles').select('id, first_name, last_name, driver_number');
      const ids = [];
      for (const n of namen) {
        const id = fahrerIdFinden(n, profile || []);
        if (!id) { setFehler(`Fahrer „${n}“ nicht gefunden.`); return; }
        if (!ids.includes(id)) ids.push(id);
      }
      const teile = liste.map((a, i) => {
        const p = pruefungen[a.key];
        const nach = i + 1 < liste.length ? starts[i + 1] : zielDaten;
        return {
          art: abschnittArt(a.nummer),
          nummer: a.nummer.trim(),
          von_name: starts[i].name, von_lat: starts[i].lat, von_lng: starts[i].lng,
          ab_datum: d, ab_zeit: a.zeit,
          gleis_ab: (p && !p.fehler && p.gleis) || a.ticket?.gleis_ab || '',
          nach_name: a.ticket?.nach ? kurzOrt(a.ticket.nach) : nach.name, nach_lat: nach.lat, nach_lng: nach.lng,
          an_datum: a.ticket?.an_datum || null,
          an_zeit: ankunft(a) || null,
          gleis_an: a.ticket?.gleis_an || '',
          hinweis: a.ticket?.hinweis || '',
        };
      });
      const erster = teile[0];
      const r = await dienstreiseAnlegen({
        id: reiseId,
        datum: d,
        startZeit: erster.ab_zeit,
        start: starts[0],
        ziel: zielDaten,
        zugnummer: erster.art === 'flug' ? '' : erster.nummer,
        flugnummer: erster.art === 'flug' ? erster.nummer : '',
        notiz: notiz.trim(),
        fahrerIds: ids,
        abschnitte: teile,
        ticket,
        reisender,
        auftragsnummer,
      });
      if (!r.ok) { setFehler(r.fehler || 'Dienstreise nicht gespeichert.'); return; }
      onGesendet(r.id);
    } finally {
      setSendet(false);
    }
  };

  // Ortsfeld mit Vorschlaegen (eigene Orte zuerst, dann Adressen), wie Ort im Standby.
  const ortZeile = (feld, ort, setzen, top, label, marker) => {
    const eigene = ort.ortId ? [] : orteZurEingabe(orte, ort.text);
    return (
      <>
        <FormRow
          top={top}
          label={label}
          value={ort.text}
          onChange={(text) => { setzen({ text, ortId: '' }); vorschlaegeHolen(feld, text); }}
          onFocus={() => setOffenesFeld(feld)}
          onBlur={() => setTimeout(() => setOffenesFeld((f) => (f === feld ? '' : f)), 150)}
          onReset={() => { setzen({ text: '', ortId: '' }); setVorschlaege([]); }}
          mode="select"
          marker={marker}
        />
        {offenesFeld === feld && (eigene.length > 0 || vorschlaege.length > 0) ? (
          <div className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]" style={{ top: `${top + ROW_HEIGHT + 4}px` }}>
            {eigene.map((o) => (
              <OrtVorschlag key={`ort-${o.id}`} ort={o} onWaehlen={(g) => { setzen({ text: g.name, ortId: g.id }); setVorschlaege([]); setOffenesFeld(''); }} />
            ))}
            {vorschlaege.map((v, i) => (
              <button
                key={`v-${i}-${v}`}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setzen({ text: v, ortId: '' }); setVorschlaege([]); setOffenesFeld(''); }}
                className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15] font-['Space_Grotesk']"
                style={{ color: GREEN }}
              >
                {v}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );
  };

  // Raster: Datum, je Abschnitt (Kopf "Umstieg", Start Zeit, Start, Zug / Flug), "+ Umstieg", Ziel, Fahrer, Ticket, Notiz.
  let y = 206;
  const datumOben = y; y += ROW_STEP;
  const bloecke = abschnitte.map((a, i) => {
    const kopf = i > 0 ? y : null;
    if (i > 0) y += KOPF;
    const zeit = y; y += ROW_STEP;
    const start = y; y += ROW_STEP;
    const nummer = y; y += ROW_STEP;
    return { a, i, kopf, zeit, start, nummer };
  });
  const plusOben = y; y += ROW_STEP;
  const zielOben = y; y += ROW_STEP;
  const fahrerOben = y; y += fahrerNamen.length * ROW_STEP;
  const ticketOben = ticket ? y : null;
  if (ticket) y += ROW_STEP;
  const notizOben = y - ROW_STEP + ROW_HEIGHT + 24;
  const ctaOben = notizOben + 224 + 24;
  const hoehe = ctaOben + ROW_HEIGHT + (fehler ? 60 : 30);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={{ background: HINTERGRUND }}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[151px]">
        <div className="w-[402px] relative overflow-hidden" style={{ height: `${hoehe}px`, background: HINTERGRUND }}>
          <BackCircleButton onClick={() => setView('ankuenfte')} className="absolute left-[20px] top-[60px]" />
          <ArtUmschalter art="dienstreise" onFahrt={() => setView('fahrtAdd')} onStandby={() => setView('standbyAdd')} onDienstreise={() => {}} />
          {/* Ticket hochladen: gleiches Symbol wie der Import in Fahrt hinzufuegen. */}
          <button
            type="button"
            onClick={() => dateiFeld.current?.click()}
            disabled={laedt}
            aria-label="Ticket hochladen"
            className="absolute right-[20px] top-[65px] w-[42px] h-[40px] overflow-clip disabled:opacity-50"
          >
            <img src="/icon/_Icon_Lime/import-fahrten.svg" alt="" className="block w-full h-full" />
          </button>
          <input ref={dateiFeld} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={ticketGewaehlt} />

          <div className="absolute left-[20px] top-[140px] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
            Dienstreise
          </div>
          {hinweis ? (
            <div className="absolute left-[20px] right-[20px] top-[184px] text-[12px] font-bold font-['Space_Grotesk'] truncate" style={{ color: GREEN }}>{hinweis}</div>
          ) : null}

          <FormRow top={datumOben} label="Datum" value={datum} onChange={setDatum} onReset={() => setDatum('')} mode="date" marker="reise-datum" />

          {bloecke.map(({ a, i, kopf, zeit, start, nummer }) => {
            const umstieg = i > 0 ? umstiegMinuten(abschnitte[i - 1], a) : null;
            return (
              <div key={a.key}>
                {kopf != null ? (
                  <div className="absolute left-[20px] w-[362px] flex items-center justify-between font-['Space_Grotesk']" style={{ top: `${kopf + 6}px` }}>
                    <div className="flex items-center gap-[10px] min-w-0">
                      <span className="w-[24px] h-[2px] shrink-0" style={{ background: GREEN }} />
                      <span className="text-[16px] font-bold truncate" style={{ color: GREEN }}>Umstieg{a.start.text.trim() ? ` in ${kurzOrt(a.start.text)}` : ''}</span>
                    </div>
                    <div className="flex items-center gap-[12px] shrink-0">
                      {umstieg != null ? <span className="text-[14px] font-bold text-[#868687]">{umstieg} min</span> : null}
                      <button type="button" aria-label="Umstieg entfernen" onClick={() => setAbschnitte((alt) => alt.filter((x) => x.key !== a.key))} className="text-[#f55757] text-[16px] font-bold leading-none">✕</button>
                    </div>
                  </div>
                ) : null}
                <FormRow top={zeit} label="Start Zeit" value={a.zeit} onChange={(w) => abschnittSetzen(a.key, { zeit: w })} onReset={() => abschnittSetzen(a.key, { zeit: '' })} mode="time" marker={`reise-zeit-${i}`} />
                {ortZeile(`start-${a.key}`, a.start, (o) => abschnittSetzen(a.key, { start: o }), start, 'Start')}
                <FormRow
                  top={nummer}
                  label="Zug / Flug"
                  value={a.nummer}
                  onChange={(w) => { abschnittSetzen(a.key, { nummer: w }); setPruefungen((p) => ({ ...p, [a.key]: null })); }}
                  onReset={() => { abschnittSetzen(a.key, { nummer: '', uebernommen: '' }); setPruefungen((p) => ({ ...p, [a.key]: null })); }}
                  etaIndicator={a.nummer.trim() ? pruefText(pruefungen[a.key]) : null}
                  rightAction={nummerAktion(a, i)}
                />
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setAbschnitte((alt) => [...alt, neuerAbschnitt({
              // Neuer Abschnitt beginnt dort, wo der letzte ankommt (Ziel, falls schon gesetzt). Aenderbar.
              start: { text: alt[alt.length - 1]?.ticket?.nach || '', ortId: '', bahnhof: Boolean(alt[alt.length - 1]?.ticket?.nach) },
            })])}
            className="absolute left-[20px] w-[362px] h-14 border-2 border-dashed flex items-center justify-center text-[16px] font-bold font-['Space_Grotesk']"
            style={{ top: `${plusOben}px`, borderColor: GREEN, color: GREEN }}
          >
            + Umstieg hinzufügen
          </button>

          {ortZeile('ziel', ziel, setZiel, zielOben, 'Ziel')}

          {fahrerNamen.map((n, i) => (
            <FormRow
              key={`fahrer-${i}`}
              top={fahrerOben + i * ROW_STEP}
              label={fahrerNamen.length > 1 ? t('fahrt.fahrerNumbered', { n: i + 1 }) : t('fahrt.fahrer')}
              value={n}
              onChange={(w) => fahrerSetzen(i, w)}
              onReset={() => fahrerSetzen(i, '')}
              mode="fahrer"
            />
          ))}

          {ticket ? (
            <FormRow
              top={ticketOben}
              label="Ticket"
              value={ticket.name}
              onChange={() => {}}
              onReset={() => setTicket(null)}
              rightAction={{ type: 'x', onClick: () => setTicket(null), ariaLabel: 'Ticket entfernen' }}
            />
          ) : null}

          <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${notizOben}px`, height: '224px' }}>
            <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden">
              <div className="p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]" style={{ fontFamily: 'Space Grotesk' }}>{t('fahrt.notizen')}</h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>
                <textarea
                  value={notiz}
                  onChange={(e) => setNotiz(e.target.value)}
                  placeholder={t('fahrt.notesPlaceholder')}
                  className="flex-1 text-[14px] text-[#1d1c1d] placeholder:text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={sendet || laedt}
            onClick={senden}
            className="absolute left-[20px] w-[362px] h-14 px-6 flex items-center justify-between disabled:opacity-60"
            style={{ top: `${ctaOben}px`, background: GREEN }}
          >
            <span className="text-black text-[16px] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{sendet ? 'Wird gesendet …' : 'Dienstreise senden'}</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>
          {fehler ? (
            <div className="absolute left-[20px] w-[362px] text-[13px] font-bold text-[#ff6f63] font-['Space_Grotesk']" style={{ top: `${ctaOben + ROW_HEIGHT + 10}px` }}>{fehler}</div>
          ) : null}
        </div>
      </div>
      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        onNavigateToMap={() => setView('karten')}
        activeTab="add"
      />
    </div>
  );
}

