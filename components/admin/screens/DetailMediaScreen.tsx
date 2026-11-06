'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { saveGoodsMediaSettingsAction, type MediaSettingsSaveResult } from '@/app/admin/goods-media-actions';
import type { GoodsMediaSettings, GoodsMediaSettingsSnapshot } from '@/lib/goods-media';

/* 대표미디어 전시 설정(템플릿 룩, ADR-0028). 다른 상품상세 설정으로 가는 링크는 링크 탭과 같은 모양이다. */
const LINKS = 'inline-flex max-w-full items-center self-start overflow-x-auto rounded-lg bg-muted p-0.5';
const LINK = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground';
const CHOICE = 'flex w-fit items-center gap-2 text-sm';

export function DetailMediaScreen({ initial }: { initial: GoodsMediaSettingsSnapshot }) {
  const [values, setValues] = useState(initial.values), [revision, setRevision] = useState(initial.revision), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ values: GoodsMediaSettings; revision: number; id: string } | null>(null);
  async function save() {
    if (pending || initial.unavailable) return;
    request.current ??= { values, revision, id: crypto.randomUUID() }; setPending(true); setMessage(''); let result: MediaSettingsSaveResult;
    try { result = await saveGoodsMediaSettingsAction(request.current.values, request.current.revision, request.current.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setValues(result.snapshot.values); setRevision(result.snapshot.revision); setError(false); setUncertain(false); request.current = null; setMessage('저장했습니다. 상품상세에 적용되었습니다.'); }
  }
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="대표미디어 전시 설정" description="상품에 등록한 이미지·동영상·숏클립의 첫 화면을 선택합니다." />
    <nav aria-label="상품상세 추가 설정" className={LINKS}><Link className={LINK} href="/admin/display/detail">띠배너·리뷰·추천</Link><Link className={LINK} href="/admin/display/detail/experience">구매·탐색 설정</Link><Link className={LINK} href="/admin/display/detail/reviews">BEST 리뷰 설정</Link><Link className={LINK} href="/admin/catalog/goods">상품별 영상 등록</Link></nav>
    {initial.unavailable ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title="대표미디어 전시 우선순위"><fieldset className="grid min-w-0 gap-3" disabled={pending || uncertain || initial.unavailable}>
        <legend className="mb-1 text-sm font-medium">상품상세에서 먼저 보여줄 콘텐츠</legend>
        {([['image', '이미지'], ['video', '동영상'], ['shortclip', '숏클립']] as const).map(([value, label]) => <label className={CHOICE} key={value}><input name="media-priority" type="radio" checked={values.priority === value} onChange={() => setValues(current => ({ ...current, priority: value }))} />{label}</label>)}
        <p className="text-sm text-muted-foreground">선택한 영상이 등록되지 않은 상품은 이미지를 먼저 보여줍니다. 영상은 재생 버튼으로 시작하며 재생 실패·대기 시간 초과 시 대표 이미지로 전환합니다.</p>
        <label className={CHOICE}><input type="checkbox" checked={values.shortclips} onChange={event => setValues(current => ({ ...current, shortclips: event.target.checked }))} />상품상세에 숏클립 영역 표시</label>
        <p className="text-sm text-muted-foreground">상품에 직접 등록한 숏클립이 있을 때 별도 영역을 표시합니다.</p>
      </fieldset></AdminSectionCard>
      <div className="flex flex-col items-stretch justify-end gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">{message ? <p className={`text-sm sm:mr-auto ${error ? 'text-destructive' : 'text-[var(--wc-success)]'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<Button type="submit" disabled={pending || Boolean(initial.unavailable)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button></div>
    </form>
  </section>;
}
