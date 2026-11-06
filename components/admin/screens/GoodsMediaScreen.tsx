'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { GoodsMediaUploadField } from '@/components/admin/GoodsMediaUploadField';
import { saveGoodMediaAction, type GoodMediaSaveResult } from '@/app/admin/goods-media-actions';
import { GOODS_MEDIA_KINDS, GOODS_MEDIA_SETTINGS_PATH, type GoodMediaSnapshot, type GoodsMediaAsset, type GoodsMediaKind, type GoodsMediaSelection } from '@/lib/goods-media';

export function GoodsMediaScreen({ initial }: { initial: GoodMediaSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial), [assets, setAssets] = useState({ video: initial.video, shortclip: initial.shortclip });
  const [busy, setBusy] = useState({ video: false, shortclip: false }), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ values: GoodsMediaSelection; revision: number; operationId: string } | null>(null);
  const disabled = pending || uncertain || Boolean(initial.unavailable);
  const choose = (kind: GoodsMediaKind, asset: GoodsMediaAsset | null) => setAssets(current => ({ ...current, [kind]: asset ? { ...asset, title: current[kind]?.title || asset.title } : null }));
  async function save() {
    if (pending || initial.unavailable || busy.video || busy.shortclip) return;
    const values: GoodsMediaSelection = { video: assets.video ? { id: assets.video.id, title: assets.video.title } : null, shortclip: assets.shortclip ? { id: assets.shortclip.id, title: assets.shortclip.title } : null };
    request.current ??= { values, revision: snapshot.revision, operationId: crypto.randomUUID() };
    setPending(true); setMessage(''); let result: GoodMediaSaveResult;
    try { result = await saveGoodMediaAction(initial.goodId, request.current.values, request.current.revision, request.current.operationId); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setSnapshot(result.snapshot); setAssets({ video: result.snapshot.video, shortclip: result.snapshot.shortclip }); setMessage('저장했습니다. 상품상세에 적용되었습니다.'); setError(false); setUncertain(false); request.current = null; }
  }
  /* 저장 버튼은 네이티브 button에 kit 버튼 모양을 입힌다 — 화면 전송 실패 재시도 테스트(PresentationTransportFailure)가
     전시 설정 화면들과 함께 네이티브 제출 버튼을 찾는다. 모양·동작은 kit Button과 같다. */
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-media">
    <Link className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(initial.goodId)}`}>← 상품 수정으로</Link>
    <AdminPageHeader title="상품 동영상·숏클립" description={`${initial.goodName} · ${initial.goodId}`} />
    <p className="text-sm text-muted-foreground">영상을 확인한 뒤 저장하면 상품상세 갤러리에 표시됩니다. 첫 화면은 <Link className="text-foreground underline underline-offset-4" href={GOODS_MEDIA_SETTINGS_PATH}>대표미디어 전시 설정</Link>을 따릅니다.</p>
    {initial.unavailable ? <p className="text-sm text-destructive" role="alert">현재 영상 구성을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title="영상 구성">
        <fieldset disabled={disabled} className="grid min-w-0 gap-6 lg:grid-cols-2">
          {GOODS_MEDIA_KINDS.map(kind => <div className="flex min-w-0 flex-col gap-4" key={kind}>
            <GoodsMediaUploadField kind={kind} asset={assets[kind]} disabled={disabled} onAsset={asset => choose(kind, asset)} onBusy={value => setBusy(current => ({ ...current, [kind]: value }))} />
            {assets[kind] ? <label className="flex flex-col gap-2 text-sm font-medium">{kind === 'video' ? '동영상' : '숏클립'} 타이틀<Input value={assets[kind].title} required maxLength={20} onChange={event => setAssets(current => ({ ...current, [kind]: current[kind] ? { ...current[kind], title: event.target.value } : null }))} /><small className="text-xs font-normal text-muted-foreground tabular-nums">{Array.from(assets[kind].title).length}/20</small></label> : null}
          </div>)}
        </fieldset>
      </AdminSectionCard>
      <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border bg-card p-4">{message ? <p className={`text-sm${error ? ' text-destructive' : ' text-[var(--wc-success)]'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<button className={buttonVariants()} data-slot="button" type="submit" disabled={pending || busy.video || busy.shortclip || Boolean(initial.unavailable)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '영상 구성 저장'}</button></div>
    </form>
  </section>;
}
