// Excel-/CSV-Import fuer die Disposition (Web, iOS, Android rufen alle diese Aktionen auf).
//
// import_analysieren  Datei lesen, Blatt waehlen, Spalten erkennen (Vorlage, Regeln, Llama),
//                     Fahrten/Fahrgaeste bauen, Dubletten markieren.
// import_adressen     Adressen ueber den eigenen Nominatim-Dienst pruefen.
// import_ausfuehren   Gepruefte Datensaetze als Stapel speichern, Vorlage merken.
// import_liste        Letzte Importe (zum Rueckgaengigmachen).
// import_rueckgaengig Fahrten/Fahrgaeste eines Stapels wieder loeschen, sofern noch nicht gefahren.
//
// Llama laeuft nicht auf dem Server, sondern optional auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er nicht erreichbar, bleibt es bei den Regeln.
// Llama schlaegt nur vor: jeder Vorschlag wird gegen die Werte der Spalte geprueft.

// deno-lint-ignore-file no-explicit-any
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
import * as K from './importKern.js';

type Admin = any;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ZEILEN = 2000;

const antwort = (status: number, daten: unknown) => ({ status, daten });

// ---------------------------------------------------------------------------
// Datei lesen
// ---------------------------------------------------------------------------

const base64ZuBytes = (b64: string) => {
  const roh = atob(b64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
  return bytes;
};

const textAusBytes = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    // Excel unter Windows speichert CSV oft als Windows-1252.
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

const trennzeichen = (inhalt: string) => {
  const zeilen = inhalt.split(/\r?\n/).filter((z) => z.trim()).slice(0, 8);
  const zaehle = (sep: string) => zeilen.reduce((summe, z) => summe + (z.split(sep).length - 1), 0);
  const [bestes] = [';', ',', '\t', '|'].map((sep) => [sep, zaehle(sep)] as const).sort((a, b) => b[1] - a[1]);
  return bestes[1] > 0 ? bestes[0] : ';';
};

const blattZeilen = (blatt: any) => (XLSX.utils.sheet_to_json(blatt, {
  header: 1, blankrows: false, defval: '', raw: true,
}) as unknown[][]).slice(0, MAX_ZEILEN);

export const dateiLesen = (b64: string, dateiname: string) => {
  const bytes = base64ZuBytes(b64);
  if (bytes.length > MAX_BYTES) throw new Error('datei_zu_gross');
  const name = dateiname.toLowerCase();
  const istZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const istXls = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if (istZip || istXls || /\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const mappe = XLSX.read(bytes, { type: 'array', cellDates: true, UTC: true });
    return mappe.SheetNames.map((n: string) => ({ name: n, zeilen: blattZeilen(mappe.Sheets[n]) }))
      .filter((b: any) => b.zeilen.length);
  }
  const inhalt = textAusBytes(bytes);
  // raw: Werte so lassen, wie sie in der Datei stehen. Sonst werden Datumsangaben amerikanisch.
  const mappe = XLSX.read(inhalt, { type: 'string', raw: true, FS: trennzeichen(inhalt) });
  return [{ name: dateiname || 'Tabelle', zeilen: blattZeilen(mappe.Sheets[mappe.SheetNames[0]]) }];
};

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

const einstellung = async (admin: Admin, key: string, standard: string) => {
  const { data } = await admin.from('integration_settings').select('value').eq('key', key).maybeSingle();
  const wert = data?.value;
  if (typeof wert === 'string' && wert.trim()) return wert.trim();
  if (wert && typeof wert === 'object' && typeof wert.url === 'string') return wert.url;
  return standard;
};

// ---------------------------------------------------------------------------
// Llama
// ---------------------------------------------------------------------------

const FELD_BESCHREIBUNG: Record<string, string> = {
  datumUhrzeit: 'Datum und Uhrzeit zusammen in einer Zelle',
  datum: 'Datum der Fahrt (auch ohne Jahr, z. B. "Mo 12.01.")',
  uhrzeit: 'Abholzeit (nur Uhrzeit)',
  abholort: 'Abholort / Startadresse',
  zielort: 'Ziel / Zieladresse',
  flugnummer: 'Flug- oder Zugnummer',
  zugnummer: 'Zugnummer',
  herkunft: 'Abflughafen oder Herkunft des Flugs',
  gaeste: 'Namen der Fahrgaeste',
  anzahl: 'Anzahl Personen (Zahl)',
  vip: 'VIP ja/nein',
  kindersitz: 'Kindersitz',
  rollstuhl: 'Rollstuhl / barrierefrei',
  gepaeck: 'Gepaeck / Koffer',
  notiz: 'Bemerkung / Freitext',
  vorname: 'Vorname', nachname: 'Nachname', vollname: 'ganzer Name', email: 'E-Mail', telefon: 'Telefon',
  firma: 'Firma', strasse: 'Strasse', plz: 'Postleitzahl', stadt: 'Stadt', sprache: 'Sprache',
};

const ollamaFragen = async (url: string, model: string, prompt: string, ms: number) => {
  const ctrl = new AbortController();
  const zeit = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0 }, keep_alive: '30m' }),
    });
    if (!r.ok) return null;
    const daten = await r.json();
    return JSON.parse(String(daten?.response || 'null'));
  } catch {
    return null;
  } finally {
    clearTimeout(zeit);
  }
};

