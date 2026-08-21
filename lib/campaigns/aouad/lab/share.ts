import type { AouadComparisonResult } from './comparison';

export type AouadComparisonShareResult = 'web-share' | 'clipboard' | 'unavailable';

export type AouadComparisonNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

export function comparisonShareText(result: AouadComparisonResult, candidateName: string): string {
  const seconds = Math.max(0, Math.round(result.activeDurationMs / 1000));
  return `효산고 비교 체험 · ${candidateName}\n결과: ${result.resultType}\n활동 시간: ${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초\n로컬 평가 기록이며 보상·순위·구매 권한과 무관합니다.`;
}

export async function shareAouadComparisonResult(
  result: AouadComparisonResult,
  candidateName: string,
  url: string,
  navigatorRef: AouadComparisonNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Promise<AouadComparisonShareResult> {
  const text = comparisonShareText(result, candidateName);
  try {
    if (navigatorRef?.share) {
      await navigatorRef.share({ title: `효산고 비교 체험 · ${candidateName}`, text, url });
      return 'web-share';
    }
  } catch {
    // Native sheet cancellation should still offer a local text fallback.
  }
  try {
    if (navigatorRef?.clipboard) {
      await navigatorRef.clipboard.writeText(`${text}\n${url}`);
      return 'clipboard';
    }
  } catch {
    // Clipboard availability is browser and user-gesture dependent.
  }
  return 'unavailable';
}
