import 'server-only';

/** 내부 프로토타입은 서버 전용 환경값이 정확히 `1`일 때만 열린다. */
export function isTusinSurvivalPrototypeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.ICONS_PROTOTYPE === '1';
}