// Passt ein Feld zu den Werten der Spalte? Llama darf nur vorschlagen, was die Werte hergeben.
const passtZuWerten = (feld: string, beispiele: string[]) => {
  const n = beispiele.length || 1;
  const anteil = (f: (t: string) => boolean) => beispiele.filter(f).length / n;
  const istDatum = (t: string) => Boolean(K.datumLesen(t));
  const istZeit = (t: string) => Boolean(K.uhrzeitLesen(t));
  switch (feld) {
    case 'datum': return anteil(istDatum) >= 0.5;
    case 'uhrzeit': return anteil(istZeit) >= 0.5 && anteil(istDatum) < 0.5;
    case 'datumUhrzeit': return anteil((t) => istDatum(t) && istZeit(t)) >= 0.5;
    case 'flugnummer': case 'zugnummer': return anteil((t) => /[A-Z]{2}\s?\d{2,4}|ICE|IC\s?\d/i.test(t)) >= 0.4;
    case 'anzahl': return anteil((t) => /^\d{1,2}$/.test(t.trim())) >= 0.5;
    case 'abholort': case 'zielort': return anteil((t) => !istZeit(t) && !istDatum(t) && /[a-zäöü]{3}/i.test(t)) >= 0.6;
    case 'gaeste': case 'vorname': case 'nachname': case 'vollname': return anteil((t) => /[a-zäöü]{2}/i.test(t) && !istZeit(t)) >= 0.6;
    case 'email': return anteil((t) => /@/.test(t)) >= 0.5;
    case 'telefon': return anteil((t) => (t.match(/\d/g) || []).length >= 6) >= 0.5;
    default: return true;
  }
};

