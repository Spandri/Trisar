#!/usr/bin/env python3
"""Unsichtbare Form je Modell fuer "Schaden melden": aus den 36 Umrissen (ausgabe/<modell>-<lack>-NN.webp)
wird die Kamera des Drehtellers geschaetzt und das Volumen geschnitten (Visual Hull).

Ergebnis je Modell:
  ausgabe/<modell>-form.bin   Volumen, Lauflaengen entlang z (siehe unten)
  ausgabe/<modell>-form.json  Kamera, Raster, Grenzen, Guete

Die Apps rechnen damit:
  Tippen auf Bildpunkt (Ansicht k)  ->  Strahl von der Kamera  ->  erster belegter Wuerfel = Punkt am Auto
  Punkt am Auto  ->  Bildpunkt in jeder Ansicht, sichtbar wenn der Strahl dorthin nicht vorher auf das Auto trifft

Kamera (Bildpunkte im 800 px breiten Drehbild), Autokoordinaten in Metern: x quer (+ = links), y hoch, z (+ = vorne).
  th = k * 10 Grad (Dacia: echter Winkel aus <modell>-winkel.json),  x' = x cos th + z sin th,  z' = -x sin th + z cos th,  y' = y - h0
  y2 = y' cos phi - z' sin phi,  z2 = y' sin phi + z' cos phi,  d = D - z2
  u = cx + s*D * x'/d,  v = cy - s*D * y2/d
Der Massstab ist geschaetzt (Laenge ~4,9 m, V-Klasse 5,14 m). Die Apps benennen die Stelle deshalb nur relativ
zu den Grenzen.

form.bin: fuer ix in 0..nx-1, iy in 0..ny-1: uint8 Anzahl Laeufe, dann je Lauf uint16 z_von, uint16 z_bis
(bis ausschliesslich), little endian. Wuerfel (ix, iy, iz) liegt bei o + (i + 0.5) * schritt.

Aufruf: python3 form-bauen.py [modell ...]   (ohne Angabe alle aus ausgabe/fahrzeug-dreh.json)
        --neu  Kamera neu schaetzen, auch wenn form.json schon da ist
"""
import json, os, struct, sys, time
import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes, binary_opening, label
from scipy.optimize import minimize

HIER = os.path.dirname(os.path.abspath(__file__))
AUSGABE = os.path.join(HIER, "ausgabe")
N = 36
SCHRITT = 0.015
WINKEL = [k * 10.0 for k in range(N)]  # je Ansicht; Dacia hat nur 15-Grad-Bilder (dacia-verarbeiten.py)


def masken_laden(mid, lack):
    m = []
    for k in range(N):
        a = np.array(Image.open(os.path.join(AUSGABE, f"{mid}-{lack}-{k:02d}.webp")).convert("RGBA"))[..., 3]
        # Scheiben sind halbtransparent: Loecher fuellen, Fussel am Rand weg
        m.append(binary_opening(binary_fill_holes(a > 140), iterations=1))
    return m


def projizieren(P, k, p):
    s, D, phi, cx, cy, h0 = p
    th = np.deg2rad(WINKEL[k])
    x = P[:, 0] * np.cos(th) + P[:, 2] * np.sin(th)
    z = -P[:, 0] * np.sin(th) + P[:, 2] * np.cos(th)
    y = P[:, 1] - h0
    ph = np.deg2rad(phi)
    y2 = y * np.cos(ph) - z * np.sin(ph)
    z2 = y * np.sin(ph) + z * np.cos(ph)
    d = D - z2
    f = s * D
    return cx + f * x / d, cy - f * y2 / d


def gitter(schritt):
    xs = np.arange(-1.4, 1.4, schritt) + schritt / 2
    ys = np.arange(-0.2, 2.6, schritt) + schritt / 2
    zs = np.arange(-3.2, 3.2, schritt) + schritt / 2
    return xs, ys, zs


