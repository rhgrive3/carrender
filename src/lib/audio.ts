/**
 * WebAudioによるタイマー音とホワイトノイズ生成。
 * 音源ファイルを持たず全てその場で合成するため、オフラインでも追加通信なしで動く。
 */

export type NoiseType = 'off' | 'white' | 'rain';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 2音チャイム。フェーズ終了・タイマー完了の合図 */
export function playChime(kind: 'workEnd' | 'breakEnd' | 'finish'): void {
  const ac = ensureCtx();
  if (!ac) return;
  const freqs = kind === 'workEnd' ? [880, 660] : kind === 'breakEnd' ? [660, 880] : [660, 880, 1100];
  const t0 = ac.currentTime;
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const start = t0 + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

export function vibrate(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 非対応環境では無視
  }
}

// ---------- ホワイトノイズ ----------

let noiseSource: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;
let currentNoise: NoiseType = 'off';

function buildNoiseBuffer(ac: AudioContext, type: 'white' | 'rain'): AudioBuffer {
  const seconds = 4;
  const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const data = buffer.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } else {
    // 雨音風: ブラウンノイズ(ランダムウォーク)で低域寄りのざわめきを作る
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

export function setNoise(type: NoiseType): void {
  if (type === currentNoise) return;
  stopNoise();
  if (type === 'off') return;
  const ac = ensureCtx();
  if (!ac) return;
  const source = ac.createBufferSource();
  source.buffer = buildNoiseBuffer(ac, type);
  source.loop = true;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(type === 'white' ? 0.045 : 0.13, ac.currentTime + 0.6);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = type === 'white' ? 9000 : 2400;
  source.connect(filter).connect(gain).connect(ac.destination);
  source.start();
  noiseSource = source;
  noiseGain = gain;
  currentNoise = type;
}

export function stopNoise(): void {
  if (noiseSource) {
    try {
      const ac = ensureCtx();
      if (ac && noiseGain) {
        noiseGain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.2);
        const src = noiseSource;
        setTimeout(() => {
          try {
            src.stop();
          } catch {
            // 既に停止済み
          }
        }, 250);
      } else {
        noiseSource.stop();
      }
    } catch {
      // 既に停止済み
    }
  }
  noiseSource = null;
  noiseGain = null;
  currentNoise = 'off';
}

export function getNoise(): NoiseType {
  return currentNoise;
}
