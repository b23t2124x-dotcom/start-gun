'use strict';

const APP_VERSION = '1.1.1';

/* ---------- 設定 ---------- */

const DEFAULTS = {
  prep: 5, marks: 8, setBase: 2.0, setRand: 0.5, lang: 'en', volume: 1.0,
  voiceEn: '', voiceJa: '', // '' = 自動（男性の声を優先）。値は voiceURI
  pitch: 0.9,
};
const LIMITS = {
  prep:    { min: 0,   max: 60, step: 1,   dec: 0 },
  marks:   { min: 1,   max: 60, step: 0.5, dec: 1 },
  setBase: { min: 0.5, max: 10, step: 0.1, dec: 1 },
  setRand: { min: 0,   max: 5,  step: 0.1, dec: 1 },
};
const MIN_SET_DELAY = 0.3; // Set → 号砲 の最短秒数
const STORE_KEY = 'gouhou-settings-v1';

// スターター風に「On your marks」はゆっくり、「Set」は短く
const WORDS = {
  en: { marks: 'On your marks', set: 'Set', marksLabel: 'On your marks', setLabel: 'Set', marksRate: 0.8, setRate: 0.9 },
  ja: { marks: '位置について', set: '用意', marksLabel: '位置について', setLabel: '用意', marksRate: 0.9, setRate: 0.95 },
};

let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても動作は継続 */ }
}

/* ---------- DOM ---------- */

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const phaseEl = $('#phase');
const subEl = $('#sub');
const startBtn = $('#startBtn');
const flashEl = $('#flash');
const rangeNote = $('#rangeNote');
const volumeEl = $('#volume');
const testGunBtn = $('#testGun');
const testVoiceBtn = $('#testVoice');
const voiceSel = $('#voiceSel');
const voiceNote = $('#voiceNote');
const pitchEl = $('#pitch');
$('#ver').textContent = APP_VERSION;

function show(state, phase, sub = '') {
  stage.dataset.state = state;
  phaseEl.textContent = phase;
  subEl.textContent = sub;
}

/* ---------- 音声（Web Audio API で号砲を合成） ---------- */

let audioCtx = null;
let masterGain = null;
let gunBuffer = null;

function ensureAudio() {
  // iOS 17+ : マナーモードでも Web Audio を鳴らす
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* 非対応 */ }

  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    gunBuffer = makeGunBuffer(audioCtx);
  }
  masterGain.gain.value = settings.volume;
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});

  // iOS のオーディオ解錠用に無音を1サンプル鳴らす（ユーザー操作中に呼ぶこと）
  const b = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
  const s = audioCtx.createBufferSource();
  s.buffer = b;
  s.connect(audioCtx.destination);
  s.start(0);
}

/** 号砲音をノイズから合成してバッファにする */
function makeGunBuffer(ctx) {
  const sr = ctx.sampleRate;
  const dur = 1.8;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const raw = new Float32Array(n);

  for (let ch = 0; ch < 2; ch++) {
    let lpHi = 0, lpMid = 0, lpLow = 0, phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lpHi  += 0.5  * (w - lpHi);   // 〜数kHz
      lpMid += 0.12 * (w - lpMid);  // 〜1kHz
      lpLow += 0.04 * (w - lpLow);  // 〜300Hz

      const attack = Math.min(1, t / 0.0006);
      const crack = w * Math.exp(-t / 0.010);                 // 鋭い破裂音
      const body  = lpHi * 1.2 * Math.exp(-t / 0.045);        // 胴鳴り
      const boom  = lpLow * 6.0 * Math.exp(-t / 0.12);        // 低域の響き
      const tail  = lpMid * 1.4 * Math.exp(-t / 0.5) * Math.min(1, t / 0.02); // 残響
      const f = 55 + 90 * Math.exp(-t / 0.03);                // 下降する低音の衝撃
      phase += (2 * Math.PI * f) / sr;
      const thump = Math.sin(phase) * 0.8 * Math.exp(-t / 0.07);

      raw[i] = attack * (crack + body + boom + tail + thump);
    }

    // 屋外の反射音（エコー）を少し足す
    const d = buf.getChannelData(ch);
    const e1 = Math.floor(sr * (ch ? 0.071 : 0.063));
    const e2 = Math.floor(sr * (ch ? 0.149 : 0.137));
    for (let i = 0; i < n; i++) {
      let v = raw[i];
      if (i >= e1) v += 0.28 * raw[i - e1];
      if (i >= e2) v += 0.14 * raw[i - e2];
      d[i] = Math.tanh(v * 2.2); // ソフトクリップで音圧を上げる
    }
    // 末尾のフェードアウト
    const fade = Math.floor(sr * 0.2);
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  }

  // ピーク正規化
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const g = 0.98 / peak;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] *= g;
    }
  }
  return buf;
}

