/**
 * Student photos are intentionally transient browser presentation data. The
 * campaign state schema must never receive the file, an object URL, or a data
 * URL; this narrow validator only protects the local preview/share handoff.
 */
export const AOUAD_STUDENT_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AOUAD_STUDENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

type StudentPhotoFile = Pick<File, 'size' | 'type'>;

export type AouadStudentPhotoValidation =
  | { accepted: true }
  | { accepted: false; reason: 'type' | 'size' };

export function validateAouadStudentPhoto(file: StudentPhotoFile): AouadStudentPhotoValidation {
  if (!(AOUAD_STUDENT_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) return { accepted: false, reason: 'type' };
  if (file.size > AOUAD_STUDENT_PHOTO_MAX_BYTES) return { accepted: false, reason: 'size' };
  return { accepted: true };
}
