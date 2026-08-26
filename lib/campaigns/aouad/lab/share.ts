import type { AouadComparisonResult } from './comparison';
import type { AouadStudentPhotoSession } from '../student-photo-session';
import {
  shareAouadResult,
  type AouadShareNavigator,
  type AouadSharePhoto,
  type AouadShareResult,
} from '../share';

export type AouadComparisonShareResult = AouadShareResult;

export type AouadComparisonShareOptions = {
  navigatorRef?: AouadShareNavigator;
  photo?: AouadSharePhoto;
};

export function comparisonShareText(result: AouadComparisonResult, candidateName: string): string {
  const seconds = Math.max(0, Math.round(result.activeDurationMs / 1000));
  return `효산고 비교 체험 · ${candidateName}\n결과: ${result.resultType}\n활동 시간: ${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초\n로컬 평가 기록이며 보상·순위·구매 권한과 무관합니다.`;
}

export function comparisonSharePayload(
  result: AouadComparisonResult,
  candidateName: string,
  url: string,
  options: Pick<AouadComparisonShareOptions, 'photo'> = {},
) {
  const seconds = Math.max(0, Math.round(result.activeDurationMs / 1000));
  return {
    title: `효산고 비교 체험 · ${candidateName}`,
    text: comparisonShareText(result, candidateName),
    url,
    routeLabel: candidateName,
    durationLabel: `활동 시간 ${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`,
    cardKicker: 'ALL OF US ARE DEAD: COMPARISON LAB',
    cardHeadline: '비교 체험 기록',
    cardFilename: `${result.candidateId}-comparison-record.png`,
    ...(options.photo ? { photo: options.photo } : {}),
  };
}

/** A missing photo or default-off consent must produce no share-card photo. */
export function comparisonSharePhotoFromSession(
  session: Pick<AouadStudentPhotoSession, 'photoUrl' | 'includeInShare'>,
): AouadSharePhoto | undefined {
  return session.includeInShare && session.photoUrl ? { src: session.photoUrl } : undefined;
}

export async function shareAouadComparisonResult(
  result: AouadComparisonResult,
  candidateName: string,
  url: string,
  options: AouadComparisonShareOptions = {},
): Promise<AouadComparisonShareResult> {
  const navigatorRef = options.navigatorRef ?? (typeof navigator === 'undefined' ? {} : navigator);
  return shareAouadResult(comparisonSharePayload(result, candidateName, url, options), navigatorRef);
}
