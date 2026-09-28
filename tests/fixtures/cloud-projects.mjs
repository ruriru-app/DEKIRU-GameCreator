export function projectWith(count = 1) {
  return {
    schemaVersion: 1, title: '日本語の教材', gameType: 'typing', templateId: 'fusuma',
    settings: { volume: 0.6, muted: false },
    questions: Array.from({ length: count }, (_, i) => ({
      id: 'q-' + i, prompt: '問題' + i, displayAnswer: '正解', reading: 'せいかい', romajiHint: '',
    })),
  };
}

// Exact compact-JSON UTF-8 byte boundaries, without exceeding field limits.
export function projectBytes(size) {
  const p = projectWith(200);
  let remaining = size - Buffer.byteLength(JSON.stringify(p));
  for (const q of p.questions) {
    const extra = Math.min(remaining, 1000 - [...q.prompt].length);
    q.prompt += 'x'.repeat(extra);
    remaining -= extra;
    const hint = Math.min(remaining, 800);
    q.romajiHint += 'x'.repeat(hint);
    remaining -= hint;
  }
  if (remaining) throw new Error('Cannot construct byte fixture');
  return p;
}
