#!/usr/bin/env python3
"""KBA-Typliste (SV 4.2, Pkw/Klasse M) in eine Migration fuer public.kba_typen umwandeln.

Quelle: Kraftfahrt-Bundesamt, "Verzeichnis der Hersteller und Typen ... (Klasse M)", SV 4.2.
PDF liegt daneben (sv42_<stand>.pdf), herunterladbar unter
https://www.kba.de/SharedDocs/Downloads/DE/SV/sv42_pdf.pdf?__blob=publicationFile

Aufruf (pdftotext von poppler noetig):
  python3 werkzeuge/kba/kba_typen.py werkzeuge/kba/sv42_2026-08-15.pdf 2026-08-15 \
      > fahrer/supabase/migrations/<zeit>_kba_typen_daten.sql

Bei neuer KBA-Liste: PDF ersetzen, neu erzeugen, als neue Migration einspielen (truncate + insert).
"""
import re
import subprocess
import sys

# Kraftstoffcode (Spalte 9) -> Wert im Kraftstoff-Feld der Apps. Aus den Modellen je Code abgeleitet
# (0010 = 520d/X7 40d, 0025 = 530e/A6 55 TFSI e, 0026 = Q7 e-tron), die SV-1-Liste lag nicht vor.
KRAFTSTOFF_APP = {
    '0001': 'Super 95',        # Benzin
    '0002': 'Diesel B7',       # Diesel
    '0004': 'Elektro',
    '0008': 'Super 95',        # Hybrid Benzin/Elektro (nicht extern ladbar)
    '0010': 'Diesel B7',       # Hybrid Diesel/Elektro (nicht extern ladbar)
    '0025': 'Plug-in-Hybrid',  # Hybrid Benzin/Elektro, extern ladbar
    '0026': 'Plug-in-Hybrid',  # Hybrid Diesel/Elektro, extern ladbar
}

MARKEN = {'AUDI': 'Audi', 'VOLKSWAGEN, VW': 'VW', 'MERCEDES-BENZ': 'Mercedes-Benz'}


def marke_schoen(m):
    m = m.strip()
    if m in MARKEN:
        return MARKEN[m]
    if m.isupper() and len(m) > 3 and ' ' not in m and '-' not in m:
        return m.capitalize()
    return m


def modell_und_variante(marke, handelsname):
    """'BMW', 'X7 xDrive40d' -> ('BMW X7', 'xDrive40d'). Nur Vorschlag, die Dispo kann aendern."""
    h = handelsname.split(',')[0].split(';')[0].strip()
    if not h:
        return marke or None, None
    if marke == 'Mercedes-Benz':
        m = re.match(r'^(AMG )?([ABCESGV]) \d', h)
        if m:
            return f'Mercedes-Benz {m.group(2)}-Klasse', h
    if marke == 'BMW':
        m = re.match(r'^(\w+) Reihe$', h)
        if m:
            return f'BMW {m.group(1)}', None
        m = re.match(r'^(\d)\d\d[a-z]{0,2}\b', h)
        if m:
            return f'BMW {m.group(1)}er', h
    if marke and h.upper().startswith(marke.upper() + ' '):
        h = h[len(marke) + 1:].strip()
    teile = h.split(' ', 1)
    if marke == 'Audi' and len(teile) == 2 and teile[1].split()[0] in ('Limousine', 'Avant', 'Sportback', 'allroad', 'Cabriolet', 'Coupe'):
        return f'{marke} {h}', None
    name = f'{marke} {teile[0]}'.strip() if marke else teile[0]
    return name, (teile[1].strip() if len(teile) == 2 else None)


