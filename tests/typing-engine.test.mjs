import test from 'node:test';
import assert from 'node:assert/strict';
import { romajiToHiragana } from '../Typing/core/romaji-converter.js';
import { createTypingEngine, resultTierForRate } from '../Typing/core/typing-engine.js';

const questions = [
  { id: 'q1', prompt: '問題1', displayAnswer: '答え1', reading: 'こたえ', romajiHint: 'kotae' },
  { id: 'q2', prompt: '問題2', displayAnswer: '答え2', reading: 'へいじょうきょう', romajiHint: 'heijoukyou' },
];

function makeEngine(items = questions) {
  const events = [];
  const engine = createTypingEngine({
    questions: items,
    convertRomaji: romajiToHiragana,
    onEvent: (event) => events.push(event),
  });
  return { engine, events };
}

test('engine emits the gameplay event order through the next travel', () => {
  const { engine, events } = makeEngine();

  engine.start();
  engine.completeTravel();
  assert.deepEqual(engine.submitRomaji('kotae'), { accepted: true, correct: true });
  engine.completeDoorSequence();

  assert.deepEqual(events.map((event) => event.type), [
    'game:start',
    'travel:start',
    'travel:end',
    'question:shown',
    'answer:correct',
    'door:open',
    'travel:start',
  ]);
  assert.equal(events[3].detail.question.id, 'q1');
  assert.equal(engine.getSnapshot().firstTryCorrect, 1);
});

test('a wrong first attempt enters review and result waits for review completion', () => {
  const { engine, events } = makeEngine([questions[0]]);

  engine.start();
  engine.completeTravel();
  assert.deepEqual(engine.submitRomaji('matigai'), { accepted: true, correct: false });
  assert.deepEqual(engine.submitRomaji('kotae'), { accepted: true, correct: true });
  engine.completeDoorSequence();

  assert.equal(engine.getSnapshot().round, 'review');
  assert.equal(events.some((event) => event.type === 'result:shown'), false);

  engine.completeTravel();
  engine.submitRomaji('kotae');
  engine.completeDoorSequence();

  const result = events.find((event) => event.type === 'result:shown');
  assert.deepEqual(result.detail, {
    rate: 0,
    tier: 'storm',
    firstTryCorrect: 0,
    total: 1,
    reviewCount: 1,
  });
});

test('resultTierForRate honors every result boundary', () => {
  const cases = [
    [0, 'storm'], [29, 'storm'],
    [30, 'rain'], [49, 'rain'],
    [50, 'cloudy'], [79, 'cloudy'],
    [80, 'sunny'], [99, 'sunny'],
    [100, 'clear'],
  ];
  for (const [rate, tier] of cases) assert.equal(resultTierForRate(rate), tier, `${rate}%`);
});

test('invalid completion calls are ignored without advancing state', () => {
  const { engine, events } = makeEngine();

  assert.equal(engine.completeTravel(), false);
  engine.start();
  assert.equal(engine.completeDoorSequence(), false);
  assert.deepEqual(engine.submitRomaji('kotae'), { accepted: false, correct: false });
  assert.deepEqual(events.map((event) => event.type), ['game:start', 'travel:start']);
});

test('replay resets queues and score before starting a fresh round', () => {
  const { engine, events } = makeEngine([questions[0]]);

  engine.start();
  engine.completeTravel();
  engine.submitRomaji('kotae');
  engine.completeDoorSequence();
  assert.equal(engine.getSnapshot().phase, 'result');

  engine.replay();

  assert.equal(engine.getSnapshot().phase, 'travel');
  assert.equal(engine.getSnapshot().firstTryCorrect, 0);
  assert.equal(engine.getSnapshot().position, 0);
  assert.deepEqual(events.slice(-3).map((event) => event.type), ['game:replay', 'game:start', 'travel:start']);
});

test('engine freezes its question copy so caller mutations do not affect play', () => {
  const mutable = [{ ...questions[0] }];
  const { engine } = makeEngine(mutable);
  mutable[0].reading = 'ちがう';

  engine.start();
  engine.completeTravel();

  assert.deepEqual(engine.submitRomaji('kotae'), { accepted: true, correct: true });
});

test('engine settles a trailing single n when an answer is submitted', () => {
  const question = { id: 'q-n', prompt: '読みは？', displayAnswer: '勘', reading: 'かん', romajiHint: 'kan' };
  const { engine } = makeEngine([question]);

  engine.start();
  engine.completeTravel();

  assert.deepEqual(engine.submitRomaji('kan'), { accepted: true, correct: true });
});
