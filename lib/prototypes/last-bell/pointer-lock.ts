export type LastBellPointerLockTarget = {
  requestPointerLock?: () => void | Promise<void>;
};

/** Pointer lock is progressive enhancement; refusal must never stop play. */
export async function requestLastBellPointerLock(
  target: LastBellPointerLockTarget | null | undefined,
): Promise<boolean> {
  if (!target?.requestPointerLock) return false;
  try {
    await target.requestPointerLock();
    return true;
  } catch {
    return false;
  }
}