def zahlen_zuordnen(z, kraftstoff):
    """Spalten 10-15: kW, Hubraum, Achsen, Antriebsachsen, Sitze, Masse. Leere Spalten fehlen im Text."""
    leer = dict(kw=None, hubraum=None, achsen=None, antriebsachsen=None, sitze=None, masse=None)
    z = [int(x) for x in z]
    if len(z) == 6:
        return dict(zip(leer, z))
    if len(z) == 5:
        if z[1] <= 5:  # Hubraum fehlt (Elektro)
            return dict(kw=z[0], hubraum=None, achsen=z[1], antriebsachsen=z[2], sitze=z[3], masse=z[4])
        return dict(kw=z[0], hubraum=z[1], achsen=z[2], antriebsachsen=z[3], sitze=None, masse=z[4])
    if len(z) == 4 and z[1] <= 5:
        return dict(kw=z[0], hubraum=None, achsen=z[1], antriebsachsen=z[2], sitze=None, masse=z[3])
    return None


def zeilen(text):
    for l in text.splitlines():
        m = re.match(r'^(\d{4})\s+([A-Z0-9]{3})\s+(.*)$', l.rstrip())
        if not m:
            continue
        hsn, tsn, rest = m.groups()
        d = re.search(r'\s(\d\d)\.(\d\d)\.(\d{4})\s', ' ' + rest + ' ')
        if not d:
            continue
        vor = (' ' + rest)[:d.start()].strip()
        nach = (' ' + rest + ' ')[d.end():].split()
        teile = re.split(r'\s{2,}', vor)
        if len(teile) >= 3:
            hersteller, marke, handelsname = teile[0], teile[1], ' '.join(teile[2:])
        elif len(teile) == 2:
            hersteller, marke, handelsname = teile[0], '', teile[1]
        else:
            hersteller, marke, handelsname = teile[0], '', ''
        if not nach:
            continue
        klasse = nach[0]
        i = 1
        aufbau = None
        if i < len(nach) and (re.fullmatch(r'[A-Z]{2}', nach[i]) or (re.fullmatch(r'\d{4}', nach[i]) and i + 1 < len(nach) and re.fullmatch(r'\d{4}', nach[i + 1]))):
            aufbau = nach[i]
            i += 1
        if i >= len(nach) or not re.fullmatch(r'\d{4}', nach[i]):
            continue
        kraftstoff = nach[i]
        werte = zahlen_zuordnen(nach[i + 1:], kraftstoff)
        if werte is None:
            continue
        marke_s = marke_schoen(marke) if marke else ''
        modell, variante = modell_und_variante(marke_s, handelsname)
        yield dict(
            hsn=hsn, tsn=tsn, hersteller=hersteller, marke=marke_s or None, handelsname=handelsname or None,
            zugeteilt=f'{d.group(3)}-{d.group(2)}-{d.group(1)}', klasse=klasse, aufbau=aufbau,
            kraftstoff_code=kraftstoff, brand_model=modell, trim=variante,
            fuel_type=KRAFTSTOFF_APP.get(kraftstoff), **werte,
        )


def sql(v):
    if v is None:
        return 'null'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


SPALTEN = ['hsn', 'tsn', 'hersteller', 'marke', 'handelsname', 'zugeteilt', 'klasse', 'aufbau', 'kraftstoff_code',
           'kw', 'hubraum', 'achsen', 'antriebsachsen', 'sitze', 'masse', 'brand_model', 'trim', 'fuel_type']


def main():
    pdf, stand = sys.argv[1], sys.argv[2]
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    alle = {}
    for z in zeilen(text):
        alle[(z['hsn'], z['tsn'])] = z
    print(f'-- KBA-Typliste SV 4.2 (Klasse M), Stand {stand}. Quelle: Kraftfahrt-Bundesamt.')
    print('-- Erzeugt mit werkzeuge/kba/kba_typen.py, nicht von Hand aendern.')
    print('truncate public.kba_typen;')
    werte = list(alle.values())
    for i in range(0, len(werte), 1000):
        print(f'insert into public.kba_typen ({", ".join(SPALTEN)}) values')
        print(',\n'.join('(' + ', '.join(sql(z[s]) for s in SPALTEN) + ')' for z in werte[i:i + 1000]) + ';')
    print(f"comment on table public.kba_typen is 'KBA SV 4.2 Klasse M, Stand {stand}, Quelle: Kraftfahrt-Bundesamt';")
    print(f'-- {len(werte)} Typen', file=sys.stderr)


if __name__ == '__main__':
    main()
