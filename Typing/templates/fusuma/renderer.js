function registerTemplateAudio(audioManager, manifest) {
  audioManager.register('correct', manifest.assets.audio.correct);
  audioManager.register('travel', manifest.assets.audio.travel);
  for (const [tier, source] of Object.entries(manifest.assets.audio.results)) {
    audioManager.register(`result-${tier}`, source);
  }
}

function shellMarkup(manifest) {
  const stylesheet = manifest.assets.style ?? new URL('./style.css', import.meta.url).href;
  // Reuse the identical room/detail composite before and after arrival.
  // The leaf wrappers clip its left and right halves without re-framing it.
  const roomLayers = (detailSource) => `
    <img class="room-image" src="${manifest.assets.images.room}" alt="">
    <img class="door-detail" src="${detailSource}" alt="">`;
  return `
    <link rel="stylesheet" href="${stylesheet}">
    <div class="game-frame" style="width:100%;height:var(--game-height,auto);aspect-ratio:${manifest.aspectRatio};position:relative;overflow:hidden;--travel-duration:${manifest.timings.travelMs}ms;--door-duration:${manifest.timings.doorOpenMs}ms;--result-transition-duration:${manifest.timings.resultTransitionMs}ms">
      <div class="stage" data-role="stage">
        <img class="result-background" data-role="result-background" alt="" hidden>
        <div class="room-wrap" data-role="room-wrap">
          ${roomLayers(manifest.assets.images.fusumaLeft)}
        </div>
        <div class="leaf leaf-left"><div class="door-world">${roomLayers(manifest.assets.images.fusumaLeft)}</div></div>
        <div class="leaf leaf-right"><div class="door-world">${roomLayers(manifest.assets.images.fusumaRight)}</div></div>
        <div class="status" data-role="status">Typing</div>
        <form class="quiz-panel" data-role="quiz" hidden>
          <p class="question" data-role="question"></p>
          <p class="kana-preview" data-role="kana-preview" aria-live="polite"></p>
          <label class="input-label">ローマ字で入力
            <input data-role="input" autocomplete="off" autocapitalize="off" spellcheck="false">
          </label>
          <p class="feedback" data-role="feedback" aria-live="polite">間違えたらヒントが表示されます</p>
        </form>
        <section class="answer-card" data-role="answer-card" hidden>
          <span>正解</span>
          <strong data-role="answer"></strong>
          <small data-role="reading"></small>
        </section>
        <section class="result-card" data-role="result-card" hidden>
          <strong>全問クリア！</strong>
          <p data-role="result-text"></p>
          <button type="button" data-role="replay">もう一度</button>
        </section>
        <button class="start-cover" type="button" data-role="start">ゲームを始める</button>
      </div>
    </div>`;
}

