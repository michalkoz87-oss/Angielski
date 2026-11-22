#!/usr/bin/env node
// Wpisuje do data/courses.json listę tygodni, które mają komplet plików (availableWeeks).
// Uruchom po dodaniu nowych tygodni: node scripts/update-catalog.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'data', 'courses.json');
const catalog = JSON.parse(readFileSync(path, 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
for (const c of catalog.courses) {
  const dir = join(root, 'data', 'courses', c.id, 'weeks');
  c.availableWeeks = [];
  for (let w = 1; w <= c.weeks; w++) if (existsSync(join(dir, `w${pad(w)}-vocab.json`)) && existsSync(join(dir, `w${pad(w)}-lessons.json`))) c.availableWeeks.push(w);
  console.log(`${c.id}: ${c.availableWeeks.length} / ${c.weeks} tygodni`);
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
