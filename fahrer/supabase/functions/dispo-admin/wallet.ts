// Apple-Wallet-Pass zur Dienstreise (14.11.2026). Aufrufen duerfen die Dispo und die Fahrer der Dienstreise.
//
// 1. Ticket-PDF aus dem Speicher dienstreise-tickets holen, den Aztec-Code (DB, UIC "#UT...") aus dem Bild lesen.
// 2. pass.json bauen (Bordkarte Zug): Datum, Start -> Ziel, Zeiten, Zug, Gleis, Reisender, Umstiege, Barcode.
// 3. Signieren mit dem Zertifikat der Pass Type ID pass.de.trisar.ticket (p12 + Passwort in trisar_geheimnis,
//    nur fuer den Server lesbar) und Apples Zwischenzertifikat WWDR G4.
// 4. Als .pkpass in den Ordner der Dienstreise legen und einen Link (1 Stunde) zurueckgeben.

import { APPLE_WWDR_G4, PASS_BILDER } from './wallet/bilder.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

const PASS_TYPE_ID = 'pass.de.trisar.ticket';

const b64ZuBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hm = (v: unknown) => String(v || '').slice(0, 5);
const tagKurz = (iso: string | null) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};
const kurz = (t: unknown) => String(t || '').split(',')[0].trim();

/** Aztec-Code aus den Bildern der ersten Seite lesen. Ergebnis: Rohbytes des Barcodes oder null. */
export const barcodeLesen = async (pdfBytes: Uint8Array): Promise<Uint8Array | null> => {
  const { extractImages, getDocumentProxy } = await import('https://esm.sh/unpdf@1.0.5');
  const { readBarcodes } = await import('https://esm.sh/zxing-wasm@2.1.0/reader');
  const pdf = await getDocumentProxy(pdfBytes);
  for (let seite = 1; seite <= Math.min(pdf.numPages, 2); seite += 1) {
    // deno-lint-ignore no-explicit-any
    const bilder: any[] = await extractImages(pdf, seite);
    // Quadratische Bilder zuerst (Aztec ist quadratisch).
    bilder.sort((a, b) => Math.abs(a.width - a.height) - Math.abs(b.width - b.height));
    for (const b of bilder) {
      if (!b?.width || !b?.height || b.width < 80) continue;
      const kanaele = b.channels || Math.round(b.data.length / (b.width * b.height));
      const rgba = new Uint8ClampedArray(b.width * b.height * 4);
      for (let i = 0, j = 0; i < b.width * b.height; i += 1) {
        const r = b.data[i * kanaele];
        rgba[j++] = r;
        rgba[j++] = kanaele >= 3 ? b.data[i * kanaele + 1] : r;
        rgba[j++] = kanaele >= 3 ? b.data[i * kanaele + 2] : r;
        rgba[j++] = 255;
      }
      // deno-lint-ignore no-explicit-any
      const treffer = await readBarcodes({ data: rgba, width: b.width, height: b.height, colorSpace: 'srgb' } as any, { formats: ['Aztec', 'QRCode', 'PDF417'] });
      if (treffer.length && treffer[0].bytes?.length) return treffer[0].bytes;
    }
  }
  return null;
};


