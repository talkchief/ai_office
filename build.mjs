// Bundle src/main.js (+three) into a single self-contained HTML that opens by double-click.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { buildBrainGraph } from './graph-build.mjs';
await buildBrainGraph(new URL('./brain/', import.meta.url).pathname); // V3.6: bake the vault's wiki-link graph into src/braingraph.js

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
});
const js = res.outputFiles[0].text;
const outDir = process.env.AO_DIST || 'dist';
const shell = readFileSync('src/shell.html', 'utf8');
const html = shell.replace('<!--APP-->', () => `<script>${js}</script>`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/command-centre-v2.html', html);

// dev variant with external script for faster iteration
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/app.js', js);
writeFileSync(outDir + '/dev.html', shell.replace('<!--APP-->', '<script src="app.js"></script>'));
console.log(`built ${outDir}/command-centre-v2.html (${(html.length / 1024).toFixed(0)} KB)`);
