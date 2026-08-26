/**
 * Render-facing guardrails for the first human-review frame. They are data,
 * rather than a second gameplay system: movement, anchors, and DoorSystem
 * continue to own their contracts in `chapter-01.ts` and `engine/doors.ts`.
 *
 * These bands are measured directly from display-sRGB review captures. They
 * guide a readable near-black image, not a linear-renderer or ACES target.
 */
export const POST_STRIKE_RENDER_GUARDRAILS = {
  luminance: {
    colorSpace: 'display-srgb',
    meanUnit: '8-bit luma (0-255)',
    below16Threshold: 16,
    referenceBands: {
      entry: {
        mean: { min: 6.5, reference: 8.2, max: 10 },
        below16Percent: { min: 82, reference: 85.1, max: 88 },
      },
      classroom: {
        mean: { min: 9, reference: 10.99, max: 13 },
        below16Percent: { min: 75, reference: 78.49, max: 82 },
      },
      corridor: {
        mean: { min: 5, reference: 6.79, max: 8.5 },
        below16Percent: { min: 86, reference: 89.12, max: 92 },
      },
      flashlight: {
        mean: { min: 3, reference: 4.25, max: 5.5 },
        below16Percent: { min: 88, reference: 90.93, max: 94 },
      },
    },
  },
  palette: {
    structuralDark: '#24383b',
    structuralMid: '#43575a',
    cyanSpill: '#2e7b82',
    negativeFill: '#020405',
  },
  camera: {
    projection: { fov: 65, near: .08, far: 80 },
    entry: { position: [0, 1.95, -10.2], yaw: Math.PI, pitch: 0 },
    // Cinematic framing deliberately looks back through the destroyed room.
    // Gameplay still converges to player-start and faces the first door (+Z).
    coldOpen: { position: [2.5, 1.44, 9.6], yaw: .1, pitch: -.055 },
  },
  composition: {
    classroomSubjectMinViewport: .7,
    foregroundOccluderMaxViewport: .2,
    ceilingForegroundMaxViewport: .2,
    facade: { position: [0, 2.7, -3.2], width: 28.8, height: 5.4 },
    foregroundOccluder: { position: [-3, -.25, 5.45], scale: [.32, .32, .32] },
    nearestCeilingPanelZ: 6.4,
    // These are existing authored surfaces, not freestanding presentation
    // planes: blackboard and brick live on the rear wall, window in its bay.
    rearBlackboard: { position: [0, 2.78, -1.67], width: 7.85, height: 1.58 },
    rearBrickPatches: [[-4.6, 2.52, -1.73], [4.75, 2.36, -1.73]],
    leftWindowHeroBay: { position: [-6.77, 2.32, 1.25], maxViewport: .25 },
    coldOpenDeskPositions: [[-1.2, 0, 6.2], [3.85, 0, 4.2]],
  },
  lighting: {
    exposure: { base: .78, playing: .78, coldOpen: .9 },
    interior: {
      directionalCyan: .18,
      windowPool: 2.75,
      floorPool: .9,
      // Cold-open remains legible from its rear-facing camera, but uses one
      // short-range pool rather than a room-wide ambient lift.
      coldOpenDirectionalCyan: .34,
      coldOpenRearPool: 3.6,
    },
    exterior: {
      directionalCyan: .38,
      facadePool: 7.5,
      facadeRim: 2.2,
    },
  },
} as const;

export type PostStrikeRenderGuardrails = typeof POST_STRIKE_RENDER_GUARDRAILS;
