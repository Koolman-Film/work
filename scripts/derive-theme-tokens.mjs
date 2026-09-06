import { oklchToRgb, hexToRgb, toHex, ratio } from './ramp.mjs';
const H=257,Cs=0.010,Ci=0.014;
const mk=(L,C=Cs)=>toHex(oklchToRgb(L/100,C,H));
const r=(a,b)=>+ratio(hexToRgb(a),hexToRgb(b)).toFixed(2);
const L={sunken:16,canvas:18.5,muted:23,surface:26.5,hover:29.5,hoverStrong:32.5,
         lineSoft:31,line:36,lineStrong:45,ink5:55};
const S=Object.fromEntries(Object.entries(L).map(([k,v])=>[k,mk(v)]));
const ink={1:'#e9f0f9',2:'#c7ced7',3:'#a7adb5',4:'#979da5'};
const lightest=S.hoverStrong;
console.log('=== FINAL DARK SURFACES (elevation = lightness) ===');
const order=['sunken','canvas','muted','surface','hover','hoverStrong'];
order.forEach((k,i)=>console.log(`  ${k.padEnd(12)} ${S[k]}  L=${String(L[k]).padEnd(5)} ΔL=${i?(L[k]-L[order[i-1]]).toFixed(1):'—'}`));
console.log('\n=== INK vs the LIGHTEST surface (hoverStrong) — the worst case ===');
let ok=true;
for(const [k,v] of Object.entries(ink)){const q=r(v,lightest); if(q<4.5)ok=false;
  console.log(`  ink-${k} ${v}  onLightest=${String(q).padEnd(5)} onSurface=${String(r(v,S.surface)).padEnd(5)} onCanvas=${String(r(v,S.canvas)).padEnd(5)} ${q>=4.5?'PASS':'FAIL'}`);}
console.log(`\n  ALL INK PASSES AA ON EVERY SURFACE: ${ok}`);
console.log('\n=== BORDERS ===');
for(const k of ['lineSoft','line','lineStrong']) console.log(`  ${k.padEnd(11)} ${S[k]}  ΔL vs surface = ${(L[k]-L.surface).toFixed(1)}`);
console.log(`  ink-5 (non-text)  ${S.ink5}`);
console.log('\n=== HOVER DIRECTION (the inversion) ===');
console.log(`  light: surface #ffffff -> hover #fafafa            DARKER`);
console.log(`  dark : surface ${S.surface} -> hover ${S.hover}   LIGHTER (ΔL +3.0)`);
