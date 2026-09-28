export function resultTierForRate(rate) {
  if (rate < 30) return 'storm';
  if (rate < 50) return 'rain';
  if (rate < 80) return 'cloudy';
  if (rate < 100) return 'sunny';
  return 'clear';
}

export function createTypingEngine({ questions, onEvent = () => {}, convertRomaji }) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Typing game requires at least one question.');
  }
  if (typeof convertRomaji !== 'function') {
    throw new TypeError('convertRomaji must be a function.');
  }

  const sourceQuestions = Object.freeze(questions.map((question) => Object.freeze({ ...question })));
  const initialIndexes = sourceQuestions.map((_, index) => index);
  let queue = [];
  let missed = new Set();
  let initiallyMissed = new Set();
  let phase = 'idle';
  let round = 'main';
  let position = 0;
  let currentIndex = null;
  let firstTryCorrect = 0;
  let correctionMode = false;
  let wrongCount = 0;

  function getSnapshot() {
    return {
      phase,
      round,
      position,
      queue: [...queue],
      currentIndex,
      firstTryCorrect,
      total: sourceQuestions.length,
      reviewCount: initiallyMissed.size,
      correctionMode,
      wrongCount,
    };
  }

  function emit(type, detail = {}) {
    onEvent({ type, detail, snapshot: getSnapshot() });
  }

  function resetState() {
    queue = [...initialIndexes];
    missed = new Set();
    initiallyMissed = new Set();
    phase = 'idle';
    round = 'main';
    position = 0;
    currentIndex = queue[0];
    firstTryCorrect = 0;
    correctionMode = false;
    wrongCount = 0;
  }

  function beginTravel() {
    currentIndex = queue[position];
    correctionMode = false;
    wrongCount = 0;
    phase = 'travel';
    emit('travel:start', { questionIndex: currentIndex, round });
  }

  function start() {
    resetState();
    emit('game:start', { total: sourceQuestions.length });
    beginTravel();
    return true;
  }

  function completeTravel() {
    if (phase !== 'travel') return false;
    phase = 'question';
    emit('travel:end', { questionIndex: currentIndex, round });
    emit('question:shown', { question: sourceQuestions[currentIndex], questionIndex: currentIndex, round });
    return true;
  }

  function submitRomaji(value) {
    if (phase !== 'question') return { accepted: false, correct: false };
    const question = sourceQuestions[currentIndex];
    const converted = convertRomaji(value, true);

    if (converted !== question.reading) {
      if (!correctionMode) {
        missed.add(currentIndex);
        if (round === 'main') initiallyMissed.add(currentIndex);
        correctionMode = true;
      }
      wrongCount += 1;
      emit('answer:wrong', {
        question,
        converted,
        wrongCount,
        hint: wrongCount === 1 ? question.reading : question.romajiHint,
      });
      return { accepted: true, correct: false };
    }

    if (round === 'main' && !correctionMode) firstTryCorrect += 1;
    phase = 'door';
    emit('answer:correct', { question, questionIndex: currentIndex, round });
    emit('door:open', { question, questionIndex: currentIndex, round });
    return { accepted: true, correct: true };
  }

  function completeDoorSequence() {
    if (phase !== 'door') return false;
    position += 1;

    if (position < queue.length) {
      beginTravel();
      return true;
    }

    if (missed.size > 0) {
      queue = [...missed];
      missed = new Set();
      round = 'review';
      position = 0;
      beginTravel();
      return true;
    }

    phase = 'result';
    currentIndex = null;
    const rate = (firstTryCorrect / sourceQuestions.length) * 100;
    emit('result:shown', {
      rate,
      tier: resultTierForRate(rate),
      firstTryCorrect,
      total: sourceQuestions.length,
      reviewCount: initiallyMissed.size,
    });
    return true;
  }

  function replay() {
    emit('game:replay');
    return start();
  }

  return {
    start,
    completeTravel,
    submitRomaji,
    completeDoorSequence,
    replay,
    getSnapshot,
  };
}