/*
 * 号砲の再生
 * iPhone では掛け声（音声読み上げ）が流れると Web Audio が一時停止され、
 * 画面操作なしでは再開できないことがある。そこで合成した号砲を WAV にして
 * <audio> 要素で鳴らす。<audio> はスタートを押した時点で再生許可を取っておく。
 * <audio> で鳴らせなかったときだけ Web Audio で鳴らす。
 */
let gunEl = null;
let gunUrl = null;
let gunUrlVol = null;
let unlockToken = 0;

/** AudioBuffer を 16bit PCM の WAV にする（iOS は audio.volume が効かないので音量を焼き込む） */
function encodeWav(buffer, gain) {
  const chs = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const size = 44 + n * chs * 2;
  const dv = new DataView(new ArrayBuffer(size));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, size - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, chs, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * chs * 2, true); dv.setUint16(32, chs * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * chs * 2, true);
  const data = [];
  for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chs; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i] * gain));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([dv], { type: 'audio/wav' });
}

function prepareGunElement() {
  if (!gunBuffer) return;
  if (!gunEl) {
    gunEl = new Audio();
    gunEl.preload = 'auto';
    gunEl.setAttribute('playsinline', '');
  }
  if (gunUrlVol !== settings.volume) {
    if (gunUrl) URL.revokeObjectURL(gunUrl);
    gunUrl = URL.createObjectURL(encodeWav(gunBuffer, settings.volume));
    gunUrlVol = settings.volume;
    gunEl.src = gunUrl;
    gunEl.load();
  }
}

/** ユーザー操作の中で呼ぶ：無音で一度再生して、あとからタイマーで鳴らせるようにする */
function unlockGunElement() {
  prepareGunElement();
  if (!gunEl) return;
  const token = ++unlockToken;
  gunEl.muted = true;
  const p = gunEl.play();
  const done = () => {
    if (token !== unlockToken) return; // その間に本番の号砲が鳴っていたら触らない
    gunEl.pause();
    gunEl.currentTime = 0;
    gunEl.muted = false;
  };
  if (p && p.then) p.then(done, () => { if (token === unlockToken) gunEl.muted = false; });
  else done();
}

function playGunWebAudio() {
  if (!audioCtx || !gunBuffer) return false;
  const start = () => {
    masterGain.gain.value = settings.volume;
    const src = audioCtx.createBufferSource();
    src.buffer = gunBuffer;
    src.connect(masterGain);
    src.start(0);
  };
  if (audioCtx.state === 'running') { start(); return true; }
  return audioCtx.resume().then(() => {
    if (audioCtx.state !== 'running') return false;
    start();
    return true;
  }, () => false);
}

/** 号砲を鳴らす。鳴らせたら true */
async function fireGun() {
  flashEl.classList.remove('on');
  void flashEl.offsetWidth; // アニメーションを再始動
  flashEl.classList.add('on');

  unlockToken++; // 解錠処理による pause を無効化
  prepareGunElement();
  if (gunEl) {
    try {
      gunEl.muted = false;
      gunEl.currentTime = 0;
      await gunEl.play();
      return true;
    } catch (e) {
      console.warn('audio要素で再生できませんでした', e);
    }
  }
  return await playGunWebAudio();
}

/* ---------- 掛け声（Web Speech API） ---------- */