// Spalten ohne sicheren Regel-Vorschlag und fehlende Pflichtfelder von Llama zuordnen lassen.
const llamaZuordnen = async (admin: Admin, modus: string, erkennung: any, zuordnung: Record<string, string>) => {
  const url = await einstellung(admin, 'ollama_url', '');
  if (!url) return { genutzt: false, erreichbar: false, zuordnung };
  const model = await einstellung(admin, 'ollama_model', 'llama3.1:8b');
  const felder = K.feldNamen(modus);
  const spalten = erkennung.spalten;
  const tabelle = [
    spalten.map((s: any) => `[${s.index}] ${s.ohneTitel ? '(ohne Ueberschrift)' : s.titel}`).join(' ; '),
    ...erkennung.datenzeilen.filter((z: unknown[]) => z.filter((w) => K.text(w)).length >= 2).slice(0, 6)
      .map((z: unknown[]) => spalten.map((s: any) => K.text(z[s.index]).slice(0, 60)).join(' ; ')),
  ].join('\n');
  const art = modus === 'guests' ? 'Fahrgastliste (Kundendaten)' : 'Fahrtenliste eines Chauffeur-Service';
  const prompt = `Du ordnest Spalten einer ${art} Feldern zu.
Felder:
${felder.map((f) => `- ${f}: ${FELD_BESCHREIBUNG[f] || f}`).join('\n')}
Regeln: Jedes Feld hoechstens einmal. Spalten ohne passendes Feld weglassen. Eine Spalte nur mit Uhrzeiten ist "uhrzeit", nur mit Datum ist "datum".
Tabelle (erste Zeile Ueberschriften mit [Spaltennummer], darunter Beispielzeilen, Zellen durch ; getrennt):
${tabelle}
Antworte nur mit JSON in der Form {"<Spaltennummer>": "<feld>"}.`;
  const vorschlag = await ollamaFragen(url, model, prompt, 45000);
  if (!vorschlag || typeof vorschlag !== 'object') return { genutzt: false, erreichbar: vorschlag !== null, zuordnung };

  const neu = { ...zuordnung };
  const vergeben = new Set(Object.values(neu));
  const geaendert: number[] = [];
  Object.entries(vorschlag).forEach(([idx, feld]) => {
    const spalte = spalten.find((s: any) => String(s.index) === String(idx));
    if (!spalte || typeof feld !== 'string' || !felder.includes(feld)) return;
    // Sichere Regel-Treffer bleiben. Llama fuellt nur Luecken.
    if (neu[spalte.index] && spalte.sicherheit >= 0.6) return;
    if (vergeben.has(feld)) return;
    if (feld === 'datumUhrzeit' && (vergeben.has('datum') || vergeben.has('uhrzeit'))) return;
    if ((feld === 'datum' || feld === 'uhrzeit') && vergeben.has('datumUhrzeit')) return;
    if (!passtZuWerten(feld, spalte.beispiele)) return;
    if (neu[spalte.index]) vergeben.delete(neu[spalte.index]);
    neu[spalte.index] = feld;
    vergeben.add(feld);
    geaendert.push(spalte.index);
  });
  return { genutzt: geaendert.length > 0, erreichbar: true, zuordnung: neu, geaendert };
};

// ---------------------------------------------------------------------------
// Dubletten
// ---------------------------------------------------------------------------

const vergleich = (a: unknown) => K.schluessel(a).replace(/\b(str|strasse|straße)\b/g, 'str');

const dublettenMarkieren = async (admin: Admin, modus: string, datensaetze: any[]) => {
  if (modus === 'guests') {
    const mails = datensaetze.map((s) => K.text(s.daten.email).toLowerCase()).filter(Boolean);
    const { data } = await admin.from('guests').select('first_name, last_name, email').limit(5000);
    const vorhanden = new Set((data || []).map((g: any) => `${vergleich(g.first_name)}|${vergleich(g.last_name)}`));
    const vorhandenMail = new Set((data || []).map((g: any) => K.text(g.email).toLowerCase()).filter(Boolean));
    void mails;
    datensaetze.forEach((s) => {
      const name = `${vergleich(s.daten.first_name)}|${vergleich(s.daten.last_name)}`;
      if (vorhanden.has(name) || (s.daten.email && vorhandenMail.has(K.text(s.daten.email).toLowerCase()))) s.hinweise.push('doppelt');
    });
    return;
  }
  const tage = [...new Set(datensaetze.map((s) => s.daten.ride_date).filter(Boolean))];
  if (!tage.length) return;
  const { data } = await admin.from('jobs').select('ride_date, etd, pickup_address, dropoff_address, status').in('ride_date', tage);
  const vorhanden = new Set((data || [])
    .filter((j: any) => !/cancel|storn|refused/i.test(String(j.status || '')))
    .map((j: any) => `${j.ride_date}|${String(j.etd || '').slice(0, 5)}|${vergleich(j.pickup_address)}|${vergleich(j.dropoff_address)}`));
  datensaetze.forEach((s) => {
    const d = s.daten;
    const sch = `${d.ride_date}|${String(d.etd || '').slice(0, 5)}|${vergleich(d.pickup_address)}|${vergleich(d.dropoff_address)}`;
    if (vorhanden.has(sch)) s.hinweise.push('doppelt');
  });
};

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

