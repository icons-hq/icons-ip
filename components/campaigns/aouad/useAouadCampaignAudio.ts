'use client';

import { useCallback, useRef } from 'react';

const AOUAD_AUDIO = {
  radioStatic: '/generated/aouad-campaign/generated/sol/radio-static-bed.wav',
  rooftopWind: '/generated/aouad-campaign/generated/sol/rooftop-wind-bed.wav',
  radioResponse: '/generated/aouad-campaign/generated/sol/radio-response-confirm.wav',
  survivorStamp: '/generated/aouad-campaign/generated/sol/survivor-record-stamp.wav',
  zoneUnlock: '/generated/aouad-campaign/generated/sol/campaign-zone-unlock.wav',
} as const;

export type AouadCampaignAudioCue = keyof typeof AOUAD_AUDIO;

/** Audio is only ever started from an explicit local interaction; failures are non-blocking. */
export function useAouadCampaignAudio() {
  const players = useRef<Partial<Record<AouadCampaignAudioCue, HTMLAudioElement>>>({});

  return useCallback((cue: AouadCampaignAudioCue, volume = 0.35) => {
    const player = players.current[cue] ?? new Audio(AOUAD_AUDIO[cue]);
    players.current[cue] = player;
    player.volume = volume;
    player.currentTime = 0;
    void player.play().catch(() => {});
  }, []);
}
