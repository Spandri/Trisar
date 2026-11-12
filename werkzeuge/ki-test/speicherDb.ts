// Datenbank im Speicher fuer den Testsatz des KI-Assistenten.
// Ahmt die Teile des Supabase-Clients nach, die ki.ts, kiKern.js und dienst.ts benutzen:
// from(t).select().eq().neq().in().lt().lte().gt().gte().order().limit().maybeSingle().single()
// sowie insert/update/upsert/delete. Schreibzugriffe landen nur hier im Speicher und im Log.

// deno-lint-ignore-file no-explicit-any
type Zeile = Record<string, any>;
type Filter = (z: Zeile) => boolean;

export class SpeicherDb {
  tabellen: Record<string, Zeile[]>;
  schreibLog: { tabelle: string; art: string; daten: any }[] = [];

  constructor(tabellen: Record<string, Zeile[]>) {
    this.tabellen = structuredClone(tabellen);
  }

  from(tabelle: string) {
    return new Abfrage(this, tabelle);
  }

  // Wird von kiKern nicht genutzt, aber manche Pfade pruefen auth.
  auth = {
    getUser: async () => ({ data: { user: null }, error: null }),
    // Konto anlegen (KI legt Fahrer an, anlegen.ts): nur im Speicher, Log wie bei Tabellen.
    admin: {
      createUser: async (daten: any) => {
        const id = crypto.randomUUID();
        this.schreibLog.push({ tabelle: 'auth.users', art: 'insert', daten: { id, email: daten?.email } });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.schreibLog.push({ tabelle: 'auth.users', art: 'delete', daten: { id } });
        return { data: null, error: null };
      },
    },
  };
}

const vergleich = (a: any, b: any) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
};

class Abfrage {
  private filter: Filter[] = [];
  private sortierung: { spalte: string; auf: boolean }[] = [];
  private grenze: number | null = null;
  private art: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private neu: Zeile[] = [];
  private aenderung: Zeile = {};
  private einzeln: 'maybe' | 'genau' | null = null;
  private mitRueckgabe = false;

  constructor(private db: SpeicherDb, private tabelle: string) {}

  private zeilen() {
    if (!this.db.tabellen[this.tabelle]) this.db.tabellen[this.tabelle] = [];
    return this.db.tabellen[this.tabelle];
  }

  select(_spalten?: string) {
    if (this.art !== 'select') this.mitRueckgabe = true;
    return this;
  }
  eq(s: string, w: any) { this.filter.push((z) => String(z[s]) === String(w)); return this; }
  neq(s: string, w: any) { this.filter.push((z) => String(z[s]) !== String(w)); return this; }
  in(s: string, werte: any[]) { const m = new Set((werte || []).map(String)); this.filter.push((z) => m.has(String(z[s]))); return this; }
  lt(s: string, w: any) { this.filter.push((z) => vergleich(z[s], w) < 0); return this; }
  lte(s: string, w: any) { this.filter.push((z) => vergleich(z[s], w) <= 0); return this; }
  gt(s: string, w: any) { this.filter.push((z) => vergleich(z[s], w) > 0); return this; }
  gte(s: string, w: any) { this.filter.push((z) => vergleich(z[s], w) >= 0); return this; }
  is(s: string, w: any) { this.filter.push((z) => (w === null ? z[s] == null : z[s] === w)); return this; }
  ilike(s: string, muster: string) {
    const re = new RegExp(`^${String(muster).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
    this.filter.push((z) => re.test(String(z[s] ?? '')));
    return this;
  }
  order(s: string, o: { ascending?: boolean } = {}) { this.sortierung.push({ spalte: s, auf: o.ascending !== false }); return this; }
  limit(n: number) { this.grenze = n; return this; }
  maybeSingle() { this.einzeln = 'maybe'; return this; }
  single() { this.einzeln = 'genau'; return this; }

  insert(daten: Zeile | Zeile[]) { this.art = 'insert'; this.neu = (Array.isArray(daten) ? daten : [daten]).map((z) => ({ id: crypto.randomUUID(), ...z })); return this; }
  upsert(daten: Zeile | Zeile[]) { this.art = 'upsert'; this.neu = Array.isArray(daten) ? daten : [daten]; return this; }
  update(daten: Zeile) { this.art = 'update'; this.aenderung = daten; return this; }
  delete() { this.art = 'delete'; return this; }

  private ausfuehren(): { data: any; error: null } {
    const passt = (z: Zeile) => this.filter.every((f) => f(z));
    const alle = this.zeilen();
    let ergebnis: Zeile[] = [];
    if (this.art === 'select') {
      ergebnis = alle.filter(passt);
      for (const { spalte, auf } of [...this.sortierung].reverse()) {
        ergebnis = [...ergebnis].sort((a, b) => (auf ? 1 : -1) * vergleich(a[spalte], b[spalte]));
      }
      if (this.grenze != null) ergebnis = ergebnis.slice(0, this.grenze);
      ergebnis = structuredClone(ergebnis);
    } else {
      this.db.schreibLog.push({ tabelle: this.tabelle, art: this.art, daten: this.art === 'update' ? this.aenderung : this.neu });
      if (this.art === 'insert') { alle.push(...this.neu); ergebnis = this.neu; }
      if (this.art === 'upsert') {
        for (const z of this.neu) {
          const schluessel = 'id' in z ? 'id' : Object.keys(z)[0];
          const i = alle.findIndex((a) => a[schluessel] === z[schluessel]);
          if (i >= 0) alle[i] = { ...alle[i], ...z }; else alle.push(z);
        }
        ergebnis = this.neu;
      }
      if (this.art === 'update') { ergebnis = alle.filter(passt); ergebnis.forEach((z) => Object.assign(z, this.aenderung)); }
      if (this.art === 'delete') { ergebnis = alle.filter(passt); this.db.tabellen[this.tabelle] = alle.filter((z) => !passt(z)); }
      if (!this.mitRueckgabe && this.einzeln == null) return { data: null, error: null };
    }
    if (this.einzeln) return { data: ergebnis[0] ?? null, error: null };
    return { data: ergebnis, error: null };
  }

  then(ok: (w: any) => any, fehler?: (e: any) => any) {
    try {
      return Promise.resolve(this.ausfuehren()).then(ok, fehler);
    } catch (e) {
      return Promise.reject(e).then(ok, fehler);
    }
  }
}
