#!/usr/bin/env node
// Buduje wersję do publikacji jako Claude Artifact: dist/artifact/index.html (sam fragment strony:
// tytuł, style, znaczniki i jeden skrypt) oraz dist/artifact/data/** (pliki kursów pobierane fetch()).
//   node scripts/build-artifact.mjs            → pełna strona artefaktu
//   node scripts/build-artifact.mjs --preview  → dodatkowo dist/artifact/preview.html (do testów lokalnych)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'artifact');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const title = /<title>([^<]*)<\/title>/.exec(html)[1];
const fonts = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/.exec(html)[1];
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">/g)].map((m) => m[1]);
const css = cssFiles.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const body = /<body>([\s\S]*?)<script type="module"/.exec(html)[1].replace(/<!--[\s\S]*?-->/g, '').trim();

const bundle = await build({
  entryPoints: [join(root, 'js', 'main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
  define: { 'import.meta.url': '""' },
  logLevel: 'warning',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${body}
<script>globalThis.__DATA_BASE__ = 'data/';</script>
<script>
${js}
</script>
`;
for (const bad of ['<!doctype', '<html', '<head', '<body']) if (page.toLowerCase().includes(bad)) throw new Error(`Strona artefaktu nie może zawierać ${bad}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), page);
cpSync(join(root, 'data'), join(out, 'data'), { recursive: true });
if (process.argv.includes('--preview')) {
  writeFileSync(join(out, 'preview.html'), `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`);
}
console.log(`dist/artifact/index.html: ${(page.length / 1024).toFixed(0)} kB`);
