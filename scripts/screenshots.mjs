// Headless screenshots of the built office at a few camera states — for a look before a release.
// node scripts/screenshots.mjs [outDir]   (writes overview.png, sales.png, night.png, kitchen.png)
import { chromium } from 'playwright-core';
import path from 'path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = process.argv[2] || path.join(ROOT, 'dist');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const shots = [['overview', ''], ['sales', '#view=sales'], ['night', '#phase=night'], ['kitchen', '']];
for (const [name, hash] of shots) {
  await page.goto('about:blank');
  await page.goto('file://' + path.join(ROOT, 'dist', 'command-centre-v2.html') + '?s=check' + hash);
  await page.waitForTimeout(hash.includes('view') ? 4500 : 3500);
  if (name === 'kitchen') { await page.evaluate(() => { const K = window.CC.office.rig.kitchen; window.CC.flyTo([K.pos.x, 0, K.pos.z], 3.0, 300); }); await page.waitForTimeout(1500); }
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log(name + '.png');
}
console.log('page errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
