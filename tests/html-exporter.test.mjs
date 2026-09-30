import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStandaloneHtml, loadTemplateBundle, safeHtmlFilename } from '../core/html-exporter.js';
import {imageProject} from './fixtures/question-images.mjs';

const project = {
  schemaVersion: 1,
  title: '日本史 "A"\t& </script><script>alert(1)</script>\u2028改行',
  gameType: 'typing',
  templateId: 'fusuma',
  settings: { volume: 0.8, muted: false },
  questions: [{
    id: 'q1',
    prompt: '問題\n</script><script>bad()</script>',
    displayAnswer: '答え',
    reading: 'こたえ',
    romajiHint: 'kotae',
  }],
};

const fixtureBundle = {
  moduleSources: {
    audioManager: 'export function createAudioManager(){}',
    romajiConverter: 'export function romajiToHiragana(){}',
    typingEngine: 'export function createTypingEngine(){}',
    eventController: 'export function createFusumaEventController(){}',
    renderer: 'export function mountFusumaGame(){ /* ゲームを始める */ }',
  },
  styleText: '.game-frame{aspect-ratio:4/3}',
  aspectRatio: '4 / 3',
  timings: {
    travelMs: 3200,
    answerHoldMs: 600,
    doorOpenMs: 1300,
    doorSettleMs: 150,
    resultArrivalMs: 330,
    resultRevealMs: 650,
    resultTransitionMs: 1250,
  },
  images: {
    storm: 'data:image/png;base64,c3Rvcm0=', rain: 'data:image/png;base64,cmFpbg==',
    cloudy: 'data:image/png;base64,Y2xvdWR5', sunny: 'data:image/png;base64,c3Vubnk=',
    clear: 'data:image/png;base64,Y2xlYXI=', room: 'data:image/png;base64,cm9vbQ==',
    fusumaLeft: 'data:image/png;base64,bGVmdA==', fusumaRight: 'data:image/png;base64,cmlnaHQ=',
  },
  audio: {
    correct: 'data:audio/mpeg;base64,Y29ycmVjdA==',
    travel: 'data:audio/mpeg;base64,dHJhdmVs',
    doorOpen: null,
    wrong: null,
    results: {
      storm: 'data:audio/mpeg;base64,c3Rvcm0=', rain: 'data:audio/mpeg;base64,cmFpbg==',
      cloudy: 'data:audio/mpeg;base64,Y2xvdWR5', sunny: 'data:audio/mpeg;base64,c3Vubnk=',
      clear: 'data:audio/mpeg;base64,Y2xlYXI=',
    },
  },
};

function extractJsonScript(html, id) {
  const match = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${id} JSON script should exist`);
  return JSON.parse(match[1]);
}

test('buildStandaloneHtml safely embeds hostile project text and local data assets', () => {
  const html = buildStandaloneHtml({ project, bundle: fixtureBundle });

  assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1);
  assert.equal(html.includes('</script><script>alert(1)</script>'), false);
  assert.equal(html.includes('</script><script>bad()</script>'), false);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /data:audio\/mpeg;base64,/);
  assert.doesNotMatch(html, /<(?:script|link|img|audio)[^>]+(?:src|href)=["']https?:/i);
  assert.deepEqual(extractJsonScript(html, 'project-data'), project);
  assert.equal(html.includes('HTMLを書き出す'), false);
});

test('standalone document includes every runtime module, tier, timing, and error surface', () => {
  const html = buildStandaloneHtml({ project, bundle: fixtureBundle });
  const importMap = extractJsonScript(html, 'runtime-import-map');
  assert.deepEqual(Object.keys(importMap.imports).sort(), [
    '@dekiru/audio-manager',
    '@dekiru/fusuma-event-controller',
    '@dekiru/fusuma-renderer',
    '@dekiru/romaji-converter',
    '@dekiru/typing-engine',
  ]);
  for (const value of Object.values(importMap.imports)) assert.match(value, /^data:text\/javascript;base64,/);

  const template = extractJsonScript(html, 'template-data');
  assert.deepEqual(template.timings, fixtureBundle.timings);
  assert.deepEqual(Object.keys(template.assets.audio.results), ['storm', 'rain', 'cloudy', 'sunny', 'clear']);
  assert.match(template.assets.style, /^data:text\/css;base64,/);
  assert.match(html, /id="game-host"/);
  assert.match(html, /id="runtime-error"/);
  assert.match(Buffer.from(importMap.imports['@dekiru/fusuma-renderer'].split(',')[1], 'base64').toString('utf8'), /ゲームを始める/);
});

test('loadTemplateBundle requests module text, style text, and every binary asset', async () => {
  const requested = [];
  const manifest = {
    aspectRatio: '4 / 3',
    timings: fixtureBundle.timings,
    runtime: {
      modules: { renderer: '/renderer.js', engine: '/engine.js' },
      style: '/style.css',
    },
    assets: {
      images: { room: '/room.png' },
      audio: { correct: '/correct.mp3', travel: '/travel.mp3', doorOpen: null, wrong: null, results: { clear: '/clear.mp3' } },
    },
  };
  const loader = {
    async loadText(url) { requested.push(['text', url]); return `text:${url}`; },
    async loadDataUrl(url) { requested.push(['data', url]); return `data:fixture,${url}`; },
  };

  const bundle = await loadTemplateBundle(manifest, loader);

  assert.deepEqual(requested, [
    ['text', '/renderer.js'], ['text', '/engine.js'], ['text', '/style.css'],
    ['data', '/room.png'], ['data', '/correct.mp3'], ['data', '/travel.mp3'], ['data', '/clear.mp3'],
  ]);
  assert.equal(bundle.moduleSources.renderer, 'text:/renderer.js');
  assert.equal(bundle.images.room, 'data:fixture,/room.png');
  assert.equal(bundle.audio.doorOpen, null);
});

test('safeHtmlFilename removes Windows-invalid characters and never doubles the extension', () => {
  assert.equal(safeHtmlFilename(''), 'typing-game.html');
  assert.equal(safeHtmlFilename('  .  '), 'typing-game.html');
  assert.equal(safeHtmlFilename('奈良時代.html'), '奈良時代.html');
  const safe = safeHtmlFilename('算数:*?"<>|. ');
  assert.match(safe, /^算数_+\.html$/);
  assert.doesNotMatch(safe, /[<>:"/\\|?*]/);
});

test('image projects are embedded intact but untrusted image sources cannot be exported', () => {
  const p=imageProject();
  assert.deepEqual(extractJsonScript(buildStandaloneHtml({project:p,bundle:fixtureBundle}),'project-data'),p);
  p.questions[0].image.dataUrl='https://example.invalid/tracking.png';
  assert.throws(()=>buildStandaloneHtml({project:p,bundle:fixtureBundle}));
});
