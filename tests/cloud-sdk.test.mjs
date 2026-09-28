import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('SDK is local, pinned, bundled; no auth injected into protected standalone exporter',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.dependencies['@supabase/supabase-js'],'2.117.2');
  assert.equal(pkg.devDependencies.esbuild,'0.25.5');
  const sdk=await readFile(new URL('../vendor/supabase.js',import.meta.url),'utf8');
  assert.ok(sdk.length>10000);assert.doesNotMatch(sdk,/from\s*["']https?:/);
  const entry=await readFile(new URL('../core/cloud/sdk-entry.js',import.meta.url),'utf8');
  assert.match(entry,/flowType:\s*'pkce'/);assert.match(entry,/detectSessionInUrl:\s*false/);
  assert.match(entry,/storage:/);
  const exporter=await readFile(new URL('../core/html-exporter.js',import.meta.url),'utf8');
  assert.doesNotMatch(exporter,/supabase|core\/cloud/);
});
