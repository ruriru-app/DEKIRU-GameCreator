const asset = (relativePath) => new URL(relativePath, import.meta.url).href;

export const fusumaManifest = Object.freeze({
  id: 'fusuma',
  name: '和室・襖',
  gameType: 'typing',
  aspectRatio: '16 / 9',
  timings: Object.freeze({
    travelMs: 3200,
    answerHoldMs: 600,
    doorOpenMs: 1300,
    doorSettleMs: 150,
    resultArrivalMs: 330,
    resultRevealMs: 650,
    resultTransitionMs: 1250,
  }),
  runtime: Object.freeze({
    modules: Object.freeze({
      audioManager: asset('../../../core/audio-manager.js'),
      romajiConverter: asset('../../core/romaji-converter.js'),
      typingEngine: asset('../../core/typing-engine.js'),
      eventController: asset('./event-controller.js'),
      renderer: asset('./renderer.js'),
    }),
    style: asset('./style.css'),
  }),
  assets: Object.freeze({
    style: asset('./style.css'),
    images: Object.freeze({
      storm: asset('./assets/images/storm.png'),
      rain: asset('./assets/images/rain.png'),
      cloudy: asset('./assets/images/cloudy.png'),
      sunny: asset('./assets/images/sunny.png'),
      clear: asset('./assets/images/clear.png'),
      room: asset('./assets/images/room.png'),
      fusumaLeft: asset('./assets/images/fusuma-left.png'),
      fusumaRight: asset('./assets/images/fusuma-right.png'),
    }),
    audio: Object.freeze({
      correct: asset('./assets/audio/correct.mp3'),
      travel: asset('./assets/audio/travel-tatami.mp3'),
      doorOpen: null,
      wrong: null,
      results: Object.freeze({
        storm: asset('./assets/audio/result-storm.mp3'),
        rain: asset('./assets/audio/result-rain.mp3'),
        cloudy: asset('./assets/audio/result-cloudy.mp3'),
        sunny: asset('./assets/audio/result-sunny.mp3'),
        clear: asset('./assets/audio/result-clear.mp3'),
      }),
    }),
  }),
});