const analysieren = async (admin: Admin, body: any) => {
  const modus = body?.modus === 'guests' ? 'guests' : 'rides';
  const dateiname = K.text(body?.dateiname) || 'Tabelle';
  if (typeof body?.datei !== 'string' || !body.datei) return antwort(400, { error: 'datei_fehlt' });

  let blaetter;
  try {
    blaetter = dateiLesen(body.datei, dateiname);
  } catch (e) {
    const meldung = e instanceof Error ? e.message : String(e);
    return antwort(400, { error: meldung === 'datei_zu_gross' ? meldung : 'datei_unlesbar', detail: meldung });
  }
  if (!blaetter.length) return antwort(400, { error: 'datei_leer' });

  const blatt = Number.isInteger(body?.blatt) && blaetter[body.blatt] ? body.blatt : K.blattWaehlen(blaetter, modus);
  const zeilen = blaetter[blatt].zeilen;

  // Vorlage: dieselben Ueberschriften wurden schon einmal geprueft importiert.
  const vorab = K.spaltenErkennen(zeilen, modus);
  let vorlage = null;
  if (vorab.signatur && !body?.zuordnung && body?.vorlageNutzen !== false) {
    const { data } = await admin.from('import_vorlagen').select('zuordnung, name').eq('modus', modus).eq('signatur', vorab.signatur).maybeSingle();
    if (data?.zuordnung) vorlage = data;
  }
  const erkennung = vorlage ? K.spaltenErkennen(zeilen, modus, { vorlage: vorlage.zuordnung }) : vorab;
  if (!erkennung.spalten.length || !erkennung.datenzeilen.length) return antwort(400, { error: 'datei_leer' });

  let zuordnung: Record<string, string> = body?.zuordnung && typeof body.zuordnung === 'object'
    ? Object.fromEntries(Object.entries(body.zuordnung).filter(([, f]) => typeof f === 'string' && K.feldNamen(modus).includes(f as string))) as Record<string, string>
    : K.zuordnungAus(erkennung.spalten);

  let { datensaetze } = K.bauen(modus, erkennung.datenzeilen, zuordnung);

  // Llama nur, wenn die Regeln Luecken lassen: Datensaetze mit fehlenden Angaben oder Spalten
  // mit Inhalt, die keinem Feld zugeordnet sind. Nie bei Vorlage oder eigener Zuordnung.
  let llama: any = { genutzt: false, erreichbar: null };
  const luecken = datensaetze.some((s: any) => s.fehlt.length)
    || erkennung.spalten.some((s: any) => !zuordnung[s.index]);
  if (!vorlage && !body?.zuordnung && body?.llama !== false && luecken) {
    llama = await llamaZuordnen(admin, modus, erkennung, zuordnung);
    if (llama.genutzt) {
      zuordnung = llama.zuordnung;
      ({ datensaetze } = K.bauen(modus, erkennung.datenzeilen, zuordnung));
    }
  }

  await dublettenMarkieren(admin, modus, datensaetze);
  datensaetze.forEach((s: any) => K.pruefen(modus, s));

  return antwort(200, {
    modus,
    dateiname,
    blaetter: blaetter.map((b: any, i: number) => ({ index: i, name: b.name, zeilen: b.zeilen.length })),
    blatt,
    kopfzeile: erkennung.kopfzeile,
    signatur: erkennung.signatur,
    vorlage: vorlage ? { name: vorlage.name || null } : null,
    felder: K.feldNamen(modus),
    spalten: erkennung.spalten.map((s: any) => ({
      index: s.index,
      titel: s.titel,
      ohneTitel: s.ohneTitel,
      beispiele: s.beispiele.slice(0, 4),
      vorschlag: zuordnung[s.index] || null,
      sicherheit: zuordnung[s.index] === s.vorschlag ? s.sicherheit : (zuordnung[s.index] ? 0.6 : 0),
      grund: (llama.geaendert || []).includes(s.index) ? { llama: true } : s.grund,
    })),
    zuordnung,
    // Nur Felder, die in mindestens einem Datensatz wirklich fehlen (Datum kann aus Zwischenzeilen kommen).
    fehlendeZuordnung: K.fehlendeZuordnung(zuordnung, modus).filter((f: string) => datensaetze.some((d: any) => d.fehlt.includes(f))),
    datensaetze,
    llama: { genutzt: Boolean(llama.genutzt), erreichbar: llama.erreichbar },
  });
};

