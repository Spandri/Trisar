// Namen aus der Frage an die echten Namen in der Datenbank angleichen (13.11.).
// Die Spracherkennung hoert Nachnamen oft falsch („Stefano Baldri“ statt „Stefano Spandri“),
// beim Tippen passieren Tippfehler. Bevor irgendeine Regel oder das Modell die Frage liest,
// werden solche Namen auf den bekannten Fahrer oder Gast umgeschrieben.
//
// Regeln (vorsichtig, damit normale Woerter nie zu Namen werden):
// - Vorname exakt + naechstes Wort aehnlich zum Nachnamen (Abstand hoechstens die Haelfte) -> ganzer Name.
// - Vorname aehnlich + Nachname exakt -> ganzer Name.
// - Nachname allein mit kleinem Tippfehler (ab 5 Buchstaben, Abstand hoechstens ein Viertel) -> Nachname.
// Gilt nur, wenn genau eine Person passt.

// deno-lint-ignore-file no-explicit-any
const klein = (t: string) => String(t || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const abstand = (a: string, b: string) => {
  if (a === b) return 0;
  const z = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let vorher = z[0];
    z[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const merk = z[j];
      z[j] = Math.min(z[j] + 1, z[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1));
      vorher = merk;
    }
  }
  return z[b.length];
};

// Woerter, die nie als falsch gehoerter Name gelten (haeufig direkt nach einem Vornamen).
const NIE_NAME = new Set([
  'soll', 'sollen', 'hat', 'ist', 'war', 'wird', 'kann', 'muss', 'darf', 'faehrt', 'fahren', 'faehrst', 'kommt', 'heute',
  'morgen', 'gestern', 'jetzt', 'gerade', 'noch', 'schon', 'auch', 'bitte', 'und', 'oder', 'aber', 'mit', 'von', 'vom',
  'nach', 'zum', 'zur', 'um', 'ab', 'bis', 'an', 'am', 'auf', 'in', 'im', 'ins', 'fuer', 'bei', 'beim', 'die', 'der',
  'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'sein', 'seine', 'ihr', 'ihre', 'dienst', 'fahrt', 'fahrten',
  'feierabend', 'pause', 'standby', 'uhr', 'nachricht', 'sagen', 'sag', 'schreib', 'schicken', 'schick', 'anrufen',
  'abholen', 'bringen', 'ohne', 'gast', 'gaeste', 'angenommen', 'annehmen', 'losfahren', 'da', 'dort', 'hier',
]);

type Person = { vor: string; nach: string };

export const namenAngleichenText = (frage: string, personen: Person[]) => {
  const leute = personen
    .map((p) => ({ vor: String(p.vor || '').trim(), nach: String(p.nach || '').trim() }))
    .filter((p) => p.vor && p.nach && !/\s/.test(p.nach) && p.nach.length >= 3);
  if (!leute.length) return { text: frage, ersetzt: [] as string[] };
  // Woerter mit Position, damit Satzzeichen und Abstaende erhalten bleiben.
  const teile = String(frage).split(/(\s+)/);
  const wortIdx = teile.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0);
  const kern = (t: string) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  const ersetzt: string[] = [];
  const ersetzen = (i: number, neu: string) => {
    const alt = teile[i];
    const k = kern(alt);
    if (!k || k === neu) return;
    teile[i] = alt.replace(k, neu);
    ersetzt.push(`${k} -> ${neu}`);
  };
  const genauEiner = <T>(liste: T[]) => (liste.length === 1 ? liste[0] : null);
  const bekannteNach = new Set(leute.map((p) => klein(p.nach)));

  for (let n = 0; n < wortIdx.length; n += 1) {
    const a = kern(teile[wortIdx[n]]);
    const b = n + 1 < wortIdx.length ? kern(teile[wortIdx[n + 1]]) : '';
    const ka = klein(a);
    const kb = klein(b);
    if (!ka) continue;

    // Vorname exakt, Nachname falsch gehoert.
    if (kb && kb.length >= 3 && !NIE_NAME.has(kb) && !bekannteNach.has(kb)) {
      const p = genauEiner(leute.filter((x) => klein(x.vor) === ka
        && abstand(kb, klein(x.nach)) <= Math.ceil(klein(x.nach).length / 2)));
      if (p) { ersetzen(wortIdx[n + 1], p.nach); n += 1; continue; }
    }
    // Vorname falsch, Nachname exakt.
    if (kb && bekannteNach.has(kb) && ka.length >= 3 && !NIE_NAME.has(ka)) {
      const p = genauEiner(leute.filter((x) => klein(x.nach) === kb && klein(x.vor) !== ka
        && abstand(ka, klein(x.vor)) <= Math.max(1, Math.floor(klein(x.vor).length / 3))));
      if (p) { ersetzen(wortIdx[n], p.vor); n += 1; continue; }
    }
    // Nachname allein mit Tippfehler.
    if (ka.length >= 5 && !NIE_NAME.has(ka) && !bekannteNach.has(ka) && /^\p{Lu}/u.test(a)) {
      const p = genauEiner(leute.filter((x) => {
        const kn = klein(x.nach);
        return kn.length >= 5 && abstand(ka, kn) <= Math.floor(kn.length / 4);
      }));
      if (p) ersetzen(wortIdx[n], p.nach);
    }
  }
  return { text: teile.join(''), ersetzt };
};

// Fahrer, Disponenten und Gaeste aus der Datenbank.
export const namenAngleichen = async (admin: any, frage: string) => {
  try {
    const [{ data: profile }, { data: gaeste }] = await Promise.all([
      admin.from('profiles').select('first_name, last_name').limit(2000),
      admin.from('guests').select('first_name, last_name').limit(5000),
    ]);
    const personen = [...(profile || []), ...(gaeste || [])]
      .map((p: any) => ({ vor: p?.first_name || '', nach: p?.last_name || '' }));
    // Doppelte (gleicher Name als Fahrer und Gast) zaehlen nur einmal.
    const einmal = [...new Map(personen.map((p) => [`${klein(p.vor)} ${klein(p.nach)}`, p])).values()];
    return namenAngleichenText(frage, einmal);
  } catch {
    return { text: frage, ersetzt: [] as string[] };
  }
};
