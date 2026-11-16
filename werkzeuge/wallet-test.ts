// Lokaler Test des Wallet-Passes (Dienstreise): Ticket-PDF lesen, Pass mit dem echten Zertifikat bauen,
// auf dem Schreibtisch ablegen. Aufruf ueber werkzeuge/wallet-test.sh (fragt das Passwort ab).
import { getDocumentProxy } from 'https://esm.sh/unpdf@1.0.5';
import { dbTicketLesen } from '../fahrer/supabase/functions/dispo-admin/ticket.ts';
import { barcodeLesen, passBauen } from '../fahrer/supabase/functions/dispo-admin/wallet.ts';

const [ticketPfad, p12Pfad, ziel] = Deno.args;
const pdfBytes = new Uint8Array(await Deno.readFile(ticketPfad));
const pdf = await getDocumentProxy(pdfBytes.slice());
const seite = await pdf.getPage(1);
const stuecke: { x: number; y: number; text: string }[] = [];
for (const it of (await seite.getTextContent()).items as Array<{ str?: string; transform?: number[] }>) {
  const t = String(it.str || '').trim();
  if (t) stuecke.push({ x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, text: t });
}
const g = dbTicketLesen(stuecke, stuecke.map((s) => s.text).join(' '));
if (!g) { console.error('Kein DB-Ticket erkannt.'); Deno.exit(1); }
const teile = g.abschnitte.map((a) => ({
  art: a.art, nummer: a.nummer, von_name: a.von, nach_name: a.nach, ab_zeit: a.ab, an_zeit: a.an, gleis_ab: a.gleis_ab, gleis_an: a.gleis_an,
}));
const reise = {
  id: crypto.randomUUID(), datum: g.datum, start_name: g.abschnitte[0].von, ziel_name: g.abschnitte.at(-1)?.nach,
  start_zeit: g.abschnitte[0].ab, reisender: g.name, auftragsnummer: g.auftragsnummer,
  notiz: `TEST ${[g.tarif, g.klasse].filter(Boolean).join(', ')}`,
};
const barcode = await barcodeLesen(pdfBytes.slice());
if (!barcode) { console.error('Kein Barcode gefunden.'); Deno.exit(1); }
const p12b64 = btoa(String.fromCharCode(...await Deno.readFile(p12Pfad)));
const pkpass = await passBauen({ reise, teile, barcode, p12b64, passwort: Deno.env.get('WALLET_PASSWORT') ?? '' });
await Deno.writeFile(ziel, pkpass);
console.log(`Pass gebaut: ${ziel} (${pkpass.length} Bytes, Barcode ${barcode.length} Bytes, ${teile.length} Abschnitte)`);
