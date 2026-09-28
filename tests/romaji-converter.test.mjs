import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReading, readingToRomaji, romajiToHiragana } from '../Typing/core/romaji-converter.js';

test('normalizeReading converts katakana to hiragana and trims whitespace', () => {
  assert.equal(normalizeReading('  ヘイジョウキョウ  '), 'へいじょうきょう');
});

test('romajiToHiragana converts the two reference answers', () => {
  assert.equal(romajiToHiragana("konden'einenshizaihou"), 'こんでんえいねんしざいほう');
  assert.equal(romajiToHiragana('heijoukyou'), 'へいじょうきょう');
});

test('romajiToHiragana accepts common alternate romanizations and uppercase', () => {
  const cases = [
    ['SHI', 'し'], ['si', 'し'],
    ['chi', 'ち'], ['ti', 'ち'],
    ['tsu', 'つ'], ['tu', 'つ'],
    ['fu', 'ふ'], ['hu', 'ふ'],
  ];
  for (const [input, expected] of cases) assert.equal(romajiToHiragana(input), expected, input);
});

test('romajiToHiragana handles doubled consonants, long vowel spellings, and n', () => {
  assert.equal(romajiToHiragana('gakkou'), 'がっこう');
  assert.equal(romajiToHiragana('shinbun'), 'しんぶん');
  assert.equal(romajiToHiragana("kin'youbi"), 'きんようび');
  assert.equal(romajiToHiragana('kanji'), 'かんじ');
});

test('romajiToHiragana consumes nn together before a vowel like the reference game', () => {
  assert.equal(romajiToHiragana('nne'), 'んえ');
  assert.equal(romajiToHiragana('kondenneinenshizaihou'), 'こんでんえいねんしざいほう');
});

test('romajiToHiragana leaves a trailing n unsettled during typing and settles it on submit', () => {
  assert.equal(romajiToHiragana('kan', false), 'かn');
  assert.equal(romajiToHiragana('kan', true), 'かん');
});

test('romajiToHiragana accepts the reference Hepburn and Kunrei spellings', () => {
  const cases = [
    ['sha', 'しゃ'], ['sya', 'しゃ'],
    ['cha', 'ちゃ'], ['tya', 'ちゃ'], ['cya', 'ちゃ'],
    ['ja', 'じゃ'], ['jya', 'じゃ'], ['zya', 'じゃ'],
    ['dji', 'ぢ'], ['di', 'ぢ'],
    ['dzu', 'づ'], ['du', 'づ'],
  ];
  for (const [input, expected] of cases) assert.equal(romajiToHiragana(input), expected, input);
});

test('romajiToHiragana accepts typing-only small-kana spellings from the reference game', () => {
  const cases = [
    ['lya', 'ゃ'], ['xya', 'ゃ'], ['lyu', 'ゅ'], ['xyu', 'ゅ'], ['lyo', 'ょ'], ['xyo', 'ょ'],
    ['ltu', 'っ'], ['xtu', 'っ'], ['ltsu', 'っ'], ['xtsu', 'っ'],
    ['la', 'ぁ'], ['xa', 'ぁ'], ['li', 'ぃ'], ['xi', 'ぃ'], ['lu', 'ぅ'], ['xu', 'ぅ'],
    ['le', 'ぇ'], ['xe', 'ぇ'], ['lo', 'ぉ'], ['xo', 'ぉ'],
  ];
  for (const [input, expected] of cases) assert.equal(romajiToHiragana(input), expected, input);
});

test('romajiToHiragana preserves an incomplete tail so backspace recomputation is stable', () => {
  assert.equal(romajiToHiragana('gakk'), 'がっk');
  assert.equal(romajiToHiragana('gak'), 'がk');
  assert.equal(romajiToHiragana('ga'), 'が');
});

test('readingToRomaji generates the canonical hints used by the reference game', () => {
  assert.equal(readingToRomaji('こんでんえいねんしざいほう'), "konden'einenshizaihou");
  assert.equal(readingToRomaji('へいじょうきょう'), 'heijoukyou');
  assert.equal(readingToRomaji('がっこう'), 'gakkou');
});
