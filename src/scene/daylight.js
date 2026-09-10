// "Day and night follow the clock" (design 1l). Four phases from the machine's local time;
// each names the sky and sun the scene lights with, the screen glow and whether the page
// runs on the dark tokens. The owner can pin one (N cycles, #phase=evening) or force dark (D).
export const PHASES = {
  morning: { label: 'MORNING', hours: [6, 11],  hemi: ['#FFF3DC', '#E8E4D8', 0.9],  sun: { az: 60,  el: 25, col: '#FFE2B8', i: 2.0 }, screen: 0.0,  dark: false, tint: '#FFF6E8', shadow: 0.16 },
  day:     { label: 'DAY',     hours: [11, 17], hemi: ['#FFFFFF', '#EDEEE6', 0.85], sun: { az: 40,  el: 60, col: '#FFF1DD', i: 2.2 }, screen: 0.0,  dark: false, tint: '#FFFFFF', shadow: 0.13 },
  evening: { label: 'EVENING', hours: [17, 20], hemi: ['#FFD9B0', '#C9BFD6', 0.8],  sun: { az: 250, el: 12, col: '#FFB57A', i: 1.7 }, screen: 0.35, dark: false, tint: '#F8F1E6', shadow: 0.2 },
  night:   { label: 'NIGHT',   hours: [20, 6],  hemi: ['#3A4056', '#14161C', 1.05], sun: { az: 200, el: 35, col: '#9FB0DC', i: 0.75 }, screen: 0.8,  dark: true,  tint: '#1B1C20', shadow: 0.35 },
};
export const PHASE_KEYS = Object.keys(PHASES);
export function phaseFor(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}
// sun direction from azimuth (deg, 0 = +X, counter-clockwise seen from above) and elevation
export function sunDir(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(e), -Math.sin(a) * Math.cos(e)];
}
