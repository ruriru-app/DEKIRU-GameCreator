import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('finished fusuma runtime, assets, audio and HTML exporter match published baseline', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/runtime-baseline.json',import.meta.url),'utf8'));
  for (const [file,expected] of Object.entries(baseline.files)) {
    let bytes = await readFile(new URL('../'+file, import.meta.url));
    // Git checkout can use CRLF; compare canonical Git content for text files.
    if (/\.(js|css)$/.test(file)) bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,file);
  }
});
