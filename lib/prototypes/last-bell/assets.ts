import { LAST_BELL_3D_ASSET_PATHS } from './environment3d';

export const LAST_BELL_ASSETS = {
  logo: '/generated/last-bell/official/aouad-title-logo.png',
  barricadeStill: '/generated/last-bell/official/classroom-barricade.webp',
  outbreakStill: '/generated/last-bell/official/classroom-outbreak.webp',
  corridorStill: '/generated/last-bell/official/corridor-run.webp',
  audio: {
    classroomAmbience: '/generated/last-bell/audio/classroom-fluorescent-ambience.ogg',
    classroomDrone: '/generated/last-bell/audio/last-classroom-drone.ogg',
    doorPounding: '/generated/last-bell/audio/outbreak-door-pounding.wav',
    bell: '/generated/last-bell/audio/school-bell-malfunction.wav',
    groan: '/generated/last-bell/audio/distant-infected-groan.ogg',
    breaker: '/generated/last-bell/audio/breaker-switch-electric.wav',
    footsteps: '/generated/last-bell/audio/corridor-footsteps.wav',
    breathHeartbeat: '/generated/last-bell/audio/breath-heartbeat-loop.ogg',
  },
  environment3d: LAST_BELL_3D_ASSET_PATHS,
} as const;

export type LastBellAudioId = keyof typeof LAST_BELL_ASSETS.audio;
