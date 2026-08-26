/**
 * Environment lookdev is intentionally data-only. Gameplay owns its stable
 * anchors and DoorSystem capability; a future official mesh swaps this profile
 * at a named seam instead of teaching movement or narrative code about art.
 */
export const LAST_BELL_ENVIRONMENT_ID = 'hyosan-post-strike-night' as const;

export type LastBellEnvironmentId = typeof LAST_BELL_ENVIRONMENT_ID;

export const HYOSAN_POST_STRIKE_NIGHT = {
  id: LAST_BELL_ENVIRONMENT_ID,
  replacementSeams: {
    entry: 'environment.hyosan.entry',
    classroom: 'environment.hyosan.classroom.destroyed',
    corridor: 'environment.hyosan.corridor.destroyed',
    rooftop: 'environment.hyosan.rooftop.destroyed',
    debrisKit: 'kit.debris.post-strike-school',
  },
  visualIds: {
    frameZero: 'visual.hyosan.post-strike-night.frame-zero',
    coldOpen: 'visual.hyosan.destroyed-classroom.low-off-axis',
    firstBay: 'visual.hyosan.corridor.cyan-window-axis',
  },
  collisionIds: {
    startRoom: 'collision.hyosan.classroom.start-room',
    firstDoor: 'collision.hyosan.classroom.first-door',
    firstBay: 'collision.hyosan.corridor.first-bay',
  },
  anchorIds: [
    'classroom_spawn',
    'classroom_door',
    'desk_hide',
    'corridor_listen',
  ],
  materialIds: [
    'material.charred-concrete',
    'material.exposed-brick',
    'material.smoked-aluminium',
    'material.shattered-glass',
  ],
  lighting: {
    background: '#05090c',
    fog: '#071216',
    // This is display-sRGB calibrated with the first-review captures; local
    // cyan pools and the torch, rather than a raised global exposure, create
    // readable structure.
    exposure: .78,
    cyanWindowLight: '#176d78',
    negativeFill: '#020405',
    playerFlashlight: 'light.player.flashlight.narrow',
  },
  vfxIds: {
    ash: 'vfx.ash.sparse-points',
    lightShafts: 'vfx.light-shaft.planes',
    rooftopFire: 'vfx.rooftop.fire.local-warm',
    rooftopSmoke: 'vfx.rooftop.smoke.local',
  },
  quality: {
    targetFps: 30,
    repeatedProps: 'instanced-or-shared-no-shadow',
    heroShadows: 'flashlight-and-first-door-only',
    volumetrics: 'forbidden-use-shaft-planes',
  },
  characters: {
    'character.namra.rooftop': {
      scene: 'environment.hyosan.rooftop.destroyed',
      replacementId: 'character.namra.rooftop',
    },
  },
  // Kept separate from the character asset so IP-approved dialogue, animation,
  // and blocking can be replaced without mutating the environment profile.
  narrativeCueSeams: {
    rooftopEnding: 'cue.rooftop.reunion',
  },
  animationSeams: {
    namraRooftop: 'animation.namra.rooftop',
  },
} as const;

export const LAST_BELL_RETIRED_PROFILE_FALLBACKS = [
  'env-opening-classroom-calm',
  'env-corridor-stealth',
  'env-outbreak-classroom-door',
  'env-emergency-power-panel',
  'env-last-bell-corridor',
] as const;