/** Pass bauen und signieren (ohne Datenbank, auch fuer den lokalen Test werkzeuge/wallet-test.sh). */
export const passBauen = async ({ reise, teile, barcode, p12b64, passwort }: {
  // deno-lint-ignore no-explicit-any
  reise: any; teile: any[]; barcode: Uint8Array; p12b64: string; passwort: string;
}): Promise<Uint8Array> => {
  // Zertifikat und Schluessel aus dem p12.
  const forge = (await import('https://esm.sh/node-forge@1.3.1')).default;
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(p12b64)), passwort);
  const zert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
  const schluessel = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
    || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0])?.key;
  if (!zert || !schluessel) throw new Error('Zertifikat oder Schluessel fehlt im p12');
  const teamId = zert.subject.getField('OU')?.value || '';
  const wwdr = forge.pki.certificateFromPem(APPLE_WWDR_G4);

  // Inhalt des Passes.
  const liste = (teile || []) as Array<Record<string, string>>;
  const erster = liste[0];
  const letzter = liste[liste.length - 1];
  const haupt = liste.find((a) => a.art === 'zug' || a.art === 'flug') || erster;
  const start = kurz(erster?.von_name || reise.start_name);
  const ziel = kurz(letzter?.nach_name || reise.ziel_name);
  const abZeit = hm(erster?.ab_zeit || reise.start_zeit);
  const anZeit = hm(letzter?.an_zeit);
  // Weitere Zuege/Fluege nach dem ersten (Bus und U-Bahn stehen nur auf der Rueckseite).
  const hauptIndex = Math.max(0, liste.indexOf(haupt));
  const weitere = liste.slice(hauptIndex + 1).filter((a) => a.art === 'zug' || a.art === 'sbahn' || a.art === 'flug');
  const relevant = (() => {
    const t = `${reise.datum}T${abZeit || '00:00'}:00`;
    const d = new Date(`${t}+01:00`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  })();
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    serialNumber: String(reise.id),
    teamIdentifier: teamId,
    organizationName: 'TRISAR',
    description: `Dienstreise ${start} → ${ziel}`,
    logoText: '',
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(26, 26, 26)',
    labelColor: 'rgb(227, 246, 84)',
    ...(relevant ? { relevantDate: relevant } : {}),
    barcodes: [{
      format: 'PKBarcodeFormatAztec',
      // DB-Barcode ist binaer: jedes Byte als ein Zeichen (ISO-8859-1), so bleibt er unveraendert.
      message: String.fromCharCode(...barcode),
      messageEncoding: 'iso-8859-1',
      altText: reise.auftragsnummer ? `Auftrag ${reise.auftragsnummer}` : undefined,
    }],
    boardingPass: {
      transitType: 'PKTransitTypeTrain',
      headerFields: [{ key: 'datum', label: 'DATUM', value: tagKurz(reise.datum) }],
      primaryFields: [
        { key: 'von', label: abZeit || 'AB', value: start },
        { key: 'nach', label: anZeit || 'AN', value: ziel },
      ],
      secondaryFields: [
        { key: 'zug', label: 'ZUG', value: haupt?.nummer || reise.zugnummer || '' },
        ...(haupt?.gleis_ab ? [{ key: 'gleis', label: 'GLEIS', value: haupt.gleis_ab }] : []),
        ...(reise.reisender ? [{ key: 'reisender', label: 'REISENDER', value: reise.reisender }] : []),
      ],
      // Je weiterer Zug: "UMSTIEG MANNHEIM 11:00" | ICE 71, daneben GLEIS 4 (Apple zeigt bis zu 4 Felder je Zeile).
      auxiliaryFields: weitere.slice(0, 2).flatMap((a, i) => [
        { key: `umstieg${i}`, label: `UMSTIEG ${kurz(a.von_name).toUpperCase()} ${hm(a.ab_zeit)}`, value: a.nummer || '' },
        ...(a.gleis_ab ? [{ key: `umstieggleis${i}`, label: 'GLEIS', value: a.gleis_ab }] : []),
      ]),
      backFields: [
        ...liste.map((a, i) => ({
          key: `abschnitt${i}`,
          label: a.nummer || `Abschnitt ${i + 1}`,
          value: `${hm(a.ab_zeit)} ${a.von_name}${a.gleis_ab ? ` (Gl. ${a.gleis_ab})` : ''} → ${hm(a.an_zeit)} ${a.nach_name || ''}${a.gleis_an ? ` (Gl. ${a.gleis_an})` : ''}`,
        })),
        ...(reise.auftragsnummer ? [{ key: 'auftrag', label: 'Auftragsnummer', value: reise.auftragsnummer }] : []),
        ...(reise.notiz ? [{ key: 'notiz', label: 'Notiz der Dispo', value: reise.notiz }] : []),
        { key: 'hinweis', label: 'Hinweis', value: 'Gültig nur mit amtlichem Lichtbildausweis. Das Original-Ticket liegt in der TRISAR-App.' },
      ],
    },
  };

  // Dateien, Manifest (SHA-1 je Datei), Signatur (PKCS#7, losgeloest).
  const enc = new TextEncoder();
  const dateien: Record<string, Uint8Array> = { 'pass.json': enc.encode(JSON.stringify(pass)) };
  for (const [name, b64] of Object.entries(PASS_BILDER)) dateien[name] = b64ZuBytes(b64);
  const manifest: Record<string, string> = {};
  for (const [name, inhalt] of Object.entries(dateien)) manifest[name] = hex(await crypto.subtle.digest('SHA-1', new Uint8Array(inhalt)));
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  dateien['manifest.json'] = manifestBytes;

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(new TextDecoder('latin1').decode(manifestBytes));
  p7.addCertificate(zert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key: schluessel,
    certificate: zert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const signaturDer = forge.asn1.toDer(p7.toAsn1()).getBytes();
  dateien.signature = Uint8Array.from(signaturDer, (c: string) => c.charCodeAt(0));

  const { zipSync } = await import('https://esm.sh/fflate@0.8.2');
  return zipSync(dateien, { level: 6 });

};

