#!/usr/bin/env python3
"""Baut dreh-demo.html: Fahrzeugkarte mit einmaliger 360-Grad-Drehung, Bilder eingebettet (nur zum Anschauen)."""
import os, base64, json
from PIL import Image
HIER = os.path.dirname(os.path.abspath(__file__))
FARBEN = {"9197": ("Obsidianschwarz", "#16181b"), "5842": ("Sodalithblau", "#1f3557")}
daten = {}
for code in FARBEN:
    ordner = os.path.join(HIER, "v-klasse-360", code)
    if os.path.isdir(ordner):
        daten[code] = ["data:image/webp;base64," + base64.b64encode(open(os.path.join(ordner, f"{i:02d}.webp"), "rb").read()).decode() for i in range(36)]
# Endstellung: Ausschnitt von BE320 (Index 32) wie das Standbild, mit etwas Rand
ende = Image.open(os.path.join(HIER, "v-klasse-360", next(iter(daten)), "32.webp"))
bx = ende.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
PAD = 5
ENDBOX = [max(bx[0]-PAD, 0), max(bx[1]-PAD, 0), min(bx[2]+PAD, ende.width), min(bx[3]+PAD, ende.height)]
GROESSE = list(ende.size)
knoepfe = "".join(f'<button class="farbe" data-code="{c}" style="--f:{FARBEN[c][1]}" title="{FARBEN[c][0]}"></button>' for c in daten)
html = """<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fahrzeug Drehung</title><style>
:root{--bg:#eef0f2;--karte:#fff;--text:#111;--leise:#6b7076;--linie:#e3e6e9}
@media (prefers-color-scheme:dark){:root{--bg:#0e0f11;--karte:#1a1c1f;--text:#f2f3f4;--leise:#9aa0a6;--linie:#2a2d31}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;display:flex;justify-content:center;padding:24px 16px}
.telefon{width:390px;max-width:100%;background:var(--karte);border-radius:28px;padding:20px 18px 22px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.kopf{display:flex;justify-content:space-between;align-items:baseline}.kopf h1{font-size:20px;margin:0;font-weight:700}.kz{font-size:13px;color:var(--leise);border:1.5px solid var(--linie);border-radius:6px;padding:2px 7px;font-weight:600;letter-spacing:.5px}
.unter{color:var(--leise);font-size:13px;margin-top:2px}
.buehne{position:relative;overflow:hidden;margin:14px 0 4px;touch-action:pan-y;cursor:grab;user-select:none}.buehne:active{cursor:grabbing}
.buehne img{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;max-width:none}
.hinweis{text-align:center;color:var(--leise);font-size:12px;height:16px;transition:opacity .4s}
.zeile{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--linie)}
.farben{display:flex;gap:10px}.farbe{width:26px;height:26px;border-radius:50%;border:2px solid var(--karte);background:var(--f);box-shadow:0 0 0 1.5px var(--linie);cursor:pointer;padding:0}.farbe.an{box-shadow:0 0 0 2px var(--text)}
.nochmal{background:none;border:1.5px solid var(--linie);color:var(--text);border-radius:10px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer}
.werte{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px}.wert{background:var(--bg);border-radius:12px;padding:10px}.wert b{display:block;font-size:16px}.wert span{font-size:12px;color:var(--leise)}
</style></head><body><div class="telefon">
<div class="kopf"><h1>Mercedes V-Klasse</h1><span class="kz">M-TR 220</span></div>
<div class="unter">V 220 d · 7 Sitze · Dein Fahrzeug heute</div>
<div class="buehne" id="buehne"><img id="bild" alt="V-Klasse"></div>
<div class="hinweis" id="hinweis">Zum Drehen wischen</div>
<div class="werte"><div class="wert"><b>78 %</b><span>Tank</span></div><div class="wert"><b>612 km</b><span>Reichweite</span></div><div class="wert"><b>42.180</b><span>km-Stand</span></div></div>
<div class="zeile"><div class="farben">KNOEPFE</div><button class="nochmal" id="nochmal">Nochmal drehen</button></div>
</div><script>
const DATEN=DATEN_JSON, START=32, N=36, BOX=ENDBOX_JSON, GR=GROESSE_JSON;
let code=DATEN["9197"]?"9197":Object.keys(DATEN)[0], pos=START, anim=null, frame=-1;
const bild=document.getElementById('bild'), buehne=document.getElementById('buehne');
bild.style.width=GR[0]+'px';bild.style.height=GR[1]+'px';
buehne.style.aspectRatio=(BOX[2]-BOX[0])+'/'+(BOX[3]-BOX[1]);
// Abstand zur Endstellung in Bildern (0..18)
function abstand(p){const d=((p-START)%N+N)%N;return Math.min(d,N-d);}
function zeig(p){pos=p;const f=((Math.round(p)%N)+N)%N;if(f!==frame){frame=f;bild.src=DATEN[code][f];}
 const W=buehne.clientWidth,H=buehne.clientHeight;
 // Endstellung: BE320 fuellt die Buehne. Beim Drehen herauszoomen, damit Seite/Heck ganz sichtbar sind.
 const sE=W/(BOX[2]-BOX[0]),xE=-BOX[0]*sE,yE=-BOX[1]*sE;
 const sA=Math.min(W/GR[0],H/GR[1]),xA=(W-GR[0]*sA)/2,yA=(H-GR[1]*sA)/2;
 let w=Math.min(abstand(p)/4,1);w=w*w*(3-2*w);
 const s=sE+(sA-sE)*w,x=xE+(xA-xE)*w,y=yE+(yA-yE)*w;
 bild.style.transform=`translate(${x}px,${y}px) scale(${s})`;}
function vorladen(c){DATEN[c].forEach(s=>{const im=new Image();im.src=s;});}
function animiere(nach,dauer){cancelAnimationFrame(anim);const t0=performance.now(),von=pos;
 const schritt=t=>{const q=Math.min((t-t0)/dauer,1),e=1-Math.pow(1-q,3);zeig(von+(nach-von)*e);if(q<1)anim=requestAnimationFrame(schritt);else zeig(nach);};anim=requestAnimationFrame(schritt);}
// einmal ganz herum und in der Endstellung (BE320) aufhoeren, egal wo das Auto gerade steht
function drehen(){const r=Math.round(pos),d=((START-r)%N+N)%N;animiere(r+d+N,1700);}
function farbe(c){code=c;frame=-1;document.querySelectorAll('.farbe').forEach(b=>b.classList.toggle('an',b.dataset.code===c));vorladen(c);zeig(pos);}
document.querySelectorAll('.farbe').forEach(b=>b.onclick=()=>farbe(b.dataset.code));
document.getElementById('nochmal').onclick=drehen;
let x0=null,p0=0;
buehne.addEventListener('pointerdown',e=>{cancelAnimationFrame(anim);x0=e.clientX;p0=pos;buehne.setPointerCapture(e.pointerId);document.getElementById('hinweis').style.opacity=0;});
buehne.addEventListener('pointermove',e=>{if(x0===null)return;zeig(p0+(e.clientX-x0)/9);});
// von Hand gedreht: bleibt stehen, wo der Fahrer loslaesst
const los=()=>{if(x0===null)return;x0=null;zeig(Math.round(pos));};
buehne.addEventListener('pointerup',los);buehne.addEventListener('pointercancel',los);
addEventListener('resize',()=>zeig(pos));
farbe(code);zeig(START);setTimeout(drehen,350);
</script></body></html>"""
html = html.replace("KNOEPFE", knoepfe).replace("DATEN_JSON", json.dumps(daten)).replace("ENDBOX_JSON", json.dumps(ENDBOX)).replace("GROESSE_JSON", json.dumps(GROESSE))
open(os.path.join(HIER, "dreh-demo.html"), "w").write(html)
print("dreh-demo.html", round(len(html) / 1e6, 2), "MB")