const synth = window.speechSynthesis || null;
let voices = [];
let speechUnlocked = false;
let currentUtterance = null; // iOS で GC されて onend が来ない問題の対策として参照を保持

// 男性の声として知られている音声名（優先順）。iPhone / Mac / Windows / Android を含む
const MALE_VOICES = {
  en: ['Daniel', 'Arthur', 'Aaron', 'Fred', 'Gordon', 'Oliver', 'Alex', 'Tom', 'Rishi', 'Lee',
       'Google UK English Male', 'Microsoft Ryan', 'Microsoft Guy', 'Microsoft David', 'Microsoft Mark', 'Microsoft George',
       'Eddy', 'Reed', 'Rocko', 'Ralph', 'Albert', 'Bruce', 'Junior'],
  ja: ['Otoya', 'Hattori', 'Microsoft Keita', 'Microsoft Ichiro', 'Eddy', 'Reed', 'Rocko'],
};

const normLang = (l) => (l || '').replace('_', '-').toLowerCase();
const voiceKey = (lang) => (lang === 'ja' ? 'voiceJa' : 'voiceEn');

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  renderVoiceOptions();
}
if (synth) {
  if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
  else if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
}

function voicesFor(lang) {
  return voices.filter((v) => normLang(v.lang).startsWith(lang));
}

/** 男性の声リストでの順位（見つからなければ -1） */
function maleRank(v, lang) {
  const name = v.name.toLowerCase();
  return MALE_VOICES[lang].findIndex((m) => name === m.toLowerCase() || name.startsWith(m.toLowerCase() + ' '));
}

/** 自動選択：男性の声 → その言語の既定の声 → その言語の最初の声 */
function autoVoice(lang) {
  const list = voicesFor(lang);
  let best = null, bestRank = Infinity;
  for (const v of list) {
    const r = maleRank(v, lang);
    if (r >= 0 && r < bestRank) { best = v; bestRank = r; }
  }
  if (best) return best;
  const prefs = lang === 'ja' ? ['ja-jp'] : ['en-gb', 'en-us'];
  for (const p of prefs) {
    const v = list.find((x) => normLang(x.lang).startsWith(p));
    if (v) return v;
  }
  return list[0] || null;
}

function pickVoice(lang) {
  const uri = settings[voiceKey(lang)];
  if (uri) {
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) return v;
  }
  return autoVoice(lang);
}

function unlockSpeech() {
  // iOS Safari はユーザー操作中に一度 speak しないと、タイマーからの発話が無視される
  if (!synth || speechUnlocked) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
  speechUnlocked = true;
}

/* ---------- 中断可能な待機 ---------- */

class Cancelled extends Error {}
const cancelHooks = new Set();

function cancelAll() {
  for (const c of [...cancelHooks]) c();
  cancelHooks.clear();
  if (synth) synth.cancel();
}

/** ms ミリ秒待つ。onTick(残りms) を定期的に呼ぶ */
function wait(ms, onTick) {
  return new Promise((resolve, reject) => {
    const end = performance.now() + ms;
    let iv = null;
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    if (onTick) {
      onTick(ms);
      iv = setInterval(() => onTick(Math.max(0, end - performance.now())), 100);
    }
    const cancel = () => { cleanup(); reject(new Cancelled()); };
    function cleanup() {
      clearTimeout(t);
      if (iv) clearInterval(iv);
      cancelHooks.delete(cancel);
    }
    cancelHooks.add(cancel);
  });
}

/** 発話して、話し終わったら resolve */
function speak(text, lang, rate) {
  return new Promise((resolve, reject) => {
    if (!synth) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.lang = v ? v.lang : (lang === 'ja' ? 'ja-JP' : 'en-US');
    u.rate = rate || (lang === 'ja' ? 0.95 : 0.85);
    u.pitch = settings.pitch;
    u.volume = 1;
    currentUtterance = u;

    let done = false;
    // onend が来ない環境向けの保険
    const fallback = setTimeout(finish, 5000);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      cancelHooks.delete(cancel);
      resolve();
    }
    const cancel = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      cancelHooks.delete(cancel);
      reject(new Cancelled());
    };
    cancelHooks.add(cancel);
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

/* ---------- 画面スリープ防止 ---------- */

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 非対応・拒否 */ }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* noop */ }
  wakeLock = null;
}

