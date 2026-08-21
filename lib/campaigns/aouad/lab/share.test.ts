import { describe, expect, it, vi } from 'vitest';
import type { AouadComparisonResult } from './comparison';
import {
  comparisonSharePayload,
  comparisonSharePhotoFromSession,
  shareAouadComparisonResult,
} from './share';

const result: AouadComparisonResult = {
  schemaVersion: 1,
  authority: 'local-prototype',
  rewardEligible: false,
  candidateId: 'infection-record',
  runId: 'infection-share-01',
  startedAt: '2026-08-21T00:00:00.000Z',
  completedAt: '2026-08-21T00:01:22.000Z',
  activeDurationMs: 82_000,
  retryCount: 1,
  resultType: 'quarantined',
};

describe('AOUAD comparison sharing', () => {
  it('adapts every candidate into the privacy-safe common image share contract', () => {
    const payload = comparisonSharePayload(result, '2D 감염 기록 체험', 'https://example.test/lab/infection-record');
    expect(payload).toEqual(expect.objectContaining({
      title: '효산고 비교 체험 · 2D 감염 기록 체험',
      routeLabel: '2D 감염 기록 체험',
      durationLabel: '활동 시간 1분 22초',
      cardKicker: 'ALL OF US ARE DEAD: COMPARISON LAB',
      cardHeadline: '비교 체험 기록',
      cardFilename: 'infection-record-comparison-record.png',
    }));
    expect(payload).not.toHaveProperty('photo');
  });

  it('includes a student photo only after explicit consent with a live session photo', () => {
    expect(comparisonSharePhotoFromSession({ photoUrl: null, includeInShare: false })).toBeUndefined();
    expect(comparisonSharePhotoFromSession({ photoUrl: 'blob:student', includeInShare: false })).toBeUndefined();
    expect(comparisonSharePhotoFromSession({ photoUrl: null, includeInShare: true })).toBeUndefined();

    const photo = comparisonSharePhotoFromSession({ photoUrl: 'blob:student', includeInShare: true });
    expect(photo).toEqual({ src: 'blob:student' });
    expect(comparisonSharePayload(result, '감염 기록', 'https://example.test/result', { photo })).toHaveProperty('photo', photo);
  });

  it('uses the shared text Web Share fallback when image sharing is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    const method = await shareAouadComparisonResult(
      result,
      '2D 감염 기록 체험',
      'https://example.test/lab/infection-record',
      { navigatorRef: { share, canShare: vi.fn(() => false) } },
    );

    expect(method).toBe('web-share');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: '효산고 비교 체험 · 2D 감염 기록 체험',
      text: expect.stringContaining('결과: quarantined'),
    }));
    expect((share.mock.calls[0]?.[0] as ShareData).files).toBeUndefined();
  });

  it('returns cancelled without copying after the user dismisses Web Share', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));
    const writeText = vi.fn().mockResolvedValue(undefined);

    const method = await shareAouadComparisonResult(
      result,
      '2D 감염 기록 체험',
      'https://example.test/lab/infection-record',
      { navigatorRef: { share, clipboard: { writeText } } },
    );

    expect(method).toBe('cancelled');
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });
});
