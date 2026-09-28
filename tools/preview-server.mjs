import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.mp3', 'audio/mpeg'],
  ['.svg', 'image/svg+xml'],
]);

function resolveRequestPath(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  } catch {
    return { status: 400 };
  }
  pathname = pathname.replaceAll('\\', '/');
  if (pathname.split('/').includes('..')) return { status: 403 };
  if (pathname === '/') pathname = '/app/index.html';

  const target = path.resolve(root, pathname.replace(/^\/+/, ''));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { status: 403 };
  return { status: 200, target };
}

export async function createPreviewServer({ root, port = 4173 }) {
  const absoluteRoot = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    const resolved = resolveRequestPath(absoluteRoot, request.url ?? '/');
    if (resolved.status !== 200) {
      response.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(resolved.status === 403 ? 'Forbidden' : 'Bad Request');
      return;
    }

    try {
      const info = await stat(resolved.target);
      if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
      const body = await readFile(resolved.target);
      const type = mimeTypes.get(path.extname(resolved.target).toLowerCase()) ?? 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      const statusCode = error?.code === 'ENOENT' ? 404 : 500;
      response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(statusCode === 404 ? 'Not Found' : 'Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const portIndex = process.argv.indexOf('--port');
  const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4173;
  const preview = await createPreviewServer({ root, port: Number.isInteger(requestedPort) ? requestedPort : 4173 });
  process.stdout.write(`DEKIRU Game Creator: ${preview.url}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
