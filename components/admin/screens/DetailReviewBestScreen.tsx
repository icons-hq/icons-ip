'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { saveBestReviewSettingsAction, type BestReviewSettingsResult } from '@/app/admin/review-best-actions';
import type { ReviewBestSettings } from '@/lib/review-best';

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
  return <section className="wc-admin-kit wc-admin-kit__screen admin-review-best-settings">
    <AdminPageHeader title="BEST 리뷰 전시 설정" description="운영자가 선정한 리뷰를 상품상세 대표 이미지 영역에 표시합니다." />
    <nav aria-label="상품상세 추가 설정" className="admin-review-best__links"><Link href="/admin/display/detail">띠배너·리뷰·추천</Link><Link href="/admin/display/detail/media">대표미디어 설정</Link><Link href="/admin/cs/reviews?best=selected">선정 리뷰 관리</Link></nav>
    {initial.unavailable ? <p role="alert">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title="베스트리뷰 상단 노출"><fieldset disabled={pending || uncertain || initial.unavailable}>
        <legend>대표 이미지 영역의 선정 리뷰</legend>
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />선정 BEST 리뷰 표시</label>
        <p>상품별로 현재 노출 가능한 선정 리뷰가 3개 이상일 때 3개를 무작위로 표시합니다. 3개 미만이면 영역 전체를 숨깁니다.</p>
        <p>리뷰 관리에서 별점과 무관하게 선정·해제합니다. 작성자 수정이나 블라인드, 구매 취소·반품·환불은 노출에서 제외하며 다시 확인한 뒤 재선정할 수 있습니다.</p>
        <p>평점 평균과 리뷰 전체 건수는 기존 공개 리뷰 전체를 기준으로 유지합니다. 상단 리뷰 요약과는 별도 설정입니다.</p>
      </fieldset></AdminSectionCard>
      <div className="admin-review-best__save">{message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}<button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || Boolean(initial.unavailable)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</button></div>
    </form>
  </section>;
}
