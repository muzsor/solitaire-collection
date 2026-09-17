// 簡單音效（WebAudio 合成，不需要音檔）

let ctx = null;
let enabled = true;

export function setSoundEnabled(v) {
  enabled = v;
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// iOS 需要在使用者手勢中建立 AudioContext
export function primeAudio() {
  if (enabled) ac();
}

function blip(freq, dur, type = 'sine', gain = 0.08, when = 0) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + when);
  o.stop(c.currentTime + when + dur + 0.02);
}

export function playPlace() {
  if (!enabled) return;
  blip(520, 0.06, 'triangle', 0.06);
}
export function playDeal() {
  if (!enabled) return;
  blip(300, 0.05, 'square', 0.03);
}
export function playError() {
  if (!enabled) return;
  blip(160, 0.12, 'sawtooth', 0.04);
}
export function playWin() {
  if (!enabled) return;
  [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.25, 'triangle', 0.08, i * 0.12));
}
