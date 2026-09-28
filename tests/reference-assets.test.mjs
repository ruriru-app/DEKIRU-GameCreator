import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const imageFiles = [
  'storm.png',
  'rain.png',
  'cloudy.png',
  'sunny.png',
  'clear.png',
  'room.png',
  'fusuma-left.png',
  'fusuma-right.png',
];

const audioFiles = [
  'correct.mp3',
  'travel-tatami.mp3',
  'result-storm.mp3',
  'result-rain.mp3',
  'result-cloudy.mp3',
  'result-sunny.mp3',
  'result-clear.mp3',
];

test('canonical fusuma PNG assets exist with a valid PNG signature', async () => {
  for (const filename of imageFiles) {
    const assetPath = path.join(root, 'Typing', 'templates', 'fusuma', 'assets', 'images', filename);
    const info = await stat(assetPath);
    assert.ok(info.size > 100, `${filename} should not be empty`);
    const bytes = await readFile(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filename} should be a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(width >= 1600, `${filename} should have at least 1600 pixels horizontally`);
    assert.ok(Math.abs(width / height - 16 / 9) < 0.002, `${filename} should be widescreen`);
  }
});

test('canonical fusuma MP3 assets exist with an MPEG or ID3 signature', async () => {
  for (const filename of audioFiles) {
    const assetPath = path.join(root, 'Typing', 'templates', 'fusuma', 'assets', 'audio', filename);
    const info = await stat(assetPath);
    assert.ok(info.size > 100, `${filename} should not be empty`);
    const bytes = await readFile(assetPath);
    const hasId3 = bytes.subarray(0, 3).toString('ascii') === 'ID3';
    const hasMpegFrame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    assert.ok(hasId3 || hasMpegFrame, `${filename} should be an MP3`);
  }
});