export function mountFusumaGame({
  host,
  project,
  manifest,
  audioManager,
  createEngine,
  convertRomaji,
  createEventController,
  scheduler,
}) {
  if (!(host instanceof Element)) throw new TypeError('host must be an Element.');
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = shellMarkup(manifest);
  registerTemplateAudio(audioManager, manifest);

  const stage = shadow.querySelector('[data-role="stage"]');
  const roomWrap = shadow.querySelector('[data-role="room-wrap"]');
  const quiz = shadow.querySelector('[data-role="quiz"]');
  const question = shadow.querySelector('[data-role="question"]');
  const kanaPreview = shadow.querySelector('[data-role="kana-preview"]');
  const input = shadow.querySelector('[data-role="input"]');
  const feedback = shadow.querySelector('[data-role="feedback"]');
  const answerCard = shadow.querySelector('[data-role="answer-card"]');
  const answer = shadow.querySelector('[data-role="answer"]');
  const reading = shadow.querySelector('[data-role="reading"]');
  const resultCard = shadow.querySelector('[data-role="result-card"]');
  const resultText = shadow.querySelector('[data-role="result-text"]');
  const resultBackground = shadow.querySelector('[data-role="result-background"]');
  const status = shadow.querySelector('[data-role="status"]');
  const startButton = shadow.querySelector('[data-role="start"]');
  const replayButton = shadow.querySelector('[data-role="replay"]');

  let currentProject = structuredClone(project);
  let engine = null;
  let eventController = null;
  let started = false;
  const defaultFeedback = '間違えたらヒントが表示されます';
  const imeFeedback = '英数入力に切り替えてください（Windowsは「半角／全角」キー）。この入力は誤答に数えません。';
  let answerFeedback = defaultFeedback;
  let composing = false;
  let suppressCompositionSubmit = false;
  let compositionGuardTimer = null;

  function resetInputAssistance() {
    globalThis.clearTimeout(compositionGuardTimer);
    compositionGuardTimer = null;
    composing = false;
    suppressCompositionSubmit = false;
    answerFeedback = defaultFeedback;
    quiz.classList.remove('is-wrong', 'is-input-warning', 'is-shaking');
  }

  function showInputWarning() {
    quiz.classList.add('is-input-warning');
    kanaPreview.textContent = '';
    feedback.textContent = imeFeedback;
  }

  function hasJapaneseInput() {
    return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\u3001-\u303f\u30fc\uff61-\uff9f]/u.test(input.value);
  }

  function normalizeInputWidth() {
    // Change ASCII width only; never convert kana or alter the romaji rules.
    const normalized = input.value.replace(/[！-～]/g, character =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
    if (normalized === input.value) return;
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.value = normalized;
    input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  }

  function guardCompositionSubmit() {
    suppressCompositionSubmit = true;
    globalThis.clearTimeout(compositionGuardTimer);
    // The confirming Enter can submit after compositionend in the same turn.
    compositionGuardTimer = globalThis.setTimeout(() => {
      suppressCompositionSubmit = false;
      compositionGuardTimer = null;
    }, 0);
  }

  const actions = {
    reset() {
      resetInputAssistance();
      stage.classList.remove('is-at-door', 'is-open', 'is-moving', 'is-result');
      roomWrap.classList.remove('is-forward');
      quiz.hidden = true;
      answerCard.hidden = true;
      answerCard.classList.remove('is-fading');
      resultCard.hidden = true;
      resultCard.classList.remove('is-compact');
      resultBackground.hidden = true;
      resultBackground.removeAttribute('src');
      feedback.textContent = '間違えたらヒントが表示されます';
      input.value = '';
      kanaPreview.textContent = '';
    },
    startTravel() {
      quiz.hidden = true;
      stage.classList.remove('is-at-door', 'is-open', 'is-result');
      stage.classList.add('is-moving');
      roomWrap.classList.remove('is-forward');
      void roomWrap.offsetWidth;
      roomWrap.classList.add('is-forward');
      status.textContent = '移動中…';
    },
    endTravel() {
      stage.classList.remove('is-moving');
      stage.classList.add('is-at-door');
      roomWrap.classList.remove('is-forward');
    },
    showQuestion(detail) {
      resetInputAssistance();
      const snapshot = engine.getSnapshot?.();
      question.textContent = detail.question.prompt;
      status.textContent = detail.round === 'review'
        ? `復習 ${Number(snapshot?.position ?? 0) + 1}/${snapshot?.queue?.length ?? 1}`
        : `問題 ${Number(snapshot?.position ?? 0) + 1}/${snapshot?.queue?.length ?? currentProject.questions.length}`;
      input.value = '';
      kanaPreview.textContent = '';
      feedback.textContent = '間違えたらヒントが表示されます';
      answerCard.hidden = true;
      answerCard.classList.remove('is-fading');
      quiz.hidden = false;
      input.focus({ preventScroll: true });
    },
    showWrong(detail) {
      answerFeedback = `⚠️ ${detail.hint}`;
      feedback.textContent = answerFeedback;
      quiz.classList.add('is-wrong');
      quiz.classList.remove('is-input-warning', 'is-shaking');
      void quiz.offsetWidth;
      quiz.classList.add('is-shaking');
      // With reduced motion there is no animationend event to clean up.
      if (getComputedStyle(quiz).animationName === 'none') {
        quiz.classList.remove('is-shaking');
      }
      input.value = '';
      kanaPreview.textContent = '';
      input.focus({ preventScroll: true });
    },
    showAnswer(detail) {
      quiz.hidden = true;
      quiz.classList.remove('is-shaking');
      answer.textContent = detail.question.displayAnswer;
      reading.textContent = detail.question.reading;
      answerCard.classList.remove('is-fading');
      answerCard.hidden = false;
    },
    openDoor() {
      stage.classList.add('is-open');
    },
    fadeAnswer() {
      answerCard.classList.add('is-fading');
    },
    showResult(detail) {
      quiz.hidden = true;
      answerCard.hidden = true;
      answerCard.classList.remove('is-fading');
      resultBackground.src = manifest.assets.images[detail.tier];
      resultBackground.hidden = false;
      const firstTry = document.createElement('span');
      firstTry.textContent = `初回正解　${detail.firstTryCorrect}/${detail.total}問`;
      const review = document.createElement('span');
      review.textContent = `復習　${detail.reviewCount}問`;
      resultText.replaceChildren(firstTry, review);
      resultCard.classList.remove('is-compact');
      resultCard.hidden = false;
      status.textContent = 'CLEAR';
      stage.classList.remove('is-open', 'is-moving');
      stage.classList.add('is-at-door', 'is-result');
    },
    revealResult() {
      resultCard.classList.add('is-compact');
      stage.classList.add('is-open');
    },
  };

  function createRuntime(nextProject) {
    eventController?.cancel();
    currentProject = structuredClone(nextProject);
    let nextController = null;
    engine = createEngine({
      questions: currentProject.questions,
      convertRomaji,
      onEvent: (event) => nextController?.handle(event),
    });
    nextController = createEventController({ audioManager, manifest, engine, actions, scheduler });
    eventController = nextController;
    started = false;
    actions.reset();
  }

  function start() {
    if (started) return false;
    started = true;
    startButton.hidden = true;
    engine.start();
    return true;
  }

  function restart(nextProject = currentProject) {
    createRuntime(nextProject);
    startButton.hidden = true;
    return start();
  }

  function onInput(event) {
    if (composing || event?.isComposing) {
      composing = true;
      showInputWarning();
      return;
    }
    normalizeInputWidth();
    if (hasJapaneseInput()) {
      showInputWarning();
      return;
    }
    quiz.classList.remove('is-input-warning');
    feedback.textContent = answerFeedback;
    kanaPreview.textContent = convertRomaji(input.value, false);
  }

  function onCompositionStart() {
    composing = true;
    showInputWarning();
  }

  function onCompositionEnd() {
    composing = false;
    guardCompositionSubmit();
    onInput();
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter') return;
    if (composing || event.isComposing || event.keyCode === 229) {
      // Do not cancel this key: the IME still needs it to confirm composition.
      guardCompositionSubmit();
    } else if (suppressCompositionSubmit) {
      event.preventDefault();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (quiz.hidden || composing || suppressCompositionSubmit) return;
    normalizeInputWidth();
    if (hasJapaneseInput()) {
      showInputWarning();
      return;
    }
    quiz.classList.remove('is-input-warning');
    engine.submitRomaji(input.value);
  }

  function onQuizAnimationEnd(event) {
    if (event.target === quiz && event.animationName === 'shake') {
      quiz.classList.remove('is-shaking');
    }
  }

  function onReplay() {
    started = true;
    engine.replay();
  }

  startButton.addEventListener('click', start);
  replayButton.addEventListener('click', onReplay);
  input.addEventListener('input', onInput);
  input.addEventListener('compositionstart', onCompositionStart);
  input.addEventListener('compositionend', onCompositionEnd);
  input.addEventListener('keydown', onKeyDown);
  quiz.addEventListener('submit', onSubmit);
  quiz.addEventListener('animationend', onQuizAnimationEnd);

  createRuntime(currentProject);

  return {
    start,
    restart,
    setVolume(value) {
      audioManager.setVolume(value);
    },
    setMuted(value) {
      audioManager.setMuted(value);
    },
    destroy() {
      resetInputAssistance();
      eventController?.cancel();
      startButton.removeEventListener('click', start);
      replayButton.removeEventListener('click', onReplay);
      input.removeEventListener('input', onInput);
      input.removeEventListener('compositionstart', onCompositionStart);
      input.removeEventListener('compositionend', onCompositionEnd);
      input.removeEventListener('keydown', onKeyDown);
      quiz.removeEventListener('submit', onSubmit);
      quiz.removeEventListener('animationend', onQuizAnimationEnd);
      shadow.innerHTML = '';
    },
  };
}
