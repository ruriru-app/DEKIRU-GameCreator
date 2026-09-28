const canonicalPairs = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  てぃ: 'thi', でぃ: 'dhi', うぃ: 'wi', うぇ: 'we', うぉ: 'who',
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゔ: 'vu',
};

const inputPairs = {};
for (const [kana, romaji] of Object.entries(canonicalPairs)) {
  if (!(romaji in inputPairs)) inputPairs[romaji] = kana;
}
Object.assign(inputPairs, {
  si: 'し', ti: 'ち', tu: 'つ', hu: 'ふ', zi: 'じ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  dji: 'ぢ', di: 'ぢ', dzu: 'づ', du: 'づ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ', xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  ltu: 'っ', xtu: 'っ', ltsu: 'っ', xtsu: 'っ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  nn: 'ん',
});

const inputTokens = Object.keys(inputPairs).sort((left, right) => right.length - left.length);

export function normalizeReading(value) {
  return String(value ?? '')
    .trim()
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

export function romajiToHiragana(value, finalMode = true) {
  const input = String(value ?? '').toLocaleLowerCase();
  let output = '';
  let index = 0;

  while (index < input.length) {
    const current = input[index];
    const next = input[index + 1] ?? '';

    if (/[^a-z'-]/.test(current)) {
      output += current;
      index += 1;
      continue;
    }

    if (current === 'n') {
      if (next === "'") {
        output += 'ん';
        index += 2;
        continue;
      }
      if (!next) {
        output += finalMode ? 'ん' : 'n';
        index += 1;
        continue;
      }
      if (next === 'n') {
        output += 'ん';
        index += 2;
        continue;
      }
      if (!/[aiueoy]/.test(next)) {
        output += 'ん';
        index += 1;
        continue;
      }
    }

    if (current === next && /[bcdfghjklmpqrstvwxyz]/.test(current) && current !== 'n') {
      output += 'っ';
      index += 1;
      continue;
    }

    const token = inputTokens.find((candidate) => input.startsWith(candidate, index));
    if (token) {
      output += inputPairs[token];
      index += token.length;
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}

function romajiForKanaAt(reading, index) {
  const pair = reading.slice(index, index + 2);
  if (canonicalPairs[pair]) return { value: canonicalPairs[pair], length: 2 };
  const single = reading[index];
  return { value: canonicalPairs[single] ?? single, length: 1 };
}

export function readingToRomaji(value) {
  const reading = normalizeReading(value);
  let output = '';

  for (let index = 0; index < reading.length;) {
    const character = reading[index];

    if (character === 'っ') {
      const next = romajiForKanaAt(reading, index + 1).value;
      output += next === 'chi' ? 't' : /^[a-z]/.test(next) ? next[0] : '';
      index += 1;
      continue;
    }

    if (character === 'ん') {
      const next = romajiForKanaAt(reading, index + 1).value;
      output += /^[aiueoyn]/.test(next) ? "n'" : 'n';
      index += 1;
      continue;
    }

    if (character === 'ー') {
      output += '-';
      index += 1;
      continue;
    }

    const converted = romajiForKanaAt(reading, index);
    output += converted.value;
    index += converted.length;
  }

  return output;
}
