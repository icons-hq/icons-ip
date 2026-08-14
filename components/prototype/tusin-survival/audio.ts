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

  close() {
    void this.context?.close();
    this.context = null;
    this.musicGain = null;
    this.sfxGain = null;
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
