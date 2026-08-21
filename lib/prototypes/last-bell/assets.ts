export const LAST_BELL_ASSETS = {
  openingPlate: '/generated/last-bell/environments/opening-classroom-calm.webp',
  outbreakPlate: '/generated/last-bell/environments/outbreak-classroom-door.webp',
  corridorPlate: '/generated/last-bell/environments/corridor-stealth.webp',
  powerPlate: '/generated/last-bell/environments/emergency-power-panel.webp',
  bellPlate: '/generated/last-bell/environments/last-bell-corridor.webp',
  logo: '/generated/last-bell/official/aouad-title-logo.png',
  materials: {
    agedIvoryPlaster: '/generated/last-bell/materials/aged-ivory-plaster.webp',
    institutionalSagePaint: '/generated/last-bell/materials/institutional-sage-paint.webp',
    darkGrayLinoleum: '/generated/last-bell/materials/dark-gray-linoleum.webp',
    wiredFrostedGlass: '/generated/last-bell/materials/wired-frosted-glass.webp',
    beigeLockerMetal: '/generated/last-bell/materials/beige-locker-metal.webp',
    wornDeskWood: '/generated/last-bell/materials/worn-desk-wood.webp',
    atlas: '/generated/last-bell/materials/school-material-atlas.webp',
  },
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
} as const;

export type LastBellAudioId = keyof typeof LAST_BELL_ASSETS.audio;
