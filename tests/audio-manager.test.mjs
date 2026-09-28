import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioManager } from '../core/audio-manager.js';

class FakeAudio {
  static instances = [];

  constructor(src) {
    this.src = src;
    this.loop = false;
    this.volume = 1;
    this.muted = false;
    this.currentTime = 0;
    this.playCount = 0;
    this.pauseCount = 0;
    FakeAudio.instances.push(this);
  }

  play() {
    this.playCount += 1;
    return Promise.resolve();
  }

  pause() {
    this.pauseCount += 1;
  }
}

function createFakeScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(callback) {
      const id = nextId++;
      tasks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    runAll(limit = 1000) {
      let count = 0;
      while (tasks.size) {
        if (count++ > limit) throw new Error('Fake scheduler did not settle');
        const pending = [...tasks.entries()];
        tasks.clear();
        for (const [, callback] of pending) callback();
      }
    },
    get size() {
      return tasks.size;
    },
  };
}

function setup() {
  FakeAudio.instances = [];
  const scheduler = createFakeScheduler();
  const manager = createAudioManager({ AudioCtor: FakeAudio, scheduler });
  manager.register('travel', 'travel.mp3');
  manager.register('correct', 'correct.mp3');
  manager.register('result', 'result.mp3');
  return { manager, scheduler };
}

test('playLoop applies looping, master volume, mute, and fade-in', () => {
  const { manager, scheduler } = setup();
  manager.setVolume(0.6);
  manager.setMuted(true);

  manager.playLoop('movement', 'travel', { fadeInMs: 200 });
  const audio = FakeAudio.instances[0];

  assert.equal(audio.loop, true);
  assert.equal(audio.playCount, 1);
  assert.equal(audio.volume, 0);
  assert.equal(audio.muted, true);
  scheduler.runAll();
  assert.equal(audio.volume, 0.6);
  assert.deepEqual(manager.getState().channels, { movement: 'travel' });
});

test('rapid replacement cancels the old channel before the new audio plays', () => {
  const { manager, scheduler } = setup();
  manager.playLoop('movement', 'travel', { fadeInMs: 200 });
  const oldAudio = FakeAudio.instances[0];
  oldAudio.currentTime = 1.25;

  manager.playLoop('movement', 'result');
  const newAudio = FakeAudio.instances[1];
  scheduler.runAll();

  assert.equal(oldAudio.pauseCount, 1);
  assert.equal(oldAudio.currentTime, 0);
  assert.equal(newAudio.playCount, 1);
  assert.deepEqual(manager.getState().channels, { movement: 'result' });
});

test('playEffect uses the effects channel and does not loop', () => {
  const { manager } = setup();
  manager.playEffect('correct');
  const audio = FakeAudio.instances[0];
  assert.equal(audio.loop, false);
  assert.equal(audio.playCount, 1);
  assert.deepEqual(manager.getState().channels, { effects: 'correct' });
});

test('stopChannel fades out, pauses, rewinds, and removes the channel', () => {
  const { manager, scheduler } = setup();
  manager.setVolume(0.8);
  manager.playLoop('resultBgm', 'result');
  const audio = FakeAudio.instances[0];
  audio.currentTime = 2;

  manager.stopChannel('resultBgm', { fadeOutMs: 200 });
  assert.equal(audio.pauseCount, 0);
  scheduler.runAll();

  assert.equal(audio.volume, 0);
  assert.equal(audio.pauseCount, 1);
  assert.equal(audio.currentTime, 0);
  assert.deepEqual(manager.getState().channels, {});
});

test('setVolume clamps values, setMuted updates active audio, and stopAll clears timers', () => {
  const { manager, scheduler } = setup();
  manager.playLoop('movement', 'travel', { fadeInMs: 500 });
  manager.playLoop('resultBgm', 'result');

  manager.setVolume(4);
  manager.setMuted(true);
  assert.equal(manager.getState().volume, 1);
  assert.equal(FakeAudio.instances.every((audio) => audio.muted), true);

  manager.stopAll();
  assert.equal(scheduler.size, 0);
  assert.equal(FakeAudio.instances.every((audio) => audio.pauseCount === 1 && audio.currentTime === 0), true);
  assert.deepEqual(manager.getState().channels, {});
});

test('a rejected browser play promise does not escape game flow', async () => {
  class RejectingAudio extends FakeAudio {
    play() {
      this.playCount += 1;
      return Promise.reject(new Error('blocked'));
    }
  }
  const manager = createAudioManager({ AudioCtor: RejectingAudio, scheduler: createFakeScheduler() });
  manager.register('travel', 'travel.mp3');

  assert.doesNotThrow(() => manager.playLoop('movement', 'travel'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.getState().channels, { movement: 'travel' });
});
