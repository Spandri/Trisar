#!/usr/bin/env python3
"""Neue TRISAR-Icons im Stil der vorhandenen Figma-Icons (Frame 48).

Stil: 36er Raster, Linie 3,5 px, stumpfe Enden, spitze Ecken, Container mit runden Ecken.
Aufruf: python3 icons.py  ->  svg/<name>.svg je Icon und TRISAR-Icons-neu.svg (Bogen fuer Figma).
"""
import os

SW = 3.5


def p(d):
    return f'<path d="{d}"/>'


def r(x, y, w, h, rx=0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'


def c(x, y, rad):
    return f'<circle cx="{x}" cy="{y}" r="{rad}"/>'


BOX = r(2.75, 2.75, 30.5, 30.5, 6)
RING = c(18, 18, 15.25)

ICONS = {
    # Orte
    "hotel": [r(6.75, 2.75, 22.5, 31.5), p("M13 9V19M23 9V19M13 14H23"), p("M15 34V26H21V34")],
    "bett": [p("M3.75 5V32"), p("M2 26H32.25V32"), p("M32.25 26V19H15V26"), c(9, 20, 2.75)],
    "flughafen-tower": [p("M8 6.75H28L25 15.25H11Z"), p("M18 0V6"), p("M14.75 15V34M21.25 15V34"), p("M8 32.25H28")],
    "bahnhof-zug": [r(6.75, 2.75, 22.5, 24, 5), p("M7 14.5H29"), p("M12 20.5H15M21 20.5H24"), p("M12 27L8 34M24 27L28 34")],
    # Hauptbahnhof (20.11.): Halle mit Zug, Empfangsgebaeude mit Uhrturm
    "hauptbahnhof": [p("M2.75 33V16A15.25 12.25 0 0 1 33.25 16V33"), r(11.75, 17.75, 12.5, 11.5, 3), p("M12 23.5H24"),
                     p("M14 29L11.5 34M22 29L24.5 34")],
    "hauptbahnhof-gebaeude": [p("M2 32.25H34"), p("M3.75 32V17.75H12.75"), p("M23.25 17.75H32.25V32"), r(12.75, 3.75, 10.5, 28.5),
                              c(18, 11, 2.25), p("M15.75 32V23.5H20.25V32"), p("M6.5 23.5H10M26 23.5H29.5")],
    "u-bahn": [BOX, p("M11.75 9V19A6.25 6.25 0 0 0 24.25 19V9")],
    "bus": [r(4.75, 3.75, 26.5, 24.5, 4), p("M5 16.5H31"), p("M9 22.5H13M23 22.5H27"), p("M9.75 28V33M26.25 28V33")],
    "taxi": [p("M8 15L11.5 7.75H24.5L28 15"), p("M3.75 15.25H32.25V27.25H3.75Z"), p("M8.5 21H13.5M22.5 21H27.5"),
             p("M8.75 27V33M27.25 27V33"), p("M14.75 8V2.75H21.25V8")],
    "auto": [p("M8 13L11.5 5.75H24.5L28 13"), p("M3.75 13.25H32.25V26.25H3.75Z"), p("M8.5 19.5H13.5M22.5 19.5H27.5"),
             p("M8.75 26V32M27.25 26V32")],
    "shuttle-van": [p("M5.5 26.25H2.75V7.75H21L33.25 17V26.25H30.5"), p("M14.5 26.25H21.5"), p("M21 8V17H33"),
                    c(10, 26.5, 4.25), c(26, 26.5, 4.25)],
    "messe-halle": [p("M3.75 32.25V14L12.5 8V14L21.25 8V14L30 8H32.25V32.25Z"), p("M15 32V24H21V32")],
    "restaurant": [p("M7.75 2V10A4.25 4.25 0 0 0 16.25 10V2"), p("M12 2V34"), p("M23.75 34V2.75H25.25A7 7 0 0 1 32.25 9.75V21.25H24")],
    "bar": [p("M4.5 4.75H31.5L18 19Z"), p("M18 18V32"), p("M10 32.25H26")],
    "kaffee": [p("M4.75 12.75H25.25V24A6.25 6.25 0 0 1 19 30.25H11A6.25 6.25 0 0 1 4.75 24Z"),
               p("M25 15.75H28A4 4 0 0 1 28 23.75H25"), p("M11 3V8.5M19 3V8.5"), p("M3 34.25H27")],
    "buero": [r(7.75, 2.75, 20.5, 31.5), p("M13.5 9.5H22.5M13.5 15.5H22.5M13.5 21.5H22.5"), p("M18 34V27")],
    "zuhause": [p("M2.5 18L18 4.5L33.5 18"), p("M7.75 14V32.25H28.25V14"), p("M14.75 32V22.75H21.25V32")],
    "krankenhaus": [BOX, p("M18 10V26M10 18H26")],
    "parkplatz": [BOX, p("M13.75 27V10.75H19A4.75 4.75 0 0 1 19 20.25H14")],
    "tankstelle": [p("M5.75 33V3.75H20.25V33"), p("M2 32.25H24"), p("M6 14.5H20"),
                   p("M20 18.75H23.5A3 3 0 0 1 26.5 21.75V27A2.75 2.75 0 0 0 32 27V12.5L27 7.5")],
    "einkaufen": [p("M5.75 11.75H30.25V32.25H5.75Z"), p("M11.75 17V9.5A6.25 6.25 0 0 1 24.25 9.5V17")],
    "berge": [p("M3 31.25L13.5 10L19 20L23.5 13.5L33 31.25Z")],
    "hafen-schiff": [p("M3 21.75H33L28 31.25H8Z"), p("M9.75 22V13.75H26.25V22"), p("M18 14V6"), p("M14 7.75H22")],
    # Gebaeude
    "flughafen-terminal": [p("M2.75 32.25V17A15.25 11 0 0 1 33.25 17V32.25Z"), p("M3 21.5H33"), p("M13 21.5V32M23 21.5V32")],
    "bahnhof-gebaeude": [p("M3.75 16.25H32.25V32.25H3.75Z"), p("M9.75 16V3.75H26.25V16"), c(18, 10, 3), p("M14.75 32V24.75H21.25V32")],
    "kongress": [p("M2 9.75H34"), p("M5.75 10V32.25H30.25V10"), p("M13.75 16V32M22.25 16V32")],
    "stadion": ['<ellipse cx="18" cy="18" rx="15.25" ry="11.25"/>', '<ellipse cx="18" cy="18" rx="7" ry="3.75"/>'],
    "museum-bank": [p("M3.5 13.25L18 4.25L32.5 13.25Z"), p("M8.75 13V30M18 13V30M27.25 13V30"), p("M3 31.25H33")],
    "rathaus": [p("M11.25 12A6.75 6.75 0 0 1 24.75 12"), p("M18 5V0"), p("M3 13.75H33"), p("M8.75 15V30M18 15V30M27.25 15V30"), p("M3 31.25H33")],
    "kirche": [p("M18 0V9M14.25 4H21.75"), p("M9.75 33V15.5L18 8.5L26.25 15.5V33"), p("M5 32.25H31"),
               p("M14.75 32V26A3.25 3.25 0 0 1 21.25 26V32")],
    "burg-schloss": [p("M3.75 33V5.75H10V10.75H14.9V5.75H21.1V10.75H26V5.75H32.25V33"), p("M2 32.25H34"),
                     p("M14.75 32V24.5A3.25 3.25 0 0 1 21.25 24.5V32")],
    "universitaet": [p("M3 13L18 6L33 13L18 20Z"), p("M9.75 17V25.5C9.75 29 26.25 29 26.25 25.5V17"), p("M32.25 13V25")],
    "fabrik": [p("M3.75 32.25V18L12.5 12V18L21.25 12V18H25.75V3.75H32.25V32.25Z"), p("M9 25.5H14M18 25.5H23")],
    "lager": [p("M2.75 33V15A15.25 9 0 0 1 33.25 15V33"), p("M11.75 33V21.75H24.25V33")],
    "garage-werkstatt": [p("M2.75 33V12.5L18 4.5L33.25 12.5V33"), p("M9.75 33V17.75H26.25V33"), p("M10 23H26M10 28H26")],
    "stadt-hochhaeuser": [p("M3.75 33V3.75H19.25V33"), p("M19 14.75H32.25V33"), p("M9 10.5H14M9 17.5H14M9 24.5H14"),
                          p("M23.5 21.5H28"), p("M1 32.25H35")],
    "hochhaus": [p("M9.75 33V7.75H26.25V33"), p("M18 8V1"), p("M15 14H21M15 20H21M15 26H21"), p("M5 32.25H31")],
    "parkhaus": [p("M2.5 13.5L18 4.5L33.5 13.5"), p("M5.75 12V33M30.25 12V33"), p("M14.25 33V16.75H18.5A4 4 0 0 1 18.5 24.75H14.5")],
    "ladestation": [p("M5.75 33V3.75H22.25V33"), p("M2 32.25H26"), p("M15.5 8.5L11.25 17.5H16.75L12.5 26.5"),
                    p("M22 12.75H26A4 4 0 0 1 30 16.75V26"), p("M26.5 27.75H33.5")],
    "geschaeft": [p("M3.5 14.25L6.5 4.75H29.5L32.5 14.25Z"), p("M5.75 14V32.25H30.25V14"), p("M18.75 32V21.75H25.25V32"), p("M10 21.75H14.5")],
    "apotheke": [p("M13 2.75H23V13H33.25V23H23V33.25H13V23H2.75V13H13Z")],
    "sicherheit-polizei": [p("M18 2.75L31.25 7.5V17C31.25 25 25 31 18 33.5C11 31 4.75 25 4.75 17V7.5Z"), p("M12 17.5L16.5 22L24.5 13")],
    "botschaft": [p("M5.75 33V14.75H30.25V33"), p("M2 32.25H34"), p("M16.75 15V1"), p("M17 2.75H27V9.25H17"), p("M12.5 20V32M23.5 20V32")],
    "festzelt": [p("M2 32.25H34"), p("M4.5 32L18 5.5L31.5 32"), p("M12.5 32L18 19.5L23.5 32"), p("M18 5.5V0")],
    "fernsehturm": [p("M18 0V8"), c(18, 13, 5), p("M18 18V34"), p("M10 32.25H26")],
    "bruecke": [p("M1 22.25H35"), p("M5.75 34V7M30.25 34V7"), p("M5.75 8.5Q18 27 30.25 8.5")],
    "fitness": [p("M9 18H27"), p("M7.75 9V27M28.25 9V27"), p("M2.75 13.5V22.5M33.25 13.5V22.5")],
    "kino": [r(2.75, 5.75, 30.5, 24.5, 5), p("M14.5 12L23.5 18L14.5 24Z")],
    "biergarten": [p("M5.75 9.75H23.25V32.25H5.75Z"), p("M23 14.75H27.5A3.75 3.75 0 0 1 31.25 18.5V23.5A3.75 3.75 0 0 1 27.5 27.25H23"),
                   p("M11.5 16V26M17.5 16V26"), p("M3 4.75H26")],
    # Zeit und Planung
    "uhr": [RING, p("M18 8.5V18L24.5 22.5")],
    "kalender": [r(2.75, 5.75, 30.5, 27.5, 5), p("M3 15H33"), p("M10.5 2V9.5M25.5 2V9.5")],
    "tag-sonne": [c(18, 18, 6.25), p("M18 1V6.5M18 29.5V35M1 18H6.5M29.5 18H35"),
                  p("M6 6L9.9 9.9M26.1 26.1L30 30M30 6L26.1 9.9M9.9 26.1L6 30")],
    "nacht-mond": ['<path stroke-linejoin="round" d="M31 21.5A14 14 0 1 1 14.5 5A11.5 11.5 0 0 0 31 21.5Z"/>'],
    "regen-schirm": [p("M2.75 18.25A15.25 15.25 0 0 1 33.25 18.25Z"), p("M18 18V29A3.25 3.25 0 0 0 24.5 29")],
    # Fahrt
    "ziel-flagge": [p("M6.75 34V3"), p("M6 5.25H30.5L24.5 12L30.5 18.75H6")],
    "route": [c(7, 28.25, 4), c(29, 7.75, 4), p("M11 28.25H22.5A5.1 5.1 0 0 0 22.5 18H13.5A5.1 5.1 0 0 1 13.5 7.75H25")],
    "navigation": [p("M18 4.5L30.5 31L18 25L5.5 31Z")],
    "lenkrad-fahrer": [RING, c(18, 18, 3.5), p("M3 16.5H14.5M21.5 16.5H33M18 21.5V33")],
    "schluessel": [c(9.5, 18, 6.75), p("M16 18H34"), p("M26.25 18V25M31.75 18V23")],
    "fahrrad": [c(7.75, 25, 6), c(28.25, 25, 6), p("M7.75 25L13 12.5"), p("M9.5 10.25H16.5"),
                p("M12 15.25H24.5L18 25"), p("M28.25 25L23.25 7.75H28.5")],
    "rollkoffer": [r(7.75, 9.75, 20.5, 20.5, 4), p("M13 10V2.75H23V10"), p("M12.25 30V34M23.75 30V34"), p("M14 16V24M22 16V24")],
    "ticket": [p("M2.75 7.75H33.25V14A4 4 0 0 0 33.25 22V28.25H2.75V22A4 4 0 0 0 2.75 14Z"), p("M22 11V15.5M22 20.5V25")],
    # Gast und Anlass
    "vip-krone": [p("M5 26.25L3 9L12 16.5L18 5L24 16.5L33 9L31 26.25Z"), p("M5 32.25H31")],
    "musik-band": [c(8.75, 27.5, 4.25), c(25.75, 24.5, 4.25), p("M13 27.5V7L30 3.5V24.5")],
    "mikrofon-kongress": [r(12.25, 1.75, 11.5, 19.5, 5.75), p("M6 15A12 12 0 0 0 30 15"), p("M18 27V33"), p("M11 32.75H25")],
    "international": [RING, p("M3 18H33"), '<ellipse cx="18" cy="18" rx="6.5" ry="15.25"/>'],
    # Verwaltung
    "kreditkarte": [r(1.75, 5.75, 32.5, 24.5, 5), p("M2 14H34"), p("M8 22.5H15")],
    "dokument": [p("M6.75 2.75H22L29.25 10V33.25H6.75Z"), p("M13 17.5H23M13 24.5H23")],
    "glocke": [p("M6.25 27V17A11.75 11.75 0 0 1 29.75 17V27"), p("M2.5 27.25H33.5"), p("M14.5 32.75H21.5")],
    "schloss": [r(4.75, 15.75, 26.5, 18.5, 4), p("M10.75 16V10.5A7.25 7.25 0 0 1 25.25 10.5V16")],
    "info": [RING, p("M18 16V27M18 9V12.75")],
    "warnung": [p("M18 5L33 31.25H3Z"), p("M18 14V22.5M18 24.75V28.25")],
    "check": [p("M3.5 19L13.5 29L32.5 7.5")],
    "schliessen": [p("M6 6L30 30M30 6L6 30")],
    "plus": [p("M18 4V32M4 18H32")],
}

# Fertige Zeichnungen aus Figma (Trisar_App_01), 1:1 uebernommen und nur ins 36er Feld gesetzt.
# {f} = Farbe. Eigene Strichstaerke, daher nicht im Bogen fuer Figma (der ist nur fuer die Linien-Icons oben).
_HOTEL_FASSADE_STRICHE = [
    "M0 16.2598H20.064", "M0 5.93359H20.064", "M0 4.4834H20.064",
    "M1.36606 6.12012V15.0131L1.02539 15.4171V16.0192", "M2.9375 6.12012V15.0131L3.27421 15.4171V16.0192",
    "M5.16874 6.12012V15.0131L4.83203 15.4171V16.0192", "M6.74219 6.12012V15.0131L7.08286 15.4171V16.0192",
    "M13.2391 6.12012V15.0131L12.8984 15.4171V16.0192", "M14.8105 6.12012V15.0131L15.1473 15.4171V16.0192",
    "M17.0418 6.12012V15.0131L16.7051 15.4171V16.0192", "M18.6133 6.12012V15.0131L18.954 15.4171V16.0192",
    "M6.74414 10.7852H13.2209", "M13.172 9.28203H6.69531L7.91935 7.93125L10.0109 7.39648H10.3595",
    "M6.78516 9.28203H13.2579L12.0339 7.93125L9.94627 7.39648H9.59372", "M9.98047 16.265V10.9648",
    "M3.02148 12.2637H5.03779", "M15.1074 12.2637H17.1198", "M10.8633 13.7168H12.4914", "M7.51758 13.7168H9.14171",
    "M10.2495 0.549805H9.12845H7.25476L5.70985 2.09072H0.0253906",
    "M9.84375 0.549805H10.9648H12.8385L14.3794 2.09072H20.0639",
    "M11.2783 1.77832H8.79457L7.55469 2.48738L8.79457 3.19644H11.2783L12.5222 2.48738L11.2783 1.77832Z",
]
FIGMA = {
    # Figma 197:1760 (21 x 17, Striche 1,1), auf 31 px Breite gezogen
    "hotel-fassade": ('<g transform="translate(2.5 4.9) scale(1.545)" stroke="{f}" stroke-width="1.1" '
                      'stroke-linejoin="bevel">' + "".join(f'<path d="{d}"/>' for d in _HOTEL_FASSADE_STRICHE) + "</g>"),
    # Figma 793:6449 (31 x 26, Flaeche)
    **{f"flughafen-tower-t{n}": None for n in range(1, 5)},  # unten gefuellt (turm_terminal)
    "hochhaus-glas": ('<path transform="translate(2.5 5)" fill="{f}" d="M27.2856 25.0091V8.60267L14.0253 0L9.84583 1.38113V6.73225L4.02033 9.51929V25.0091H0V26H31V25.0091H27.2856ZM14.4475 4.7132L26.3066 12.1763V13.4026L14.4475 5.9395V4.7132ZM26.3066 11.0119L14.4475 3.54883V1.44926L26.3066 9.1415V11.0057V11.0119ZM13.4684 1.2263V8.2001L10.8249 6.81896V2.09957L13.4684 1.2263ZM4.99941 24.7737V24.0119L10.2497 21.5036L15.8243 24.4207L16.271 23.5412L10.2681 20.4011L4.99941 22.9219V21.708L10.2497 19.1996L15.8243 22.1167L16.271 21.2373L10.2681 18.0972L4.99941 20.6179V19.404L10.2497 16.8957L15.8243 19.8128L16.271 18.9333L10.2681 15.7932L4.99941 18.314V17.1L10.2497 14.5917L15.8243 17.5088L16.271 16.6293L10.2681 13.4893L4.99941 16.01V14.7961L10.2497 12.2878L15.8243 15.2049L16.271 14.3254L10.2681 11.1853L4.99941 13.7061V12.4921L10.2497 9.9838L15.8243 12.9009L16.271 12.0214L10.2681 8.88137L4.99941 11.4021V10.1882L10.2497 7.67985L15.8243 10.597L16.271 9.71748L14.4475 8.7637V7.15341L26.3066 14.6165V15.8428L18.4923 10.9252L17.9783 11.7675L26.3066 17.0133V18.2396L18.4923 13.3221L17.9783 14.1644L26.3066 19.4102V20.6365L18.4923 15.7189L17.9783 16.5612L26.3066 21.8071V23.0333L18.4923 18.1158L17.9783 18.9581L26.3066 24.2039V25.0772H25.7436L18.4923 20.5126L17.9783 21.3549L23.8956 25.0834H21.9497L18.4923 22.9095L17.9783 23.7518L20.0955 25.0834H4.99941V24.8542V24.7737Z"/>'),
}


def _ziffern(n, x, y, h, wt=7, wd=6, gap=2.5):
    """T und Ziffer 1-4 als Striche (keine Schrift, damit Web, iOS und Android gleich aussehen)."""
    t = f"M{x} {y}H{x + wt}M{x + wt / 2} {y}V{y + h}"
    d, m, b = x + wt + gap, y + h / 2, y + h
    z = {1: f"M{d + wd * 0.15} {y}H{d + wd * 0.6}V{b}",
         2: f"M{d} {y}H{d + wd}V{m}H{d}V{b}H{d + wd}",
         3: f"M{d} {y}H{d + wd}V{b}H{d}M{d} {m}H{d + wd}",
         4: f"M{d} {y}V{m + 1.5}H{d + wd}M{d + wd - 1.6} {y + h * 0.35}V{b}"}[n]
    return t + z


def turm_terminal(n):
    """Flughafen Tower verkleinert, darunter T1-T4 (20.11., Terminals unterscheiden)."""
    k = 0.66
    return (f'<g transform="translate({18 - 18 * k:.2f} 0) scale({k})" stroke="{{f}}" stroke-width="{2.6 / k:.3f}">'
            + "".join(ICONS["flughafen-tower"]) + "</g>"
            + f'<path stroke="{{f}}" stroke-width="2.6" d="{_ziffern(n, 10.25, 25.25, 9.5)}"/>')


for _n in range(1, 5):
    FIGMA[f"flughafen-tower-t{_n}"] = turm_terminal(_n)

STIL = f'fill="none" stroke="#000" stroke-width="{SW}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10"'


def einzel(name, teile):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">'
            f'<g id="{name}" {STIL}>{"".join(teile)}</g></svg>\n')


