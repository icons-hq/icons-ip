export type AouadStudentPhotoSession = {
  photoUrl: string | null;
  includeInShare: boolean;
};

let session: AouadStudentPhotoSession = { photoUrl: null, includeInShare: false };

/**
 * Object URLs and their explicit sharing consent are document-scoped only.
 * This survives App Router route remounts without ever entering localStorage
 * or campaign analytics; a full document unload releases the JS context.
 */
export function getAouadStudentPhotoSession(): AouadStudentPhotoSession {
  return { ...session };
}

export function setAouadStudentPhotoUrl(photoUrl: string | null): AouadStudentPhotoSession {
  if (session.photoUrl && session.photoUrl !== photoUrl) URL.revokeObjectURL(session.photoUrl);
  session = { photoUrl, includeInShare: false };
  return getAouadStudentPhotoSession();
}

export function setAouadStudentPhotoShareConsent(includeInShare: boolean): AouadStudentPhotoSession {
  session = { ...session, includeInShare: Boolean(session.photoUrl) && includeInShare };
  return getAouadStudentPhotoSession();
}
