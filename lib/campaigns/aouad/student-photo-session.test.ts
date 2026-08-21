import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('AOUAD student photo document session', () => {
  it('survives a popup route remount in memory and revokes only replaced or removed object URLs', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const {
      getAouadStudentPhotoSession,
      setAouadStudentPhotoShareConsent,
      setAouadStudentPhotoUrl,
    } = await import('./student-photo-session');

    expect(getAouadStudentPhotoSession()).toEqual({ photoUrl: null, includeInShare: false });
    expect(setAouadStudentPhotoUrl('blob:student-a')).toEqual({ photoUrl: 'blob:student-a', includeInShare: false });
    expect(setAouadStudentPhotoShareConsent(true)).toEqual({ photoUrl: 'blob:student-a', includeInShare: true });
    expect(getAouadStudentPhotoSession()).toEqual({ photoUrl: 'blob:student-a', includeInShare: true });

    expect(setAouadStudentPhotoUrl('blob:student-b')).toEqual({ photoUrl: 'blob:student-b', includeInShare: false });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:student-a');
    expect(setAouadStudentPhotoUrl(null)).toEqual({ photoUrl: null, includeInShare: false });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:student-b');
  });
});
