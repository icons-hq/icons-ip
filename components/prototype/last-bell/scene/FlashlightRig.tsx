'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type FlashlightRigProps = {
  on?: boolean;
  shadowMapSize?: number;
};

/** Display-sRGB values calibrated against fixed 1280x720 gameplay captures. */
export const LAST_BELL_FLASHLIGHT_PROFILE = {
  centralIntensity: 72,
  outerFillIntensity: 20,
  outerFillDistance: 8.5,
  outerFillAngleDegrees: 68,
  nearBounceIntensity: 88,
  nearBounceDistance: 5.8,
  sideBounceIntensity: .85,
  sideBounceDistance: 4.8,
  sideBounceOffset: 1.1,
  ambientIntensity: .48,
  hemisphereIntensity: 1,
} as const;

/**
 * The flashlight follows the camera's world transform, so the visual cone
 * follows the same forward vector used by authored perception. The default R3F
 * camera is not guaranteed to be traversed as a scene child for light setup,
 * therefore the light itself stays scene-attached while behaving as its camera
 * child. It is the only shadow-casting dynamic light in this lookdev pass.
 */
export function FlashlightRig({ on = true, shadowMapSize = 1024 }: FlashlightRigProps) {
  const { camera, scene } = useThree();
  const lightRef = useRef<THREE.SpotLight | null>(null);
  const outerFillRef = useRef<THREE.SpotLight | null>(null);
  const nearBounceRef = useRef<THREE.PointLight | null>(null);
  const leftBounceRef = useRef<THREE.PointLight | null>(null);
  const rightBounceRef = useRef<THREE.PointLight | null>(null);
  const ambientRef = useRef<THREE.AmbientLight | null>(null);
  const hemisphereRef = useRef<THREE.HemisphereLight | null>(null);
  const targetRef = useRef<THREE.Object3D | null>(null);
  const directionRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const cameraPositionRef = useRef(new THREE.Vector3());
  const cameraQuaternionRef = useRef(new THREE.Quaternion());

  useEffect(() => {
    // A soft-edged 19.5deg pool matches the requested central handheld torch:
    // it reads at the nine-metre classroom threshold while the periphery stays
    // near-black. This remains a local light, never a room-wide fill.
    const light = new THREE.SpotLight('#d8ece5', LAST_BELL_FLASHLIGHT_PROFILE.centralIntensity, 16, THREE.MathUtils.degToRad(19.5), .86, 1.75);
    // A separate broad, non-shadowing cone preserves the narrow horror beam
    // while keeping nearby walls, floor edges, and hiding spots readable.
    const outerFill = new THREE.SpotLight(
      '#62aaa7',
      LAST_BELL_FLASHLIGHT_PROFILE.outerFillIntensity,
      LAST_BELL_FLASHLIGHT_PROFILE.outerFillDistance,
      THREE.MathUtils.degToRad(LAST_BELL_FLASHLIGHT_PROFILE.outerFillAngleDegrees),
      .94,
      2,
    );
    outerFill.castShadow = false;
    const nearBounce = new THREE.PointLight(
      '#4b7775',
      LAST_BELL_FLASHLIGHT_PROFILE.nearBounceIntensity,
      LAST_BELL_FLASHLIGHT_PROFILE.nearBounceDistance,
      1.7,
    );
    nearBounce.castShadow = false;
    // Side walls are nearly perpendicular to a camera-centred fill and were
    // therefore collapsing to zero display luminance even while the central
    // beam looked correct. Two short-range, camera-relative bounce sources
    // sit inside the playable lane. They reveal only nearby wall/floor edges;
    // their hard distance cap keeps the 12m background near-black.
    const leftBounce = new THREE.PointLight(
      '#416f70',
      LAST_BELL_FLASHLIGHT_PROFILE.sideBounceIntensity,
      LAST_BELL_FLASHLIGHT_PROFILE.sideBounceDistance,
      1.8,
    );
    const rightBounce = leftBounce.clone();
    leftBounce.castShadow = false;
    rightBounce.castShadow = false;
    // The environment lift is intentionally tiny and remains available when
    // the torch is off, preventing near-camera geometry from collapsing into
    // an undifferentiated black screen.
    const ambient = new THREE.AmbientLight('#345a5b', LAST_BELL_FLASHLIGHT_PROFILE.ambientIntensity);
    // Bomb-damaged rooms still receive cold moon/sky bounce. Unlike the
    // flashlight spill this remains global and very soft, which preserves the
    // distant silhouette while making nearby floor edges and real hiding
    // geometry readable instead of pitch black.
    const hemisphere = new THREE.HemisphereLight(
      '#5f8d91',
      '#071012',
      LAST_BELL_FLASHLIGHT_PROFILE.hemisphereIntensity,
    );
    const target = new THREE.Object3D();
    light.castShadow = true;
    const mapSize = Math.min(1024, Math.max(512, shadowMapSize));
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.camera.near = .15;
    light.shadow.camera.far = 16;
    light.shadow.bias = -.00035;
    light.position.set(0, 0, 0);
    scene.add(light);
    scene.add(outerFill);
    scene.add(nearBounce);
    scene.add(leftBounce);
    scene.add(rightBounce);
    scene.add(ambient);
    scene.add(hemisphere);
    scene.add(target);
    light.target = target;
    outerFill.target = target;
    lightRef.current = light;
    outerFillRef.current = outerFill;
    nearBounceRef.current = nearBounce;
    leftBounceRef.current = leftBounce;
    rightBounceRef.current = rightBounce;
    ambientRef.current = ambient;
    hemisphereRef.current = hemisphere;
    targetRef.current = target;
    return () => {
      scene.remove(light);
      scene.remove(outerFill);
      scene.remove(nearBounce);
      scene.remove(leftBounce);
      scene.remove(rightBounce);
      scene.remove(ambient);
      scene.remove(hemisphere);
      scene.remove(target);
      light.dispose();
      outerFill.dispose();
      nearBounce.dispose();
      leftBounce.dispose();
      rightBounce.dispose();
      ambient.dispose();
      hemisphere.dispose();
      lightRef.current = null;
      outerFillRef.current = null;
      nearBounceRef.current = null;
      leftBounceRef.current = null;
      rightBounceRef.current = null;
      ambientRef.current = null;
      hemisphereRef.current = null;
      targetRef.current = null;
    };
  }, [camera, scene, shadowMapSize]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.visible = on;
    light.intensity = on ? LAST_BELL_FLASHLIGHT_PROFILE.centralIntensity : 0;
    const outerFill = outerFillRef.current;
    if (outerFill) {
      outerFill.visible = on;
      outerFill.intensity = on ? LAST_BELL_FLASHLIGHT_PROFILE.outerFillIntensity : 0;
    }
    const nearBounce = nearBounceRef.current;
    if (nearBounce) {
      nearBounce.visible = on;
      nearBounce.intensity = on ? LAST_BELL_FLASHLIGHT_PROFILE.nearBounceIntensity : 0;
    }
    for (const sideBounce of [leftBounceRef.current, rightBounceRef.current]) {
      if (!sideBounce) continue;
      sideBounce.visible = on;
      sideBounce.intensity = on ? LAST_BELL_FLASHLIGHT_PROFILE.sideBounceIntensity : 0;
    }
  }, [on]);

  useFrame(() => {
    const target = targetRef.current;
    if (!target) return;
    camera.getWorldPosition(cameraPositionRef.current);
    camera.getWorldQuaternion(cameraQuaternionRef.current);
    directionRef.current.set(0, 0, -1).applyQuaternion(cameraQuaternionRef.current);
    rightRef.current.set(1, 0, 0).applyQuaternion(cameraQuaternionRef.current);
    const light = lightRef.current;
    light?.position.copy(cameraPositionRef.current).addScaledVector(directionRef.current, .08);
    outerFillRef.current?.position.copy(cameraPositionRef.current).addScaledVector(directionRef.current, .12);
    nearBounceRef.current?.position.copy(cameraPositionRef.current).addScaledVector(directionRef.current, .2);
    leftBounceRef.current?.position
      .copy(cameraPositionRef.current)
      .addScaledVector(directionRef.current, .45)
      .addScaledVector(rightRef.current, -LAST_BELL_FLASHLIGHT_PROFILE.sideBounceOffset);
    rightBounceRef.current?.position
      .copy(cameraPositionRef.current)
      .addScaledVector(directionRef.current, .45)
      .addScaledVector(rightRef.current, LAST_BELL_FLASHLIGHT_PROFILE.sideBounceOffset);
    target.position.copy(cameraPositionRef.current).addScaledVector(directionRef.current, 9);
    target.updateMatrixWorld();
    light?.updateMatrixWorld();
    outerFillRef.current?.updateMatrixWorld();
    nearBounceRef.current?.updateMatrixWorld();
    leftBounceRef.current?.updateMatrixWorld();
    rightBounceRef.current?.updateMatrixWorld();
  });

  return null;
}