def schneiden(P, p, M, stueck=2_000_000, skala=1.0):
    h, w = M[0].shape
    drin = np.ones(len(P), bool)
    for a in range(0, len(P), stueck):
        Q = P[a:a + stueck]
        d = np.ones(len(Q), bool)
        for k in range(N):
            u, v = projizieren(Q, k, p)
            ui, vi = np.round(u * skala).astype(int), np.round(v * skala).astype(int)
            ok = (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)
            t = np.zeros(len(Q), bool)
            t[ok] = M[k][vi[ok], ui[ok]]
            d &= t
            if not d.any():
                break
        drin[a:a + stueck] = d
    return drin


def guete(p, P, M, skala):
    """1 - mittlere Deckung (IoU) der Umrisse. Masken verkleinert, damit die Rasterpunkte dicht liegen."""
    if p[0] <= 1 or p[1] <= 3:
        return 1.0
    drin = schneiden(P, p, M, skala=skala)
    if drin.sum() < 50:
        return 1.0
    Q = P[drin]
    h, w = M[0].shape
    iou = []
    for k in range(0, N, 3):
        u, v = projizieren(Q, k, p)
        ui, vi = np.round(u * skala).astype(int), np.round(v * skala).astype(int)
        ok = (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)
        b = np.zeros((h, w), bool)
        b[vi[ok], ui[ok]] = True
        b = b | np.roll(b, 1, 0) | np.roll(b, -1, 0) | np.roll(b, 1, 1) | np.roll(b, -1, 1)  # Punkte etwas aufblasen
        iou.append((b & M[k]).sum() / max((b | M[k]).sum(), 1))
    return 1 - float(np.mean(iou))


def kamera_schaetzen(M):
    """Massstab s fest (Seitenansicht = 4,9 m), sonst schwimmt die Groesse gegen den Abstand D."""
    def bbox(m):
        ys, xs = np.where(m)
        return xs.min(), xs.max(), ys.min(), ys.max()
    x0, x1, _, y1 = bbox(M[9])
    s0 = (x1 - x0) / 4.9
    fx0, fx1, _, _ = bbox(M[0])
    xs, ys, zs = gitter(0.08)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    skala = 2.6 / (s0 * 0.08)  # Rasterabstand ~2,6 px in den verkleinerten Masken
    h, w = M[0].shape
    MK = [np.array(Image.fromarray(m.astype(np.uint8) * 255).resize((round(w * skala), round(h * skala)), Image.BILINEAR)) > 127
          for m in M]
    g = lambda q: guete(np.r_[s0, q], P, MK, skala)
    best = None
    for D0 in (8.0, 13.0):  # mehrere Starts, Nelder-Mead bleibt sonst in Nebenminima haengen
        for phi0 in (4.0, 10.0):
            for h00 in (0.7, 1.0):
                q0 = np.array([D0, phi0, (fx0 + fx1) / 2, y1 - s0 * h00, h00])
                r = minimize(g, q0, method="Nelder-Mead",
                             options={"maxiter": 140, "xatol": 0.02, "fatol": 1e-4,
                                      "initial_simplex": [q0, q0 + [3, 0, 0, 0, 0], q0 + [0, 3, 0, 0, 0],
                                                          q0 + [0, 0, 10, 0, 0], q0 + [0, 0, 0, 10, 0], q0 + [0, 0, 0, 0, 0.2]]})
                if best is None or r.fun < best.fun:
                    best = r
    q1 = best.x
    best2 = minimize(g, q1, method="Nelder-Mead",
                     options={"maxiter": 200, "xatol": 0.01, "fatol": 5e-5,
                              "initial_simplex": [q1, q1 + [1.5, 0, 0, 0, 0], q1 + [0, 1.5, 0, 0, 0],
                                                  q1 + [0, 0, 4, 0, 0], q1 + [0, 0, 0, 4, 0], q1 + [0, 0, 0, 0, 0.1]]})
    b = best2 if best2.fun < best.fun else best
    return np.r_[s0, b.x], float(b.fun)


