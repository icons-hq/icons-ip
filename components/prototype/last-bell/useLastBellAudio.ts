'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LastBellPhase } from '@/lib/prototypes/last-bell/state';
import { LAST_BELL_ASSETS, type LastBellAudioId } from '@/lib/prototypes/last-bell/assets';

type AudioMap = Partial<Record<LastBellAudioId, HTMLAudioElement>>;

/** Browser-safe audio manager: no audio starts before the first user gesture. */
export function useLastBellAudio() {
  const audioRef = useRef<AudioMap>({});
  const contextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<LastBellAudioId, AudioBuffer>>>({});
  const cueEdgeRef = useRef<Partial<Record<LastBellAudioId, number>>>({});
  const unlockedRef = useRef(false);
  const ambientRef = useRef<LastBellAudioId | null>(null);

  const unlock = useCallback(() => {
    if (typeof window === 'undefined') return;
    unlockedRef.current = true;
    if (!contextRef.current) {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) contextRef.current = new AudioContextCtor();
    }
    void contextRef.current?.resume().catch(() => undefined);
  }, []);

  const play = useCallback((id: LastBellAudioId, options: { volume?: number; loop?: boolean } = {}) => {
    if (typeof window === 'undefined' || !unlockedRef.current) return;
    const source = LAST_BELL_ASSETS.audio[id];
    const map = audioRef.current;
    const existing = map[id] ?? new Audio(source);
    map[id] = existing;
    existing.volume = Math.max(0, Math.min(1, options.volume ?? 0.7));
    existing.loop = options.loop ?? false;
    existing.currentTime = 0;
    void existing.play().catch(() => undefined);
  }, []);

  const playSpatial = useCallback(async (
    id: LastBellAudioId,
    pan: number,
    options: { volume?: number; cooldownMs?: number } = {},
  ) => {
    if (typeof window === 'undefined' || !unlockedRef.current || !contextRef.current) return;
    const now = performance.now();
    const cooldown = options.cooldownMs ?? 420;
    if ((cueEdgeRef.current[id] ?? -Infinity) + cooldown > now) return;
    cueEdgeRef.current[id] = now;
    const context = contextRef.current;
    try {
      let buffer = buffersRef.current[id];
      if (!buffer) {
        const response = await fetch(LAST_BELL_ASSETS.audio[id]);
        if (!response.ok) throw new Error(`Audio cue ${id} returned ${response.status}`);
        buffer = await context.decodeAudioData(await response.arrayBuffer());
        buffersRef.current[id] = buffer;
      }
      const source = context.createBufferSource();
      const panner = context.createStereoPanner();
      const gain = context.createGain();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.gain.value = Math.max(0, Math.min(1, options.volume ?? .55));
      source.buffer = buffer;
      source.connect(gain).connect(panner).connect(context.destination);
      source.start();
    } catch {
      // A blocked fetch/decode must not become an unhandled rejection. The
      // HTMLAudio path still provides the cue without spatial panning.
      play(id, { volume: options.volume ?? .55 });
    }
  }, [play]);

  const stop = useCallback((id: LastBellAudioId) => {
    const audio = audioRef.current[id];
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const setAmbient = useCallback((id: LastBellAudioId | null, volume: number) => {
    if (!id) {
      if (ambientRef.current) stop(ambientRef.current);
      ambientRef.current = null;
      return;
    }
    if (ambientRef.current !== id) {
      if (ambientRef.current) stop(ambientRef.current);
      ambientRef.current = id;
      play(id, { volume, loop: true });
      return;
    }
    const audio = audioRef.current[id];
    if (audio) audio.volume = volume;
  }, [play, stop]);

  const syncPhase = useCallback((phase: LastBellPhase, listening: boolean, hiding: boolean) => {
    if (phase === 'opening' || phase === 'complete') {
      setAmbient(null, 0);
      return;
    }
    setAmbient(phase === 'classroom' ? 'classroomAmbience' : 'classroomDrone', phase === 'classroom' ? 0.26 : 0.2);
    if (listening) {
      void playSpatial('footsteps', -.68, { volume: .62 });
      void playSpatial('groan', .52, { volume: .38 });
    }
    if (hiding) play('breathHeartbeat', { volume: 0.32, loop: true });
    else stop('breathHeartbeat');
  }, [play, playSpatial, setAmbient, stop]);

  useEffect(() => () => {
    Object.values(audioRef.current).forEach((audio) => {
      audio?.pause();
      audio?.removeAttribute('src');
    });
    void contextRef.current?.close();
  }, []);

  return useMemo(() => ({ unlock, play, playSpatial, stop, syncPhase }), [play, playSpatial, stop, syncPhase, unlock]);
}
