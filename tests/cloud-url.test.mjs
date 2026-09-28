import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareUrl, parseShareId } from '../core/cloud/share-url.js';
const id = 'G7m2Pk8wQ4t9R3vX6nYzAa';
test('share URL contains only one opaque ID and has a fixed 75-character length', () => {
  const url = buildShareUrl('https://ruriru-app.github.io/DEKIRU-GameCreator/', id);
  assert.equal(url, 'https://ruriru-app.github.io/DEKIRU-GameCreator/p/?g=' + id);
  assert.equal(url.length, 75); assert.equal(parseShareId(url), id);
});
test('share IDs reject duplicates, extra query, fragment, malformed and unsafe URLs', () => {
  for (const tail of ['g=a&g=b','g='+id+'&title=x','g=','', 'g='+id+'#secret']) {
    assert.equal(parseShareId('https://example.invalid/p/?'+tail), null);
  }
  assert.equal(parseShareId('not a url'), null);
  assert.throws(() => buildShareUrl('javascript:alert(1)', id));
  assert.throws(() => buildShareUrl('https://x.invalid/'+'x'.repeat(80)+'/',id));
  assert.throws(() => buildShareUrl('https://x.invalid/?x=1',id));
  assert.throws(() => buildShareUrl('https://x.invalid/', 'bad'));
});