// Adressen ueber den eigenen Nominatim-Dienst (auf dem Server, kostenlos) pruefen.
// Zuerst im Einsatzgebiet suchen (integration_settings.import_gebiet, Standard Grossraum Muenchen),
// dann ueberall. Listen schreiben Adressen selten sauber, darum mehrere Varianten.
const adressVarianten = (roh: string) => {
  const sauber = roh
    .replace(/\bHbf\.?\b/gi, 'Hauptbahnhof')
    .replace(/\b(MUC|Munich Airport|Airport Munich|Flughafen MUC)\b/gi, 'Flughafen München')
    .replace(/\s*\/\s*.*$/, '')                                  // "MUC T1 / LH1841 ab BCN"
    .replace(/\b(Terminal|T)\s?\d\b/gi, '')
    .replace(/\b(Eingang|Ausgang|Gate|Gleis|Halle)\s+\S+/gi, '')
    .replace(/\b(Nord|Süd|Sued|Ost|West)ausgang\b/gi, '')
    .replace(/(\d+)\s?[-–]\s?\d+[a-z]?\b/g, '$1')                 // "Promenadeplatz 2-6"
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
  const teile = sauber.split(',').map((t) => t.trim()).filter(Boolean);
  const varianten = [roh, sauber];
  // "Hotel X, Strasse 1, 80333 Muenchen": erst die Anschrift ohne Namen, dann nur den Namen.
  if (teile.length > 1) varianten.push(teile.slice(1).join(', '), teile[0]);
  return [...new Set(varianten.filter((v) => v && v.length >= 3))].slice(0, 4);
};

