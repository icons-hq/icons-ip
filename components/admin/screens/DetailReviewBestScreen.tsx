'use client';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { saveBestReviewSettingsAction, type BestReviewSettingsResult } from '@/app/admin/review-best-actions';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button } from '@/components/admin/kit/ui/button';
import type { ReviewBestSettings } from '@/lib/review-best';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

export function DetailReviewBestScreen({ initial }: { initial: ReviewBestSettings }) {
  const [enabled, setEnabled] = useState(initial.enabled), [revision, setRevision] = useState(initial.revision), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ enabled: boolean; revision: number; id: string } | null>(null);
  async function save() {
    if (pending || initial.unavailable) return;
    request.current ??= { enabled, revision, id: crypto.randomUUID() }; setPending(true); setMessage('');
    let result: BestReviewSettingsResult;
    try { result = await saveBestReviewSettingsAction(request.current.enabled, request.current.revision, request.current.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setEnabled(result.settings.enabled); setRevision(result.settings.revision); setMessage('저장했습니다. 상품상세에 적용되었습니다.'); setError(false); setUncertain(false); request.current = null; }
  }
  return <div className="flex min-w-0 flex-col gap-4" data-review-best-settings="">
    <AdminPageHeader title="BEST 리뷰 전시 설정" description="운영자가 선정한 리뷰를 상품상세 대표 이미지 영역에 표시합니다." />
    <StoreSettingsRelatedLinks label="상품상세 추가 설정" links={[{ href: '/admin/display/detail', label: '띠배너·리뷰·추천' }, { href: '/admin/display/detail/media', label: '대표미디어 설정' }, { href: '/admin/cs/reviews?best=selected', label: '선정 리뷰 관리' }]} />
    {initial.unavailable ? <Alert variant="destructive"><AlertDescription>현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</AlertDescription></Alert> : null}
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title="베스트리뷰 상단 노출"><fieldset className="flex min-w-0 flex-col gap-3 disabled:opacity-60" disabled={pending || uncertain || initial.unavailable}>
        <legend className="mb-1 text-sm text-muted-foreground">대표 이미지 영역의 선정 리뷰</legend>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />선정 BEST 리뷰 표시</label>
        <p className="text-sm leading-relaxed text-muted-foreground">상품별로 현재 노출 가능한 선정 리뷰가 3개 이상일 때 3개를 무작위로 표시합니다. 3개 미만이면 영역 전체를 숨깁니다.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">리뷰 관리에서 별점과 무관하게 선정·해제합니다. 작성자 수정이나 블라인드, 구매 취소·반품·환불은 노출에서 제외하며 다시 확인한 뒤 재선정할 수 있습니다.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">평점 평균과 리뷰 전체 건수는 기존 공개 리뷰 전체를 기준으로 유지합니다. 상단 리뷰 요약과는 별도 설정입니다.</p>
      </fieldset></AdminSectionCard>
      <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border bg-card p-4">{message ? <p className={error ? 'mr-auto bg-transparent text-sm text-destructive' : 'mr-auto text-sm text-success'} role={error ? 'alert' : 'status'}>{message}</p> : null}<Button disabled={pending || Boolean(initial.unavailable)} type="submit">{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button></div>
    </form>
  </div>;
}
