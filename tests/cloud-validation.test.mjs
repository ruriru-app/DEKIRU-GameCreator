import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCloudProject, serializeCloudProject } from '../core/cloud/project-validation.js';
import { projectWith, projectBytes } from './fixtures/cloud-projects.mjs';

const check = (p, mode = 'publish') => validateCloudProject(p, { mode });
test('cloud accepts 200 questions, rejects 201, does not mutate inputs', () => {
  const p = projectWith(200), before = structuredClone(p);
  assert.equal(check(p).ok, true);
  assert.deepEqual(p, before);
  assert.equal(check(projectWith(201)).error.code, 'LIMIT');
});
test('cloud byte boundary is compact canonical UTF-8, not UTF-16 length', () => {
  assert.equal(Buffer.byteLength(serializeCloudProject(projectBytes(262144))), 262144);
  assert.equal(check(projectBytes(262144)).ok, true);
  assert.equal(check(projectBytes(262145)).error.code, 'LIMIT');
});
test('cloud codepoint limits count emoji and combining marks correctly', () => {
  for (const [field, limit] of [['prompt',1000], ['displayAnswer',200], ['reading',200], ['romajiHint',800]]) {
    const p = projectWith(); p.questions[0][field] = '😀'.repeat(limit);
    assert.equal(check(p).ok, true, field);
    p.questions[0][field] += 'x';
    assert.equal(check(p).error.code, 'LIMIT', field);
  }
  const p = projectWith(); p.title = '😀'.repeat(80);
  assert.equal(check(p).ok, true); p.title += 'x';
  assert.equal(check(p).error.code, 'LIMIT');
  p.title = 'e\u0301'.repeat(40);
  assert.equal(check(p).ok, true); p.title += '\u0301';
  assert.equal(check(p).ok, false);
});
test('draft permits incomplete content, publication requires nonblank title and fields', () => {
  const p = projectWith(0); p.title = '';
  assert.equal(check(p, 'draft').ok, true); assert.equal(check(p).ok, false);
  for (const field of ['prompt','displayAnswer','reading']) {
    const q = projectWith(); q.questions[0][field] = ' \n\t';
    assert.equal(check(q, 'draft').ok, true); assert.equal(check(q).ok, false);
  }
});
test('cloud rejects unknown properties, unsafe types, templates, duplicate or invalid ids', () => {
  const changes = [
    p => p.ownerId = 'other', p => p.templateId = 'other', p => p.settings.url = 'https://bad/',
    p => p.questions[0].script = 'alert(1)', p => p.settings.volume = NaN,
    p => p.settings.volume = 1.01, p => p.settings.muted = 'false',
    p => p.questions[0].id = 'x'.repeat(129), p => p.questions[0].id = '',
    p => p.questions[0].id = '../foo', p => p.questions[0].reading = 42,
    p => p.questions.push({...p.questions[0]}),
  ];
  for (const change of changes) { const p = projectWith(); change(p); assert.equal(check(p).ok, false); }
  for (const p of [null, [], {}, 1]) assert.equal(check(p).ok, false);
  assert.equal(validateCloudProject(projectWith(), {mode:'unknown'}).ok, false);
});
test('cloud rejects NUL and lone surrogates but permits literal HTML, tabs and line breaks', () => {
  for (const text of ['x\u0000y', '\ud800', '\udc00']) {
    const p = projectWith(); p.questions[0].prompt = text; assert.equal(check(p).ok, false);
  }
  const p = projectWith(); p.questions[0].prompt = '<img src=x onerror=alert(1)>\n\t😀';
  assert.equal(check(p).ok, true);
});
test('serialization fixes field order and returns a separate whitelisted project', () => {
  const p = projectWith(), reversed = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(serializeCloudProject(reversed), JSON.stringify(p));
  const result = check(p); result.data.questions[0].prompt = 'changed';
  assert.notEqual(p.questions[0].prompt, 'changed');
});
