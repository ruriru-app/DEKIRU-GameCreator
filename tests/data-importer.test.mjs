import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTabularRows, validateRows } from '../core/data-importer.js';

const schema = [
  { key: 'prompt', label: '問題', required: true },
  { key: 'displayAnswer', label: '正解', required: true },
  { key: 'reading', label: 'よみ', required: true },
];

test('parseTabularRows trims cells, ignores blank lines, and preserves source rows', () => {
  const input = [
    '  問題1  \t 答え1 \t よみ1  ',
    '',
    '問題2\t答え2\tよみ2',
  ].join('\r\n');

  const result = parseTabularRows(input, schema);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    { sourceRow: 1, prompt: '問題1', displayAnswer: '答え1', reading: 'よみ1' },
    { sourceRow: 3, prompt: '問題2', displayAnswer: '答え2', reading: 'よみ2' },
  ]);
});

test('parseTabularRows reports short and extra rows without losing valid neighbors', () => {
  const input = [
    '有効1\t答え1\tよみ1',
    '不足\t答え2',
    '余分\t答え3\tよみ3\t余計',
    '有効4\t答え4\tよみ4',
  ].join('\n');

  const result = parseTabularRows(input, schema);

  assert.deepEqual(result.rows, [
    { sourceRow: 1, prompt: '有効1', displayAnswer: '答え1', reading: 'よみ1' },
    { sourceRow: 2, prompt: '不足', displayAnswer: '答え2', reading: '' },
    { sourceRow: 4, prompt: '有効4', displayAnswer: '答え4', reading: 'よみ4' },
  ]);
  assert.deepEqual(result.errors.map(({ sourceRow, code, field }) => ({ sourceRow, code, field })), [
    { sourceRow: 2, code: 'column-count', field: undefined },
    { sourceRow: 2, code: 'required', field: 'reading' },
    { sourceRow: 3, code: 'column-count', field: undefined },
  ]);
});

test('validateRows reports an empty set and required fields with row numbers', () => {
  assert.deepEqual(validateRows([], schema), [
    { sourceRow: null, code: 'empty', field: null, message: '問題を1問以上入力してください。' },
  ]);

  assert.deepEqual(validateRows([
    { sourceRow: 7, prompt: '問題', displayAnswer: ' ', reading: '' },
  ], schema).map(({ sourceRow, code, field }) => ({ sourceRow, code, field })), [
    { sourceRow: 7, code: 'required', field: 'displayAnswer' },
    { sourceRow: 7, code: 'required', field: 'reading' },
  ]);
});

