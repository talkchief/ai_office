// Wall screens: canvas textures redrawn a couple of times a second. Three kinds —
//   'dept'   the room's board: name, N working, a throughput sparkline, the live task list
//   'market' the lobby / meeting-room ticker: candlesticks and a crawling price tape (a demo feed)
//   'lobby'  the brand board: the office clock, who is doing what right now, an approvals count
import * as THREE from 'three';
import { canvasTexture } from './materials.js';

const registry = [];
const rnd = (a, b) => a + Math.random() * (b - a);
const TICKERS = [['TKCH', 148.2], ['SPX', 5482.1], ['NDX', 19210.5], ['AAPL', 231.4], ['MSFT', 428.8], ['NVDA', 122.6], ['BTC', 63140]];

export function makeScreen(kind, w, h, opts = {}) {
  const c = document.createElement('canvas'); c.width = opts.px || 512; c.height = Math.round((opts.px || 512) * h / w);
  const x = c.getContext('2d');
  const tex = canvasTexture(c, 4);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const state = { kind, c, x, tex, mesh, opts, series: [], candles: [], last: 0, tape: 0,
    ticker: TICKERS[Math.floor(Math.random() * TICKERS.length)], hue: opts.chip || '#5ADEB7' };
  for (let i = 0; i < 40; i++) state.series.push(50 + Math.sin(i / 5) * 10 + rnd(-4, 4));
  let p = state.ticker[1];
  for (let i = 0; i < 28; i++) { const o = p, cl = p * (1 + rnd(-0.012, 0.012)); state.candles.push({ o, c: cl, h: Math.max(o, cl) * (1 + rnd(0, 0.006)), l: Math.min(o, cl) * (1 - rnd(0, 0.006)) }); p = cl; }
  registry.push(state);
  draw(state, performance.now(), {});
  return state;
}
export function tickScreens(now, info) {
  for (const s of registry) {
    if (now - s.last < (s.kind === 'market' ? 700 : 1500)) continue;
    s.last = now;
    draw(s, now, info || {});
  }
}
function draw(s, now, info) {
  const { x, c } = s, W = c.width, H = c.height;
  const dark = '#101216', ink = '#ECEAE3', grey = '#8E8F94';
  x.fillStyle = dark; x.fillRect(0, 0, W, H);
  if (s.kind === 'dept') {
    const d = s.opts;
    const rows = (info.rowsFor && info.rowsFor(d.key)) || [];
    const working = info.workingFor ? info.workingFor(d.key) : 0;
    s.series.push(Math.max(2, Math.min(98, s.series[s.series.length - 1] + rnd(-6, 6) + (working ? 1.5 : -0.8)))); if (s.series.length > 40) s.series.shift();
    x.fillStyle = d.chip; x.fillRect(0, 0, W, 6);
    x.fillStyle = ink; x.font = `700 ${W * 0.055}px Inter, sans-serif`; x.fillText(String(d.name).toUpperCase(), W * 0.05, H * 0.2);
    x.fillStyle = grey; x.font = `${W * 0.035}px Inter, sans-serif`; x.fillText(`${working} WORKING · ${info.clock || ''}`, W * 0.05, H * 0.3);
    // sparkline
    const gx = W * 0.05, gy = H * 0.38, gw = W * 0.9, gh = H * 0.24;
    x.strokeStyle = 'rgba(236,234,227,.12)'; x.lineWidth = 1; for (let i = 0; i <= 3; i++) { x.beginPath(); x.moveTo(gx, gy + gh * i / 3); x.lineTo(gx + gw, gy + gh * i / 3); x.stroke(); }
    x.strokeStyle = d.chip; x.lineWidth = W * 0.008; x.beginPath();
    s.series.forEach((v, i) => { const px = gx + gw * i / (s.series.length - 1), py = gy + gh - gh * v / 100; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    const grad = x.createLinearGradient(0, gy, 0, gy + gh); grad.addColorStop(0, d.chip + '55'); grad.addColorStop(1, d.chip + '00');
    x.lineTo(gx + gw, gy + gh); x.lineTo(gx, gy + gh); x.closePath(); x.fillStyle = grad; x.fill();
    x.fillStyle = grey; x.font = `${W * 0.03}px Inter, sans-serif`; x.fillText('THROUGHPUT', gx, gy - 4);
    // the live list
    x.font = `${W * 0.036}px Inter, sans-serif`;
    const lines = rows.length ? rows.slice(0, 4) : [{ t: 'Quiet. Nothing assigned.', c: grey }];
    lines.forEach((r, i) => { x.fillStyle = r.c || ink; x.beginPath(); x.arc(gx + 6, H * 0.72 + i * H * 0.075 - 4, 3.5, 0, 7); x.fill(); x.fillStyle = ink; x.fillText(fit(x, r.t, gw - 20), gx + 16, H * 0.72 + i * H * 0.075); });
  } else if (s.kind === 'market') {
    // candles advance; the tape crawls
    if (Math.random() < 0.35) { const last = s.candles[s.candles.length - 1]; const o = last.c, cl = o * (1 + rnd(-0.01, 0.01)); s.candles.push({ o, c: cl, h: Math.max(o, cl) * (1 + rnd(0, 0.005)), l: Math.min(o, cl) * (1 - rnd(0, 0.005)) }); if (s.candles.length > 28) s.candles.shift(); }
    else { const last = s.candles[s.candles.length - 1]; last.c *= 1 + rnd(-0.004, 0.004); last.h = Math.max(last.h, last.c); last.l = Math.min(last.l, last.c); }
    const first = s.candles[0].o, cur = s.candles[s.candles.length - 1].c, up = cur >= first;
    x.fillStyle = ink; x.font = `700 ${W * 0.06}px Inter, sans-serif`; x.fillText(s.ticker[0], W * 0.05, H * 0.17);
    x.fillStyle = up ? '#5ADEB7' : '#E69393'; x.font = `600 ${W * 0.05}px Inter, sans-serif`; x.fillText(cur.toFixed(cur > 1000 ? 0 : 2) + (up ? ' ▲ ' : ' ▼ ') + Math.abs((cur / first - 1) * 100).toFixed(2) + '%', W * 0.32, H * 0.17);
    x.fillStyle = grey; x.font = `${W * 0.028}px Inter, sans-serif`; x.fillText('MARKET · DEMO FEED · ' + (info.clock || ''), W * 0.05, H * 0.25);
    const gx = W * 0.05, gy = H * 0.3, gw = W * 0.9, gh = H * 0.48;
    const lo = Math.min(...s.candles.map(k => k.l)), hi = Math.max(...s.candles.map(k => k.h));
    const Y = v => gy + gh - gh * (v - lo) / Math.max(1e-6, hi - lo);
    x.strokeStyle = 'rgba(236,234,227,.1)'; x.lineWidth = 1; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(gx, gy + gh * i / 4); x.lineTo(gx + gw, gy + gh * i / 4); x.stroke(); }
    const cw = gw / s.candles.length;
    s.candles.forEach((k, i) => { const cx = gx + cw * i + cw / 2; const col = k.c >= k.o ? '#5ADEB7' : '#E69393'; x.strokeStyle = col; x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx, Y(k.h)); x.lineTo(cx, Y(k.l)); x.stroke(); x.fillStyle = col; const top = Y(Math.max(k.o, k.c)), bot = Y(Math.min(k.o, k.c)); x.fillRect(cx - cw * 0.3, top, cw * 0.6, Math.max(1.5, bot - top)); });
    // the tape
    s.tape = (s.tape + W * 0.012) % (W * 3);
    x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(0, H * 0.86, W, H * 0.14);
    x.font = `600 ${W * 0.034}px Inter, sans-serif`;
    let tx = W - s.tape;
    for (let r = 0; r < 3; r++) for (const [t, base] of TICKERS) { const ch = Math.sin(now / 9000 + base) * 1.4; x.fillStyle = ink; x.fillText(t, tx, H * 0.95); tx += x.measureText(t).width + 8; x.fillStyle = ch >= 0 ? '#5ADEB7' : '#E69393'; const str = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; x.fillText(str, tx, H * 0.95); tx += x.measureText(str).width + 26; }
  } else { // lobby board
    x.fillStyle = '#B9A775'; x.fillRect(0, 0, W, 5);
    x.fillStyle = ink; x.font = `400 ${W * 0.07}px "Instrument Serif", Georgia, serif`; x.fillText(info.brand || 'Talkchief AI Space', W * 0.05, H * 0.2);
    x.fillStyle = grey; x.font = `${W * 0.032}px Inter, sans-serif`; x.fillText((info.clock || '') + '   ·   ' + (info.working || 0) + ' WORKING   ·   ' + (info.needsYou || 0) + ' NEED YOU', W * 0.05, H * 0.3);
    x.strokeStyle = 'rgba(236,234,227,.14)'; x.beginPath(); x.moveTo(W * 0.05, H * 0.36); x.lineTo(W * 0.95, H * 0.36); x.stroke();
    const rows = info.rows || [];
    x.font = `${W * 0.036}px Inter, sans-serif`;
    (rows.length ? rows.slice(0, 5) : [{ t: 'The office is quiet.', c: grey }]).forEach((r, i) => { x.fillStyle = r.c || '#5ADEB7'; x.beginPath(); x.arc(W * 0.06, H * 0.46 + i * H * 0.1 - 4, 3.5, 0, 7); x.fill(); x.fillStyle = ink; x.fillText(fit(x, r.t, W * 0.86), W * 0.09, H * 0.46 + i * H * 0.1); });
  }
  // a faint scanline sheen so the screens read as glass
  x.fillStyle = 'rgba(255,255,255,.035)'; for (let y = 0; y < H; y += 6) x.fillRect(0, y, W, 2);
  s.tex.needsUpdate = true;
}
function fit(x, t, w) { let s = String(t); while (s.length > 4 && x.measureText(s).width > w) s = s.slice(0, -2); return s.length < String(t).length ? s + '…' : s; }
