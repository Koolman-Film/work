// OKLCH -> sRGB (Björn Ottosson's matrices) + WCAG contrast. No deps.
const clamp = x => Math.min(1, Math.max(0, x));
const gamma = c => c <= 0.0031308 ? 12.92*c : 1.055*Math.pow(c, 1/2.4) - 0.055;
function oklchToRgb(L, C, H) {
  const h = H * Math.PI / 180, a = C*Math.cos(h), b = C*Math.sin(h);
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;
  const l = l_**3, m = m_**3, s = s_**3;
  const R = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const G = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const B = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  return [R,G,B].map(v => Math.round(clamp(gamma(v)) * 255));
}
const hexToRgb = h => { h=h.replace('#',''); if(h.length===3) h=[...h].map(c=>c+c).join('');
  return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); };
const toHex = ([r,g,b]) => '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
const lum = ([r,g,b]) => { const f=c=>{c/=255; return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
const ratio = (a,b) => { const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };
// binary-search lightness for an exact target contrast against bg
function solve(target, bgHex, C, H) {
  const bg = hexToRgb(bgHex); let lo=0, hi=1, out=null;
  for (let i=0;i<60;i++){ const L=(lo+hi)/2; const rgb=oklchToRgb(L,C,H); const r=ratio(rgb,bg);
    if (r > target) lo = L; else hi = L; out = {L:+(L*100).toFixed(2), hex:toHex(rgb), ratio:+r.toFixed(2)}; }
  return out;
}
export { oklchToRgb, hexToRgb, toHex, lum, ratio, solve };
