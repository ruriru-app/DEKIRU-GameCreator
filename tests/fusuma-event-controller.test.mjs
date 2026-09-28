import test from 'node:test';
import assert from 'node:assert/strict';
import { createFusumaEventController } from '../Typing/templates/fusuma/event-controller.js';

function createScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    runAll() {
      while (tasks.size) {
        const pending = [...tasks.values()].sort((a, b) => a.delay - b.delay);
        tasks.clear();
        pending.forEach(({ callback }) => callback());
      }
    },
    runDelay(delay) {
      const match = [...tasks.entries()].find(([, task]) => task.delay === delay);
      assert.ok(match, `scheduled task at ${delay}ms`);
      const [id, task] = match;
      tasks.delete(id);
      task.callback();
    },
    get delays() {
      return [...tasks.values()].map((task) => task.delay).sort((a, b) => a - b);
    },
    get size() {
      return tasks.size;
    },
  };
}

function setup() {
  const calls = [];
  const scheduler = createScheduler();
  const audioManager = {
    playLoop: (...args) => calls.push(['playLoop', ...args]),
    playEffect: (...args) => calls.push(['playEffect', ...args]),
    stopChannel: (...args) => calls.push(['stopChannel', ...args]),
    stopAll: (...args) => calls.push(['stopAll', ...args]),
  };
  const actions = {
    reset: () => calls.push(['reset']),
    startTravel: () => calls.push(['startTravel']),
    endTravel: () => calls.push(['endTravel']),
    showQuestion: () => calls.push(['showQuestion']),
    showWrong: () => calls.push(['showWrong']),
    showAnswer: () => calls.push(['showAnswer']),
    openDoor: () => calls.push(['openDoor']),
    fadeAnswer: () => calls.push(['fadeAnswer']),
    showResult: () => calls.push(['showResult']),
    revealResult: () => calls.push(['revealResult']),
  };
  const engine = {
    completeTravel: () => calls.push(['completeTravel']),
    completeDoorSequence: () => calls.push(['completeDoorSequence']),
  };
  const manifest = {
    timings: {
      travelMs: 3200,
      answerHoldMs: 600,
      doorOpenMs: 1300,
      doorSettleMs: 150,
      resultArrivalMs: 330,
      resultRevealMs: 650,
      resultTransitionMs: 1250,
    },
  };
  const controller = createFusumaEventController({ audioManager, manifest, scheduler, actions, engine });
  return { controller, calls, scheduler };
}

test('travel event plays the movement loop and ends it with the animation', () => {
  const { controller, calls, scheduler } = setup();
  controller.handle({ type: 'travel:start', detail: {} });

  assert.deepEqual(calls, [
    ['playLoop', 'movement', 'travel'],
    ['startTravel'],
  ]);

  scheduler.runAll();
  assert.deepEqual(calls.slice(-3), [
    ['stopChannel', 'movement', { fadeOutMs: 250 }],
    ['endTravel'],
    ['completeTravel'],
  ]);
});

test('correct answer stays visible before the door opens, then travel waits for the opening', () => {
  const { controller, calls, scheduler } = setup();
  controller.handle({ type: 'answer:wrong', detail: {} });
  controller.handle({ type: 'answer:correct', detail: {} });
  controller.handle({ type: 'door:open', detail: {} });

  assert.deepEqual(calls, [
    ['showWrong'],
    ['showAnswer'],
  ]);
  assert.deepEqual(scheduler.delays, [600, 2050]);

  scheduler.runDelay(600);
  assert.deepEqual(calls.slice(-2), [
    ['playEffect', 'correct'],
    ['openDoor'],
  ]);

  scheduler.runDelay(2050);
  assert.deepEqual(calls.at(-1), ['completeDoorSequence']);
});

test('result travels to a final closed fusuma before revealing the garden and compact panel', () => {
  const { controller, calls, scheduler } = setup();
  controller.handle({ type: 'result:shown', detail: { tier: 'sunny' } });

  assert.deepEqual(calls, [
    ['playLoop', 'movement', 'travel'],
    ['startTravel'],
  ]);
  assert.deepEqual(scheduler.delays, [3200]);

  scheduler.runDelay(3200);
  assert.deepEqual(calls.slice(-3), [
    ['stopChannel', 'movement', { fadeOutMs: 250 }],
    ['endTravel'],
    ['fadeAnswer'],
  ]);
  assert.deepEqual(scheduler.delays, [330]);

  scheduler.runDelay(330);
  assert.deepEqual(calls.at(-1), ['showResult']);
  assert.deepEqual(scheduler.delays, [650]);

  scheduler.runDelay(650);
  assert.deepEqual(calls.slice(-2), [
    ['revealResult'],
    ['playLoop', 'resultBgm', 'result-sunny', { fadeInMs: 1000 }],
  ]);
});

test('replay and cancel prevent old timers and audio from surviving', () => {
  const { controller, calls, scheduler } = setup();
  controller.handle({ type: 'travel:start', detail: {} });
  assert.equal(scheduler.size, 1);

  controller.handle({ type: 'game:replay', detail: {} });
  assert.equal(scheduler.size, 0);
  assert.deepEqual(calls.slice(-3), [
    ['stopChannel', 'movement', { fadeOutMs: 200 }],
    ['stopChannel', 'resultBgm', { fadeOutMs: 400 }],
    ['reset'],
  ]);

  controller.cancel();
  assert.deepEqual(calls.at(-1), ['stopAll']);
});