/* ---------- スタートシーケンス ---------- */

let running = false;
let runId = 0;

function randomSetDelay() {
  const lo = Math.max(MIN_SET_DELAY, settings.setBase - settings.setRand);
  const hi = Math.max(lo, settings.setBase + settings.setRand);
  return lo + Math.random() * (hi - lo);
}

const fmt = (ms) => (ms / 1000).toFixed(1);

async function runSequence() {
  const id = ++runId;
  setRunning(true);
  const words = WORDS[settings.lang] || WORDS.en;

  try {
    if (settings.prep > 0) {
      await wait(settings.prep * 1000, (r) => show('prep', Math.ceil(r / 1000).toString(), '位置についてください'));
    }

    show('marks', words.marksLabel, '');
    await speak(words.marks, settings.lang, words.marksRate);

    await wait(settings.marks * 1000, (r) => show('marks', words.marksLabel, `${words.setLabel} まで ${fmt(r)} 秒`));

    show('set', words.setLabel, '');
    await speak(words.set, settings.lang, words.setRate);

    const delay = randomSetDelay();
    await wait(delay * 1000);

    show('bang', 'GO!', `${words.setLabel} → 号砲  ${delay.toFixed(2)} 秒`);
    const ok = await fireGun();
    if (!ok && id === runId) show('bang', 'GO!', '号砲を再生できませんでした（音量・マナーモードを確認）');
  } catch (e) {
    if (!(e instanceof Cancelled)) {
      console.error(e);
      show('idle', 'エラー', String(e && e.message || e));
    }
  } finally {
    if (id === runId) setRunning(false);
  }
}

function stopSequence() {
  runId++;
  cancelAll();
  setRunning(false);
  show('idle', 'READY', '中止しました');
}

function setRunning(on) {
  running = on;
  startBtn.textContent = on ? '中止' : 'スタート';
  startBtn.classList.toggle('running', on);
  testGunBtn.disabled = on;
  testVoiceBtn.disabled = on;
  document.querySelectorAll('.stepper button, .seg button, #voiceSel, #pitch').forEach((b) => { b.disabled = on; });
  if (on) requestWakeLock(); else releaseWakeLock();
}

startBtn.addEventListener('click', () => {
  if (running) { stopSequence(); return; }
  // ユーザー操作の中でオーディオと音声を解錠しておく
  ensureAudio();
  unlockGunElement();
  unlockSpeech();
  runSequence();
});

testGunBtn.addEventListener('click', () => {
  ensureAudio();
  fireGun();
});

testVoiceBtn.addEventListener('click', async () => {
  if (running) return;
  unlockSpeech();
  const words = WORDS[settings.lang] || WORDS.en;
  testVoiceBtn.disabled = true;
  try {
    await speak(words.marks, settings.lang, words.marksRate);
    await wait(500);
    await speak(words.set, settings.lang, words.setRate);
  } catch { /* 中止 */ }
  testVoiceBtn.disabled = running;
});

// アプリが裏に回ったらシーケンスを止める（iOS はタイマーが止まるため）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stopSequence();
});

/* ---------- 設定 UI ---------- */

function clamp(key, v) {
  const L = LIMITS[key];
  const r = Math.round(v / L.step) * L.step;
  return Math.min(L.max, Math.max(L.min, Number(r.toFixed(L.dec + 1))));
}

function renderSettings() {
  document.querySelectorAll('.stepper').forEach((el) => {
    const key = el.dataset.key;
    const L = LIMITS[key];
    el.querySelector('output').textContent = `${settings[key].toFixed(L.dec)}秒`;
  });
  const lo = Math.max(MIN_SET_DELAY, settings.setBase - settings.setRand);
  const hi = Math.max(lo, settings.setBase + settings.setRand);
  rangeNote.textContent = settings.setRand > 0
    ? `号砲は ${lo.toFixed(1)}〜${hi.toFixed(1)} 秒後のどこか`
    : `号砲は ${lo.toFixed(1)} 秒後に固定`;
  document.querySelectorAll('.seg button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.lang === settings.lang));
  });
  volumeEl.value = String(settings.volume);
  pitchEl.value = String(settings.pitch);
  renderVoiceOptions();
}