export const walletPass = async (admin: Admin, nutzerId: string, istDispo: boolean, body: Record<string, unknown>) => {
  const reiseId = String(body?.dienstreise_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(reiseId)) return { status: 400, daten: { error: 'dienstreise_id fehlt' } };

  // Nur Dispo oder Fahrer dieser Dienstreise.
  if (!istDispo) {
    const { data: drin } = await admin.from('dienstreise_fahrer').select('driver_id')
      .eq('dienstreise_id', reiseId).eq('driver_id', nutzerId).maybeSingle();
    if (!drin) return { status: 403, daten: { error: 'kein Zugriff' } };
  }
  const { data: reise } = await admin.from('dienstreise').select('*').eq('id', reiseId).maybeSingle();
  if (!reise) return { status: 404, daten: { error: 'Dienstreise nicht gefunden' } };
  if (!reise.ticket_pfad) return { status: 200, daten: { ok: false, meldung: 'Zu dieser Dienstreise gibt es kein Ticket.' } };
  const { data: teile } = await admin.from('dienstreise_abschnitt').select('*').eq('dienstreise_id', reiseId).order('reihenfolge');

  // Zertifikat und Passwort (nur der Server kann die Tabelle lesen).
  const { data: geheim } = await admin.from('trisar_geheimnis').select('name, wert').in('name', ['wallet_p12', 'wallet_p12_passwort']);
  const p12b64 = geheim?.find((g: { name: string }) => g.name === 'wallet_p12')?.wert;
  const passwort = geheim?.find((g: { name: string }) => g.name === 'wallet_p12_passwort')?.wert ?? '';
  if (!p12b64) return { status: 200, daten: { ok: false, meldung: 'Wallet ist noch nicht eingerichtet (Zertifikat fehlt).' } };

  const { data: datei, error } = await admin.storage.from('dienstreise-tickets').download(reise.ticket_pfad);
  if (error || !datei) return { status: 404, daten: { error: 'Ticket nicht gefunden' } };
  const barcode = await barcodeLesen(new Uint8Array(await datei.arrayBuffer()));
  if (!barcode) return { status: 200, daten: { ok: false, meldung: 'Im Ticket wurde kein Barcode gefunden.' } };

  let pkpass: Uint8Array;
  try {
    pkpass = await passBauen({ reise, teile: teile || [], barcode, p12b64, passwort });
  } catch (e) {
    return { status: 500, daten: { error: e instanceof Error ? e.message : 'Pass konnte nicht gebaut werden' } };
  }

  const pfad = `${reiseId}/wallet.pkpass`;
  const { error: hochFehler } = await admin.storage.from('dienstreise-tickets')
    .upload(pfad, new Blob([new Uint8Array(pkpass)], { type: 'application/vnd.apple.pkpass' }), { upsert: true, contentType: 'application/vnd.apple.pkpass' });
  if (hochFehler) return { status: 500, daten: { error: hochFehler.message } };
  const { data: link } = await admin.storage.from('dienstreise-tickets').createSignedUrl(pfad, 3600);
  // Der Server signiert mit seiner internen Adresse (http://kong:8000), das Handy braucht die oeffentliche.
  const intern = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  const oeffentlich = (Deno.env.get('TRISAR_OEFFENTLICHE_URL') || 'https://fahrer.trisar.de/supabase').replace(/\/+$/, '');
  const url = link?.signedUrl && intern && link.signedUrl.startsWith(intern)
    ? oeffentlich + link.signedUrl.slice(intern.length)
    : link?.signedUrl || '';
  return { status: 200, daten: { ok: true, url, pfad } };
};
