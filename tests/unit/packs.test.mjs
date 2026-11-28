import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, mergeDoc } from '../../js/core/store.js';
import { packOfItem } from '../../js/core/content.js';

test('pack card documents are known to the store and merge per card', () => {
  assert.equal(kindOf('p1.packs.srs-ppoz1'), 'srs');
  assert.equal(kindOf('p1.packs.srs-PPOZ'), null);
  const a = { cards: { 'ppoz1-001': { t: 5, n: 1 } }, updatedAt: 5 };
  const b = { cards: { 'ppoz1-001': { t: 9, n: 2 }, 'ppoz1-002': { t: 3, n: 0 } }, updatedAt: 9 };
  const m = mergeDoc('p1.packs.srs-ppoz1', a, b);
  assert.equal(m.cards['ppoz1-001'].t, 9);
  assert.ok(m.cards['ppoz1-002']);
});

test('pack items are told apart from course items', () => {
  assert.equal(packOfItem('ppoz1-042'), 'ppoz1');
  assert.equal(packOfItem('ppoz2-150'), 'ppoz2');
  assert.equal(packOfItem('w01-12'), null);
  assert.equal(packOfItem(null), null);
});
