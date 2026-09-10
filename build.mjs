// Bundle src/main.js (+three, react, @react-three/fiber) into a single self-contained HTML that opens by double-click.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { buildBrainGraph } from './graph-build.mjs';
await buildBrainGraph(); // bake the configured Brain's wiki-link graph into src/braingraph.js (the config resolves the path on every OS)

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  jsx: 'automatic',                       // src/scene/*.jsx — the office on React Three Fiber
  loader: { '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
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
