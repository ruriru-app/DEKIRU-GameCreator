import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPreviewServer } from '../tools/preview-server.mjs';

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        type: response.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
  });
}

test('preview server serves files with MIME types and blocks traversal', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dekiru-preview-'));
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app', 'index.html'), '<h1>DEKIRU</h1>');
  await writeFile(path.join(root, 'app', 'module.js'), 'export const ok = true;');
  const preview = await createPreviewServer({ root, port: 0 });
  context.after(() => preview.close());

  const page = await rawRequest(preview.port, '/app/index.html');
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.equal(page.body, '<h1>DEKIRU</h1>');

  const appRoot = await rawRequest(preview.port, '/');
  assert.equal(appRoot.status, 200);
  assert.match(appRoot.type, /^text\/html/);
  assert.equal(appRoot.body, '<h1>DEKIRU</h1>');

  const script = await rawRequest(preview.port, '/app/module.js');
  assert.equal(script.status, 200);
  assert.match(script.type, /^text\/javascript/);

  assert.equal((await rawRequest(preview.port, '/missing')).status, 404);
  assert.equal((await rawRequest(preview.port, '/%2e%2e%2fsecret.txt')).status, 403);
});