/** 声の選択肢を、選択中の言語の音声で作り直す */
function renderVoiceOptions() {
  const lang = settings.lang;
  const list = voicesFor(lang).slice().sort((a, b) => {
    const ra = maleRank(a, lang), rb = maleRank(b, lang);
    if ((ra >= 0) !== (rb >= 0)) return ra >= 0 ? -1 : 1; // 男性の声を先頭に
    if (ra >= 0 && ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  const auto = autoVoice(lang);

  voiceSel.innerHTML = '';
  const optAuto = document.createElement('option');
  optAuto.value = '';
  optAuto.textContent = auto ? `自動（${auto.name}）` : '自動';
  voiceSel.appendChild(optAuto);
  for (const v of list) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name}${maleRank(v, lang) >= 0 ? '・男性' : ''}（${v.lang}）`;
    voiceSel.appendChild(o);
  }
  const saved = settings[voiceKey(lang)];
  voiceSel.value = list.some((v) => v.voiceURI === saved) ? saved : '';

  if (!synth) {
    voiceNote.textContent = 'この端末は音声読み上げに非対応です';
  } else if (!list.length) {
    voiceNote.textContent = 'この言語の声が見つかりません';
  } else if (!list.some((v) => maleRank(v, lang) >= 0)) {
    voiceNote.textContent = lang === 'ja'
      ? '男性の声なし。設定で「Otoya」を追加できます'
      : '男性の声なし。設定で「Daniel」等を追加できます';
  } else {
    voiceNote.textContent = '「・男性」が男性の声です';
  }
}

function bump(key, dir) {
  settings[key] = clamp(key, settings[key] + dir * LIMITS[key].step);
  saveSettings();
  renderSettings();
}

// 長押しで連続変更
document.querySelectorAll('.stepper').forEach((el) => {
  const key = el.dataset.key;
  el.querySelectorAll('button').forEach((btn) => {
    const dir = Number(btn.dataset.d);
    let holdT = null, repT = null;
    const stop = () => { clearTimeout(holdT); clearInterval(repT); holdT = repT = null; };
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      bump(key, dir);
      holdT = setTimeout(() => { repT = setInterval(() => bump(key, dir), 90); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
});

document.querySelectorAll('.seg button').forEach((b) => {
  b.addEventListener('click', () => {
    settings.lang = b.dataset.lang;
    saveSettings();
    renderSettings();
  });
});

volumeEl.addEventListener('input', () => {
  settings.volume = Number(volumeEl.value);
  if (masterGain) masterGain.gain.value = settings.volume;
  saveSettings();
});

voiceSel.addEventListener('change', () => {
  settings[voiceKey(settings.lang)] = voiceSel.value;
  saveSettings();
});

pitchEl.addEventListener('input', () => {
  settings.pitch = Number(pitchEl.value);
  saveSettings();
});

// 保存値が範囲外でも安全に
for (const key of Object.keys(LIMITS)) {
  const v = Number(settings[key]);
  settings[key] = clamp(key, Number.isFinite(v) ? v : DEFAULTS[key]);
}
if (!(settings.volume >= 0.1 && settings.volume <= 1)) settings.volume = DEFAULTS.volume;
if (!WORDS[settings.lang]) settings.lang = DEFAULTS.lang;
if (!(settings.pitch >= 0.5 && settings.pitch <= 1.5)) settings.pitch = DEFAULTS.pitch;
if (typeof settings.voiceEn !== 'string') settings.voiceEn = '';
if (typeof settings.voiceJa !== 'string') settings.voiceJa = '';
if (synth) voices = synth.getVoices();
renderSettings();

/* ---------- Service Worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW登録失敗', e));
  });
}
