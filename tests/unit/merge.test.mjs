import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDoc, kindOf } from '../../js/core/store.js';
import { stableStringify } from '../../js/core/platform.js';

const same = (a, b) => assert.equal(stableStringify(a), stableStringify(b));
const cases = {
  profiles: [
    { list: { p1: { id: 'p1', name: 'Ala', updatedAt: 5 }, p2: { id: 'p2', name: 'Ola', updatedAt: 1 } }, updatedAt: 5 },
    { list: { p1: { id: 'p1', name: 'Alicja', updatedAt: 9 }, p3: { id: 'p3', name: 'Jan', updatedAt: 2, deleted: true } }, updatedAt: 9 },
    { list: { p2: { id: 'p2', name: 'Olga', updatedAt: 1 } }, updatedAt: 3 },
  ],
  'p1.profile': [{ studyTime: '17:00', updatedAt: 3 }, { studyTime: '19:00', updatedAt: 8 }, { studyTime: '07:00', updatedAt: 8 }],
  'p1.b2c1.progress': [
    { steps: { 'w01d1.review': { done: true, at: 4 } }, results: { 'w01-reading': { score: 3, total: 6, at: 4 } }, updatedAt: 4 },
    { steps: { 'w01d1.review': { done: true, at: 7 }, 'w01d1.learn': { done: true, at: 7 } }, tests: { w01: { score: 15, total: 20, at: 7 } }, updatedAt: 7 },
    { steps: {}, results: { 'w01-reading': { score: 5, total: 6, at: 9 } }, updatedAt: 9 },
  ],
  'p1.b2c1.srs-w01': [
    { cards: { 'w01-01': { d: 10, i: 1, t: 100, n: 1 }, 'w01-02': { d: 11, i: 3, t: 120, n: 2 } }, updatedAt: 120 },
    { cards: { 'w01-01': { d: 14, i: 3, t: 200, n: 2 } }, updatedAt: 200 },
    { cards: { 'w01-02': { d: 11, i: 1, t: 120, n: 3 }, 'w01-03': { d: 9, i: 1, t: 50, n: 0 } }, updatedAt: 121 },
  ],
  'p1.log-2026-11': [
    { days: { 23: { dA: { reviews: 10, correct: 8 } } }, updatedAt: 1 },
    { days: { 23: { dA: { reviews: 12, correct: 9 }, dB: { reviews: 4 } }, 24: { dB: { sessions: 1 } } }, updatedAt: 2 },
    { days: { 23: { dB: { reviews: 6, newCards: 10 } } }, updatedAt: 3 },
  ],
  'p1.b2c1.journal-w01': [
    { entries: { writing: { text: 'a', at: 1 } }, updatedAt: 1 },
    { entries: { writing: { text: 'ab', at: 5 }, input: { notes: 'x', at: 2 } }, updatedAt: 5 },
    { entries: { input: { notes: 'y', at: 3 } }, updatedAt: 3 },
  ],
};

for (const [id, [a, b, c]] of Object.entries(cases)) {
  test(`merge ${id}: commutative, associative, idempotent`, () => {
    assert.ok(kindOf(id));
    same(mergeDoc(id, a, b), mergeDoc(id, b, a));
    same(mergeDoc(id, mergeDoc(id, a, b), c), mergeDoc(id, a, mergeDoc(id, b, c)));
    same(mergeDoc(id, a, a), a);
    same(mergeDoc(id, mergeDoc(id, a, b), b), mergeDoc(id, a, b));
    same(mergeDoc(id, a, {}), a);
    same(mergeDoc(id, {}, b), b);
  });
}

test('merge keeps the newest review per card and the larger counters', () => {
  const [a, b] = cases['p1.b2c1.srs-w01'];
  assert.equal(mergeDoc('p1.b2c1.srs-w01', a, b).cards['w01-01'].t, 200);
  const [x, y] = cases['p1.log-2026-11'];
  assert.deepEqual(mergeDoc('p1.log-2026-11', x, y).days[23].dA, { reviews: 12, correct: 9 });
});

test('unknown documents are rejected', () => {
  assert.equal(kindOf('anything'), null);
  assert.equal(kindOf('p1/../x.profile'), null);
});
