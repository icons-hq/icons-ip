import type { AudioCue } from './presentation';
import { baseWeaponPresentationId } from './weapon-presentation';

export type GameSound = 'start' | 'slash' | 'hit' | 'level' | 'chest' | 'boss' | 'clear' | 'loss';

interface AudioSettings {
  music: number;
  sfx: number;
}

const NOTES = [55, 65.41, 73.42, 82.41, 98];

export class GameAudio {
  private context: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private nextPulseAt = 0;
  private pulseIndex = 0;
  private readonly lastCombatAt = new Map<string, number>();
  private settings: AudioSettings = { music: 0.3, sfx: 0.5 };

  async resume() {
    const context = this.ensureContext();
    if (context.state === 'suspended') await context.resume();
  }

  setSettings(settings: AudioSettings) {
    this.settings = settings;
    if (!this.context || !this.musicGain || !this.sfxGain) return;
    this.musicGain.gain.setTargetAtTime(settings.music, this.context.currentTime, 0.04);
    this.sfxGain.gain.setTargetAtTime(settings.sfx, this.context.currentTime, 0.04);
  }

  updateMusic(danger: number, finalBoss: boolean) {
    if (!this.context || !this.musicGain || this.settings.music <= 0) return;
    const now = this.context.currentTime;
    if (now < this.nextPulseAt) return;

    const cadence = finalBoss ? 0.19 : Math.max(0.28, 0.52 - danger * 0.14);
    const note = NOTES[(this.pulseIndex + (finalBoss ? 2 : 0)) % NOTES.length];
    this.tone(note, cadence * 0.8, 0.075, 'triangle', this.musicGain, finalBoss ? -300 : -800);
    if (this.pulseIndex % 4 === 0) {
      this.tone(note * 2, cadence * 0.45, 0.025, 'square', this.musicGain, -500);
    }
    this.nextPulseAt = now + cadence;
    this.pulseIndex += 1;
  }

  play(sound: GameSound) {
    if (!this.context || !this.sfxGain || this.settings.sfx <= 0) return;
    const presets: Record<GameSound, [number, number, number, OscillatorType, number]> = {
      start: [110, 0.28, 0.12, 'sawtooth', 650],
      slash: [210, 0.08, 0.035, 'square', 780],
      hit: [72, 0.05, 0.022, 'square', -180],
      level: [330, 0.34, 0.1, 'triangle', 900],
      chest: [196, 0.5, 0.11, 'triangle', 1_200],
      boss: [49, 0.75, 0.16, 'sawtooth', -260],
      clear: [261.63, 0.85, 0.13, 'triangle', 1_100],
      loss: [98, 0.7, 0.1, 'sawtooth', -720],
    };
    const [frequency, duration, volume, type, sweep] = presets[sound];
    this.tone(frequency, duration, volume, type, this.sfxGain, sweep);
  }

  playCombat(cues: readonly AudioCue[]) {
    if (!this.context || !this.sfxGain || this.settings.sfx <= 0) return;
    const now = this.context.currentTime;
    for (const cue of cues) {
      const throttleKey = cue.kind === 'weapon-fire'
        ? `${cue.kind}:${baseWeaponPresentationId(cue.weaponId)}`
        : cue.kind;
      const lastAt = this.lastCombatAt.get(throttleKey) ?? -Infinity;
      const minimumGap = cue.kind === 'impact' ? 0.038 : cue.kind === 'weapon-fire' ? 0.055 : 0.075;
      if (now - lastAt < minimumGap) continue;
      this.lastCombatAt.set(throttleKey, now);

      if (cue.kind === 'weapon-fire') {
        this.playWeaponFire(cue);
      } else if (cue.kind === 'player-hit') {
        this.tone(82, 0.14, 0.09, 'sawtooth', this.sfxGain, -48);
        this.noiseBurst(cue.id, 0.09, 0.055, 760);
      } else if (cue.kind === 'heavy-impact' || cue.kind === 'kill') {
        this.tone(48, 0.18, 0.11 * cue.strength, 'sine', this.sfxGain, -18);
        this.tone(154, 0.055, 0.038, 'square', this.sfxGain, -105);
        this.noiseBurst(cue.id, 0.085, 0.07 * cue.strength, 1_150);
      } else {
        this.tone(92, 0.075, 0.045 * Math.max(0.45, cue.strength), 'triangle', this.sfxGain, -42);
        this.noiseBurst(cue.id, 0.042, 0.025, 1_900);
      }
    }
  }

  close() {
    void this.context?.close();
    this.context = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.lastCombatAt.clear();
  }

  private playWeaponFire(cue: AudioCue) {
    if (!this.sfxGain) return;
    const weapon = baseWeaponPresentationId(cue.weaponId) ?? 'basic-sword-strike';
    const preset: Record<string, [number, number, OscillatorType, number, number]> = {
      'basic-sword-strike': [230, 0.075, 'sawtooth', 680, 0.032],
      'cloud-dragon-ascent': [310, 0.13, 'triangle', 820, 0.044],
      'sword-of-light': [520, 0.11, 'sine', 1_240, 0.04],
      'gram-dragon-slayer': [108, 0.17, 'sawtooth', 260, 0.065],
      'lightning-fall': [680, 0.095, 'square', -420, 0.038],
      'black-dragon-chain': [86, 0.15, 'square', 190, 0.048],
    };
    const [frequency, duration, type, sweep, volume] = preset[weapon] ?? preset['basic-sword-strike'];
    this.tone(frequency, duration, volume * Math.max(0.55, cue.strength), type, this.sfxGain, sweep);
    this.noiseBurst(cue.id, duration * 0.55, volume * 0.34, weapon === 'gram-dragon-slayer' ? 920 : 2_600);
  }

  private noiseBurst(seedText: string, duration: number, volume: number, cutoff: number) {
    if (!this.context || !this.sfxGain) return;
    const frameCount = Math.max(1, Math.round(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 2_166_136_261;
    for (let index = 0; index < seedText.length; index += 1) {
      seed ^= seedText.charCodeAt(index);
      seed = Math.imul(seed, 16_777_619);
    }
    for (let index = 0; index < frameCount; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      channel[index] = ((seed >>> 0) / 2_147_483_647.5 - 1) * (1 - index / frameCount);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    source.start(now);
  }

  private ensureContext() {
    if (this.context && this.musicGain && this.sfxGain) return this.context;
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    this.musicGain = context.createGain();
    this.sfxGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    this.musicGain.gain.value = this.settings.music;
    this.sfxGain.gain.value = this.settings.sfx;
    this.musicGain.connect(compressor);
    this.sfxGain.connect(compressor);
    compressor.connect(context.destination);
    return context;
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    destination: AudioNode,
    sweep: number,
  ) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, frequency + sweep),
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
