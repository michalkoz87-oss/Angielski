import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVoices } from '../../js/core/audio.js';

const v = (name, lang) => ({ name, lang });

test('novelty and robotic voices are never preferred', () => {
  const ios = [v('Albert', 'en-US'), v('Bad News', 'en-US'), v('Eddy (English (UK))', 'en-GB'), v('Flo (English (UK))', 'en-GB'), v('Daniel', 'en-GB'), v('Samantha', 'en-US'), v('Zosia', 'pl-PL')];
  assert.equal(rankVoices(ios, 'en-GB')[0].name, 'Daniel');
  assert.equal(rankVoices(ios, 'en-US')[0].name, 'Samantha');
});

test('the wanted accent wins among good voices, another English accent is the fallback', () => {
  const chrome = [v('Microsoft Paulina - Polish (Poland)', 'pl-PL'), v('Google US English', 'en-US'), v('Google UK English Female', 'en-GB')];
  assert.equal(rankVoices(chrome, 'en-GB')[0].name, 'Google UK English Female');
  assert.equal(rankVoices([v('Google US English', 'en-US')], 'en-GB')[0].name, 'Google US English');
});

test('Android-style language codes are understood and non-English voices are left out', () => {
  const android = [v('Polish Poland', 'pl_PL'), v('English United Kingdom', 'en_GB'), v('English United States', 'en_US')];
  assert.deepEqual(rankVoices(android, 'en-GB').map((x) => x.lang), ['en_GB', 'en_US']);
  assert.equal(rankVoices([v('Polish Poland', 'pl_PL')], 'en-GB').length, 0);
});
