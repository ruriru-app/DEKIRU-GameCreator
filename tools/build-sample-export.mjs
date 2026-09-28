import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml, loadTemplateBundle } from '../core/html-exporter.js';
import { fusumaManifest } from '../Typing/templates/fusuma/manifest.js';

const mimeByExtension = {
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

const fileLoader = {
  async loadText(url) {
    return readFile(fileURLToPath(url), 'utf8');
  },
  async loadDataUrl(url) {
    const filePath = fileURLToPath(url);
    const bytes = await readFile(filePath);
    const mime = mimeByExtension[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  },
};

const project = {
  schemaVersion: 1,
  title: '奈良時代タイピング・サンプル',
  gameType: 'typing',
  templateId: 'fusuma',
  settings: { volume: 0.8, muted: false },
  questions: [
    {
      id: 'sample-1',
      prompt: '743年、開墾した土地を永久に自分のものにしてよいと定めた法律は？',
      displayAnswer: '墾田永年私財法',
      reading: 'こんでんえいねんしざいほう',
      romajiHint: "konden'einenshizaihou",
    },
    {
      id: 'sample-2',
      prompt: '唐の都・長安にならって、710年につくられた都は？',
      displayAnswer: '平城京',
      reading: 'へいじょうきょう',
      romajiHint: 'heijoukyou',
    },
  ],
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'dist', 'typing-fusuma-sample.html');
const bundle = await loadTemplateBundle(fusumaManifest, fileLoader);
const html = buildStandaloneHtml({ project, bundle });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, 'utf8');
process.stdout.write(`Built ${outputPath} (${Buffer.byteLength(html, 'utf8')} bytes).\n`);
