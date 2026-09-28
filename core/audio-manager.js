const defaultScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

export function createAudioManager({ AudioCtor = globalThis.Audio, scheduler = defaultScheduler } = {}) {
  if (typeof AudioCtor !== 'function') throw new TypeError('AudioCtor must be a constructor.');

  const sources = new Map();
  const channels = new Map();
  let volume = 1;
  let muted = false;

  function applyEntryVolume(entry) {
    entry.audio.volume = Math.max(0, Math.min(1, volume * entry.fadeFactor));
    entry.audio.muted = muted;
  }

  function cancelFade(entry) {
    if (entry.timer !== null) scheduler.clearTimeout(entry.timer);
    entry.timer = null;
    entry.fadeToken += 1;
  }

  function stopImmediately(entry) {
    cancelFade(entry);
    entry.audio.pause();
    entry.audio.currentTime = 0;
  }

  function fadeTo(entry, target, duration, onComplete = () => {}) {
    cancelFade(entry);
    if (!(duration > 0)) {
      entry.fadeFactor = target;
      applyEntryVolume(entry);
      onComplete();
      return;
    }

    const token = entry.fadeToken;
    const start = entry.fadeFactor;
    const steps = Math.max(1, Math.ceil(duration / 50));
    const delay = Math.ceil(duration / steps);
    let step = 0;

    const tick = () => {
      if (entry.fadeToken !== token) return;
      step += 1;
      entry.fadeFactor = start + ((target - start) * step / steps);
      applyEntryVolume(entry);
      if (step < steps) {
        entry.timer = scheduler.setTimeout(tick, delay);
      } else {
        entry.timer = null;
        onComplete();
      }
    };

    entry.timer = scheduler.setTimeout(tick, delay);
  }

  function playChannel(channel, key, { loop, fadeInMs = 0 } = {}) {
    const src = sources.get(key);
    if (!src) throw new Error(`Audio source is not registered: ${key}`);

    const existing = channels.get(channel);
    if (existing) stopImmediately(existing);

    const audio = new AudioCtor(src);
    const entry = {
      key,
      audio,
      fadeFactor: fadeInMs > 0 ? 0 : 1,
      fadeToken: 0,
      timer: null,
    };
    audio.loop = Boolean(loop);
    applyEntryVolume(entry);
    channels.set(channel, entry);

    try {
      const playResult = audio.play();
      if (playResult?.catch) playResult.catch(() => {});
    } catch {
      // Audio is optional; game flow must continue when playback is unavailable.
    }

    if (fadeInMs > 0) fadeTo(entry, 1, fadeInMs);
    return audio;
  }

  function register(key, src) {
    if (!key || !src) throw new TypeError('Audio registration requires key and src.');
    sources.set(key, src);
  }

  function playEffect(key) {
    return playChannel('effects', key, { loop: false });
  }

  function playLoop(channel, key, { fadeInMs = 0 } = {}) {
    return playChannel(channel, key, { loop: true, fadeInMs });
  }

  function stopChannel(channel, { fadeOutMs = 0 } = {}) {
    const entry = channels.get(channel);
    if (!entry) return false;

    const finish = () => {
      if (channels.get(channel) !== entry) return;
      stopImmediately(entry);
      channels.delete(channel);
    };
    fadeTo(entry, 0, fadeOutMs, finish);
    return true;
  }

  function setVolume(value) {
    const number = Number(value);
    volume = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : volume;
    for (const entry of channels.values()) applyEntryVolume(entry);
  }

  function setMuted(value) {
    muted = Boolean(value);
    for (const entry of channels.values()) applyEntryVolume(entry);
  }

  function stopAll() {
    for (const entry of channels.values()) stopImmediately(entry);
    channels.clear();
  }

  function getState() {
    return {
      volume,
      muted,
      channels: Object.fromEntries([...channels.entries()].map(([channel, entry]) => [channel, entry.key])),
    };
  }

  return { register, playEffect, playLoop, stopChannel, setVolume, setMuted, stopAll, getState };
}