def form_bauen(mid, lack, neu):
    global WINKEL
    pj = os.path.join(AUSGABE, f"{mid}-form.json")
    pw = os.path.join(AUSGABE, f"{mid}-winkel.json")
    WINKEL = [float(w) for w in json.load(open(pw))] if os.path.exists(pw) else [k * 10.0 for k in range(N)]
    M = masken_laden(mid, lack)
    h, w = M[0].shape
    if os.path.exists(pj) and not neu:
        k = json.load(open(pj))["kamera"]
        p = np.array([k[n] for n in ("s", "D", "phi", "cx", "cy", "h0")])
        fehler = json.load(open(pj))["fehler"]
    else:
        p, fehler = kamera_schaetzen(M)
    xs, ys, zs = gitter(SCHRITT)
    vol = np.zeros((len(xs), len(ys), len(zs)), bool)
    for i, x in enumerate(xs):  # Scheibe fuer Scheibe, spart Speicher
        Y, Z = np.meshgrid(ys, zs, indexing="ij")
        P = np.stack([np.full(Y.size, x), Y.ravel(), Z.ravel()], 1)
        vol[i] = schneiden(P, p, M).reshape(Y.shape)
    teil, anzahl = label(vol)
    if anzahl > 1:  # nur das Auto, keine losen Reste am Rand
        vol = teil == (np.argmax(np.bincount(teil.ravel())[1:]) + 1)
    idx = np.argwhere(vol)
    lo, hi = idx.min(0), idx.max(0) + 1
    vol = vol[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    o = [float(xs[lo[0]] - SCHRITT / 2), float(ys[lo[1]] - SCHRITT / 2), float(zs[lo[2]] - SCHRITT / 2)]
    nx, ny, nz = vol.shape
    teile = []
    laeufe = 0
    for ix in range(nx):
        for iy in range(ny):
            spalte = vol[ix, iy].astype(np.int8)
            kanten = np.flatnonzero(np.diff(np.r_[0, spalte, 0]))
            paare = kanten.reshape(-1, 2)[:255]
            teile.append(struct.pack("<B", len(paare)))
            if len(paare):
                teile.append(paare.astype("<u2").tobytes())
            laeufe += len(paare)
    with open(os.path.join(AUSGABE, f"{mid}-form.bin"), "wb") as f:
        f.write(b"".join(teile))
    grenzen = [o[0], o[0] + nx * SCHRITT, o[1], o[1] + ny * SCHRITT, o[2], o[2] + nz * SCHRITT]
    info = {"kamera": {n: float(v) for n, v in zip(("s", "D", "phi", "cx", "cy", "h0"), p)},
            "bild": [w, h], "o": o, "schritt": SCHRITT, "n": [nx, ny, nz], "grenzen": grenzen,
            "fehler": round(fehler, 4), "laeufe": laeufe}
    json.dump(info, open(pj, "w"), indent=1)
    return info


def main():
    neu = "--neu" in sys.argv
    wahl = [a for a in sys.argv[1:] if not a.startswith("--")]
    katalog = json.load(open(os.path.join(AUSGABE, "fahrzeug-dreh.json")))
    for m in katalog["modelle"]:
        if wahl and m["id"] not in wahl:
            continue
        t = time.time()
        info = form_bauen(m["id"], m["lacke"][0], neu)
        g = info["grenzen"]
        print(f"{m['id']:22s} Fehler {info['fehler']:.3f}  Masse {g[1]-g[0]:.2f} x {g[3]-g[2]:.2f} x {g[5]-g[4]:.2f} m"
              f"  {os.path.getsize(os.path.join(AUSGABE, m['id'] + '-form.bin')) // 1024} KB  {time.time() - t:.0f} s", flush=True)


if __name__ == "__main__":
    main()