const adressenPruefen = async (admin: Admin, body: any) => {
  const adressen = [...new Set((Array.isArray(body?.adressen) ? body.adressen : []).map((a: unknown) => K.text(a)).filter(Boolean))].slice(0, 200) as string[];
  const basis = (await einstellung(admin, 'nominatim_url', 'http://host.docker.internal:8088')).replace(/\/$/, '');
  const gebiet = await einstellung(admin, 'import_gebiet', '11.05,48.45,12.15,47.95');
  const suchen = async (q: string, nurGebiet: boolean) => {
    const ctrl = new AbortController();
    const zeit = setTimeout(() => ctrl.abort(), 6000);
    try {
      const gebietTeil = nurGebiet ? `&viewbox=${encodeURIComponent(gebiet)}&bounded=1` : '';
      const r = await fetch(`${basis}/search?format=json&limit=1&accept-language=de${gebietTeil}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      if (!r.ok) return null;
      const [treffer] = await r.json();
      return treffer ? { name: treffer.display_name, lat: Number(treffer.lat), lng: Number(treffer.lon) } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(zeit);
    }
  };
  const ergebnis: Record<string, any> = {};
  let i = 0;
  const arbeiter = async () => {
    while (i < adressen.length) {
      const a = adressen[i++];
      let treffer = null;
      for (const nurGebiet of [true, false]) {
        for (const v of adressVarianten(a)) {
          treffer = await suchen(v, nurGebiet);
          if (treffer) break;
        }
        if (treffer) { if (!nurGebiet) (treffer as any).ausserhalb = true; break; }
      }
      ergebnis[a] = treffer ? { gefunden: true, ...treffer } : { gefunden: false };
    }
  };
  await Promise.all([arbeiter(), arbeiter(), arbeiter()]);
  return antwort(200, { adressen: ergebnis });
};

const ausfuehren = async (admin: Admin, body: any, userId: string) => {
  const modus = body?.modus === 'guests' ? 'guests' : 'rides';
  const saetze = (Array.isArray(body?.datensaetze) ? body.datensaetze : []).slice(0, MAX_ZEILEN);
  const gueltig = saetze.map((d: any) => ({ zeilen: [], daten: d, hinweise: [] })).map((s: any) => K.pruefen(modus, s)).filter((s: any) => !s.fehlt.length);
  if (!gueltig.length) return antwort(400, { error: 'nichts_zu_importieren' });

  const { data: stapel, error: stapelFehler } = await admin.from('imports')
    .insert({ modus, dateiname: K.text(body?.dateiname) || null, anzahl: gueltig.length, erstellt_von: userId })
    .select('id').single();
  if (stapelFehler) return antwort(500, { error: stapelFehler.message });

  try {
    if (modus === 'rides') {
      const zeilen = gueltig.map((s: any) => ({ ...K.fahrtZeile(s.daten), import_id: stapel.id }));
      const { data, error } = await admin.from('jobs').insert(zeilen).select('id');
      if (error) throw error;
      // Notizen gehoeren in job_notes, nicht in jobs.
      const notizen = gueltig
        .map((s: any, i: number) => ({ job_id: data?.[i]?.id, note_text: K.text(s.daten.note) }))
        .filter((n: any) => n.job_id && n.note_text);
      if (notizen.length) {
        const { error: nf } = await admin.from('job_notes').insert(notizen);
        if (nf) throw nf;
      }
    } else {
      const zeilen = gueltig.map((s: any) => ({ ...s.daten, import_id: stapel.id }));
      const { error } = await admin.from('guests').insert(zeilen);
      if (error) throw error;
    }
  } catch (e) {
    await admin.from('imports').delete().eq('id', stapel.id);
    return antwort(500, { error: e instanceof Error ? e.message : String((e as any)?.message || e) });
  }

  // Zuordnung fuer dieselbe Tabelle merken.
  const signatur = K.text(body?.signatur);
  const vorlage = body?.vorlage && typeof body.vorlage === 'object' ? body.vorlage : null;
  if (signatur && vorlage && Object.keys(vorlage).length) {
    const { data: alt } = await admin.from('import_vorlagen').select('genutzt').eq('modus', modus).eq('signatur', signatur).maybeSingle();
    await admin.from('import_vorlagen').upsert({
      modus, signatur, zuordnung: vorlage, name: K.text(body?.dateiname) || null,
      genutzt: (alt?.genutzt || 0) + 1, aktualisiert: new Date().toISOString(),
    });
  }
  return antwort(200, { import_id: stapel.id, anzahl: gueltig.length, uebersprungen: saetze.length - gueltig.length });
};

const NOCH_OFFEN = ['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen', 'cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];

const liste = async (admin: Admin, body: any) => {
  const modus = body?.modus === 'guests' ? 'guests' : 'rides';
  const { data, error } = await admin.from('imports').select('id, dateiname, anzahl, erstellt, rueckgaengig')
    .eq('modus', modus).order('erstellt', { ascending: false }).limit(10);
  if (error) return antwort(500, { error: error.message });
  const tabelle = modus === 'rides' ? 'jobs' : 'guests';
  const mitBestand = await Promise.all((data || []).map(async (imp: any) => {
    const { count } = await admin.from(tabelle).select('id', { count: 'exact', head: true }).eq('import_id', imp.id);
    return { ...imp, vorhanden: count || 0 };
  }));
  return antwort(200, { importe: mitBestand });
};

const rueckgaengig = async (admin: Admin, body: any) => {
  const id = K.text(body?.import_id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return antwort(400, { error: 'import_id_fehlt' });
  const { data: imp } = await admin.from('imports').select('id, modus').eq('id', id).maybeSingle();
  if (!imp) return antwort(404, { error: 'import_unbekannt' });
  let geloescht = 0; let behalten = 0;
  if (imp.modus === 'rides') {
    const { data: fahrten } = await admin.from('jobs').select('id, status').eq('import_id', id);
    // Schon begonnene oder gefahrene Fahrten bleiben.
    const weg = (fahrten || []).filter((f: any) => NOCH_OFFEN.includes(String(f.status || 'pending').toLowerCase())).map((f: any) => f.id);
    behalten = (fahrten || []).length - weg.length;
    if (weg.length) {
      await admin.from('job_notes').delete().in('job_id', weg);
      const { error } = await admin.from('jobs').delete().in('id', weg);
      if (error) return antwort(500, { error: error.message });
    }
    geloescht = weg.length;
  } else {
    const { data, error } = await admin.from('guests').delete().eq('import_id', id).select('id');
    if (error) return antwort(500, { error: error.message });
    geloescht = (data || []).length;
  }
  await admin.from('imports').update({ rueckgaengig: new Date().toISOString() }).eq('id', id);
  return antwort(200, { geloescht, behalten });
};

export const importAktion = async (admin: Admin, body: any, userId: string) => {
  switch (body?.aktion) {
    case 'import_analysieren': return analysieren(admin, body);
    case 'import_adressen': return adressenPruefen(admin, body);
    case 'import_ausfuehren': return ausfuehren(admin, body, userId);
    case 'import_liste': return liste(admin, body);
    case 'import_rueckgaengig': return rueckgaengig(admin, body);
    default: return antwort(400, { error: 'unknown_action' });
  }
};