def bogen(farbe="#000", beschriftung=True, spalten=8, schritt=110, skala=1.0):
    zeilen = (len(ICONS) + spalten - 1) // spalten
    b = spalten * schritt + 40
    h = zeilen * schritt + 40
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{b}" height="{h}" viewBox="0 0 {b} {h}">']
    for i, (name, teile) in enumerate(ICONS.items()):
        x = 40 + (i % spalten) * schritt
        y = 30 + (i // spalten) * schritt
        stil = STIL.replace("#000", farbe)
        out.append(f'<g id="{name}" transform="translate({x},{y}) scale({skala})" {stil}>{"".join(teile)}</g>')
        if beschriftung:
            out.append(f'<text x="{x + 18 * skala}" y="{y + 36 * skala + 16}" font-family="Helvetica" font-size="9" '
                       f'text-anchor="middle" fill="#888">{name}</text>')
    out.append("</svg>")
    return "\n".join(out)


if __name__ == "__main__":
    hier = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(hier, "svg"), exist_ok=True)
    for name, teile in ICONS.items():
        with open(os.path.join(hier, "svg", name + ".svg"), "w") as f:
            f.write(einzel(name, teile))
    with open(os.path.join(hier, "TRISAR-Icons-neu.svg"), "w") as f:
        f.write(bogen())
    with open(os.path.join(hier, "vorschau.svg"), "w") as f:
        f.write(bogen(spalten=8, schritt=160, skala=3.0).replace(
            "<svg ", '<svg style="background:#fff" ', 1))
    print(len(ICONS), "Icons")
