const defaultScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

const noop = () => {};

export function createFusumaEventController({
  audioManager,
  manifest,
  engine,
  scheduler = defaultScheduler,
  actions = {},
}) {
  const view = {
    reset: actions.reset ?? noop,
    startTravel: actions.startTravel ?? noop,
    endTravel: actions.endTravel ?? noop,
    showQuestion: actions.showQuestion ?? noop,
    showWrong: actions.showWrong ?? noop,
    showAnswer: actions.showAnswer ?? noop,
    openDoor: actions.openDoor ?? noop,
    fadeAnswer: actions.fadeAnswer ?? noop,
    showResult: actions.showResult ?? noop,
    revealResult: actions.revealResult ?? noop,
  };
  const timers = new Set();

  function schedule(callback, delay) {
    const id = scheduler.setTimeout(() => {
      timers.delete(id);
      callback();
    }, delay);
    timers.add(id);
    return id;
  }

  function clearTimers() {
    for (const id of timers) scheduler.clearTimeout(id);
    timers.clear();
  }

  function handle(event) {
    switch (event.type) {
      case 'game:start':
        view.reset(event.detail);
        break;
      case 'game:replay':
        clearTimers();
        audioManager.stopChannel('movement', { fadeOutMs: 200 });
        audioManager.stopChannel('resultBgm', { fadeOutMs: 400 });
        view.reset(event.detail);
        break;
      case 'travel:start':
        audioManager.playLoop('movement', 'travel');
        view.startTravel(event.detail);
        schedule(() => {
          audioManager.stopChannel('movement', { fadeOutMs: 250 });
          view.endTravel(event.detail);
          engine.completeTravel();
        }, manifest.timings.travelMs);
        break;
      case 'question:shown':
        view.showQuestion(event.detail);
        break;
      case 'answer:wrong':
        view.showWrong(event.detail);
        break;
      case 'answer:correct':
        view.showAnswer(event.detail);
        break;
      case 'door:open':
        schedule(() => {
          audioManager.playEffect('correct');
          view.openDoor(event.detail);
        }, manifest.timings.answerHoldMs);
        schedule(
          () => engine.completeDoorSequence(),
          manifest.timings.answerHoldMs
            + manifest.timings.doorOpenMs
            + manifest.timings.doorSettleMs,
        );
        break;
      case 'result:shown':
        audioManager.playLoop('movement', 'travel');
        view.startTravel(event.detail);
        schedule(() => {
          audioManager.stopChannel('movement', { fadeOutMs: 250 });
          view.endTravel(event.detail);
          view.fadeAnswer(event.detail);
          schedule(() => {
            view.showResult(event.detail);
            schedule(() => {
              view.revealResult(event.detail);
              audioManager.playLoop('resultBgm', `result-${event.detail.tier}`, { fadeInMs: 1000 });
            }, manifest.timings.resultRevealMs);
          }, manifest.timings.resultArrivalMs);
        }, manifest.timings.travelMs);
        break;
      default:
        break;
    }
  }

  function cancel() {
    clearTimers();
    audioManager.stopAll();
  }

  return { handle, cancel };
}
