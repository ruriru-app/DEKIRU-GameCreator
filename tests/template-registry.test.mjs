import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateRegistry } from '../core/template-registry.js';
import { fusumaManifest } from '../Typing/templates/fusuma/manifest.js';

test('template registry registers, retrieves, and lists by game type', () => {
  const registry = createTemplateRegistry();
  registry.register(fusumaManifest);

  assert.equal(registry.get('typing', 'fusuma'), fusumaManifest);
  assert.deepEqual(registry.list('typing'), [fusumaManifest]);
  assert.deepEqual(registry.list('four-choice'), []);
  assert.equal(registry.get('typing', 'missing'), null);
});

test('template registry rejects duplicate game-type and template-id pairs', () => {
  const registry = createTemplateRegistry();
  registry.register(fusumaManifest);
  assert.throws(() => registry.register({ ...fusumaManifest }), /already registered/i);
});

test('fusuma manifest exposes every runtime image, audio role, and fixed timing', () => {
  assert.deepEqual(fusumaManifest.timings, {
    travelMs: 3200,
    answerHoldMs: 600,
    doorOpenMs: 1300,
    doorSettleMs: 150,
    resultArrivalMs: 330,
    resultRevealMs: 650,
    resultTransitionMs: 1250,
  });
  assert.equal(fusumaManifest.aspectRatio, '16 / 9');
  assert.deepEqual(Object.keys(fusumaManifest.runtime.modules), [
    'audioManager', 'romajiConverter', 'typingEngine', 'eventController', 'renderer',
  ]);
  assert.match(fusumaManifest.runtime.style, /style\.css$/);
  assert.match(fusumaManifest.assets.style, /style\.css$/);
  assert.deepEqual(Object.keys(fusumaManifest.assets.images).sort(), [
    'clear', 'cloudy', 'fusumaLeft', 'fusumaRight', 'rain', 'room', 'storm', 'sunny',
  ]);
  assert.deepEqual(Object.keys(fusumaManifest.assets.audio.results), [
    'storm', 'rain', 'cloudy', 'sunny', 'clear',
  ]);
  for (const source of Object.values(fusumaManifest.assets.images)) assert.match(source, /^file:|^https?:/);
  for (const source of [
    fusumaManifest.assets.audio.correct,
    fusumaManifest.assets.audio.travel,
    ...Object.values(fusumaManifest.assets.audio.results),
  ]) assert.match(source, /^file:|^https?:/);
});
