import {normalizeProjectData} from './project-format.js';

const moduleSpecifiers = {
  audioManager: '@dekiru/audio-manager',
  romajiConverter: '@dekiru/romaji-converter',
  typingEngine: '@dekiru/typing-engine',
  eventController: '@dekiru/fusuma-event-controller',
  renderer: '@dekiru/fusuma-renderer',
};

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  }[character]));
}

export function createBrowserResourceLoader({ fetchImpl = globalThis.fetch } = {}) {
  async function fetchLocal(url) {
    const resolved = new URL(url, globalThis.location?.href);
    if (globalThis.location && ['http:', 'https:'].includes(resolved.protocol) && resolved.origin !== globalThis.location.origin) {
      throw new Error(`Cross-origin export resource is not allowed: ${resolved.href}`);
    }
    const response = await fetchImpl(resolved.href);
    if (!response.ok) throw new Error(`Resource load failed (${response.status}): ${resolved.href}`);
    return response;
  }

  return {
    async loadText(url) {
      return (await fetchLocal(url)).text();
    },
    async loadDataUrl(url) {
      const response = await fetchLocal(url);
      const mime = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
      const bytes = new Uint8Array(await response.arrayBuffer());
      return `data:${mime};base64,${bytesToBase64(bytes)}`;
    },
  };
}

export async function loadTemplateBundle(manifest, resourceLoader = createBrowserResourceLoader()) {
  const moduleSources = {};
  for (const [name, url] of Object.entries(manifest.runtime.modules)) {
    moduleSources[name] = await resourceLoader.loadText(url);
  }
  const styleText = await resourceLoader.loadText(manifest.runtime.style);

  const images = {};
  for (const [name, url] of Object.entries(manifest.assets.images)) {
    images[name] = await resourceLoader.loadDataUrl(url);
  }

  const audio = {
    correct: manifest.assets.audio.correct ? await resourceLoader.loadDataUrl(manifest.assets.audio.correct) : null,
    travel: manifest.assets.audio.travel ? await resourceLoader.loadDataUrl(manifest.assets.audio.travel) : null,
    doorOpen: manifest.assets.audio.doorOpen ? await resourceLoader.loadDataUrl(manifest.assets.audio.doorOpen) : null,
    wrong: manifest.assets.audio.wrong ? await resourceLoader.loadDataUrl(manifest.assets.audio.wrong) : null,
    results: {},
  };
  for (const [tier, url] of Object.entries(manifest.assets.audio.results)) {
    audio.results[tier] = await resourceLoader.loadDataUrl(url);
  }

  return {
    moduleSources,
    styleText,
    aspectRatio: manifest.aspectRatio,
    timings: { ...manifest.timings },
    images,
    audio,
  };
}

export function buildStandaloneHtml({ project, bundle }) {
  project = normalizeProjectData(project);
  const imports = {};
  for (const [name, source] of Object.entries(bundle.moduleSources)) {
    const specifier = moduleSpecifiers[name];
    if (!specifier) throw new Error(`Unknown runtime module: ${name}`);
    imports[specifier] = `data:text/javascript;base64,${textToBase64(source)}`;
  }

  const importMap = { imports };
  const template = {
    id: 'fusuma',
    name: '和室・襖',
    gameType: 'typing',
    aspectRatio: bundle.aspectRatio,
    timings: bundle.timings,
    assets: {
      style: `data:text/css;base64,${textToBase64(bundle.styleText)}`,
      images: bundle.images,
      audio: bundle.audio,
    },
  };

  const projectJson = escapeJsonForHtml(project);
  const templateJson = escapeJsonForHtml(template);
  const importMapJson = escapeJsonForHtml(importMap);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${String(project.title || 'Typing Game').replace(/[<>&"']/g, '')}</title>
  <style>
    :root{color:#514842;background:#21160f;font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",system-ui,sans-serif}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
    main{width:100%;height:100vh;height:100dvh}.game-wrap{width:100%;height:100%}
    #game-host{width:100%;height:100%;--game-height:100%;--game-radius:0px;--game-shadow:none}
    .loading{display:grid;place-items:center;width:100%;height:100%;aspect-ratio:${bundle.aspectRatio};color:#7a6e65;background:#ede3d7;font-weight:800}
    #runtime-error{position:fixed;inset:16px 16px auto;z-index:100;margin:0;padding:14px;border-radius:12px;color:#842f35;background:#fff0f0;font-weight:700}[hidden]{display:none!important}
  </style>
  <script type="importmap">${importMapJson}</script>
</head>
<body>
  <main>
    <div class="game-wrap"><div id="game-host"><div class="loading">ゲームを読み込んでいます…</div></div></div>
    <p id="runtime-error" role="alert" hidden>ゲームの読み込みに失敗しました。ファイルをもう一度開いてください。</p>
  </main>
  <script type="application/json" id="project-data">${projectJson}</script>
  <script type="application/json" id="template-data">${templateJson}</script>
  <script type="application/json" id="runtime-import-map">${importMapJson}</script>
  <script type="module">
    try {
      const [audioModule, converterModule, engineModule, controllerModule, rendererModule] = await Promise.all([
        import('@dekiru/audio-manager'),
        import('@dekiru/romaji-converter'),
        import('@dekiru/typing-engine'),
        import('@dekiru/fusuma-event-controller'),
        import('@dekiru/fusuma-renderer')
      ]);
      const project = JSON.parse(document.querySelector('#project-data').textContent);
      const manifest = JSON.parse(document.querySelector('#template-data').textContent);
      const audioManager = audioModule.createAudioManager();
      const game = rendererModule.mountFusumaGame({
        host: document.querySelector('#game-host'), project, manifest, audioManager,
        createEngine: engineModule.createTypingEngine,
        convertRomaji: converterModule.romajiToHiragana,
        createEventController: controllerModule.createFusumaEventController
      });
      game.setVolume(project.settings?.volume ?? 0.8);
      game.setMuted(project.settings?.muted ?? false);
      globalThis.__DEKIRU_GAME__ = game;
    } catch (error) {
      console.error(error);
      document.querySelector('#runtime-error').hidden = false;
    }
  </script>
</body>
</html>`;
}

export function safeHtmlFilename(title) {
  let name = String(title ?? '').trim().replace(/\.html?$/i, '');
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return `${name || 'typing-game'}.html`;
}

export function downloadStandaloneHtml({ html, filename, documentRef = document, urlApi = URL }) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeHtmlFilename(filename);
  anchor.hidden = true;
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => urlApi.revokeObjectURL(objectUrl), 0);
}
