import { describe, expect, it } from 'vitest';
import {
  AOUAD_STUDENT_PHOTO_MAX_BYTES,
  AOUAD_STUDENT_PHOTO_MIME_TYPES,
  validateAouadStudentPhoto,
} from './student-photo';

describe('AOUAD student photo validation', () => {
  it.each(AOUAD_STUDENT_PHOTO_MIME_TYPES)('allows the approved %s raster MIME type below the local limit', (type) => {
    expect(validateAouadStudentPhoto({ type, size: AOUAD_STUDENT_PHOTO_MAX_BYTES } as File)).toEqual({ accepted: true });
  });

  it('rejects unsupported media types and oversized files before an object URL exists', () => {
    expect(validateAouadStudentPhoto({ type: 'image/gif', size: 1 } as File)).toEqual({ accepted: false, reason: 'type' });
    expect(validateAouadStudentPhoto({ type: 'image/png', size: AOUAD_STUDENT_PHOTO_MAX_BYTES + 1 } as File)).toEqual({ accepted: false, reason: 'size' });
  });
});
