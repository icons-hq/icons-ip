'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { GoodsMediaUploadField } from '@/components/admin/GoodsMediaUploadField';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { useAdminStateRecovery } from '@/components/admin/useAdminStateRecovery';
import { saveGoodMediaAction, type GoodMediaSaveResult } from '@/app/admin/goods-media-actions';
import { GOODS_MEDIA_KINDS, GOODS_MEDIA_SETTINGS_PATH, parseGoodsMediaAsset, type GoodMediaSnapshot, type GoodsMediaAsset, type GoodsMediaKind, type GoodsMediaSelection } from '@/lib/goods-media';

const KIND_LABEL: Record<GoodsMediaKind, string> = { video: '동영상', shortclip: '숏클립' };
const UNKNOWN_SAVE = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
/** 뒤로 가기로 떠났다 돌아왔을 때. 되살린 값은 아직 상품에 적용되지 않았다는 것까지 말한다. */
const RESTORED = '저장하지 않고 떠났던 영상 변경을 되살렸습니다. [영상 구성 저장]을 눌러야 상품에 적용됩니다.';
/* 저장 때 보내는 값(영상 번호·제목)만 비교한다. */
const sameMedia = (saved: GoodsMediaAsset | null, current: GoodsMediaAsset | null) => (saved?.id ?? null) === (current?.id ?? null) && (saved?.title ?? null) === (current?.title ?? null);

/** `goodCode`는 상품 자동코드다. 읽지 못했으면 비워 두고 상품명만 보인다. */
export function GoodsMediaScreen({ initial, goodCode }: { initial: GoodMediaSnapshot; goodCode?: string | null }) {
  const [snapshot, setSnapshot] = useState(initial), [assets, setAssets] = useState({ video: initial.video, shortclip: initial.shortclip });
  const [busy, setBusy] = useState({ video: false, shortclip: false }), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ values: GoodsMediaSelection; revision: number; operationId: string } | null>(null);
  const disabled = pending || uncertain || Boolean(initial.unavailable);
  /* 저장하지 않은 것: 영상·제목을 바꿨거나, 영상을 올리는 중이거나, 올린 결과를 아직 모르는 종류. 떠나면 사라지는 것의 이름을 확인창에 보인다. */
  const unsaved = GOODS_MEDIA_KINDS.filter(kind => !sameMedia(snapshot[kind], assets[kind]) || busy[kind]);
  useAdminLeaveGuard({ dirty: unsaved.length > 0 || uncertain, message: `저장하지 않은 ${unsaved.length ? unsaved.map(kind => KIND_LABEL[kind]).join('·') : '영상 구성'} 변경이 있습니다. 이동하면 바꾼 내용이 상품에 적용되지 않습니다. 이동할까요?` });
  /* 브라우저 뒤로 가기는 막을 수 없어(확인창을 띄울 수 없다), 저장하지 않은 영상 구성을 이 탭에 보관했다가 같은 주소로 돌아오면 되살린다.
     보관하는 것은 확인을 마친 영상(번호·제목 등)뿐이다 — 올리는 중인 파일은 되살릴 수 없다. 브라우저에 있던 값이라 형식을 다시 확인하고,
     그사이 같은 구성이 저장됐으면 되살릴 것이 없다. */
  useAdminStateRecovery({
    id: 'goods-media',
    dirty: !initial.unavailable && GOODS_MEDIA_KINDS.some(kind => !sameMedia(snapshot[kind], assets[kind])),
    value: assets,
    onRestore: saved => {
      if (initial.unavailable || !saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      const record = saved as Record<string, unknown>;
      if (!GOODS_MEDIA_KINDS.every(kind => Object.hasOwn(record, kind))) return;
      const video = record.video === null ? null : parseGoodsMediaAsset(record.video), shortclip = record.shortclip === null ? null : parseGoodsMediaAsset(record.shortclip);
      if (record.video !== null && video?.kind !== 'video' || record.shortclip !== null && shortclip?.kind !== 'shortclip') return;
      const restored = { video, shortclip };
      if (GOODS_MEDIA_KINDS.every(kind => sameMedia(snapshot[kind], restored[kind]))) return;
      setAssets(restored); setMessage(RESTORED); setError(false);
    },
  });
  const choose = (kind: GoodsMediaKind, asset: GoodsMediaAsset | null) => setAssets(current => ({ ...current, [kind]: asset ? { ...asset, title: current[kind]?.title || asset.title } : null }));
  async function save() {
    if (pending || initial.unavailable || busy.video || busy.shortclip) return;
    const values: GoodsMediaSelection = { video: assets.video ? { id: assets.video.id, title: assets.video.title } : null, shortclip: assets.shortclip ? { id: assets.shortclip.id, title: assets.shortclip.title } : null };
    request.current ??= { values, revision: snapshot.revision, operationId: crypto.randomUUID() };
    setPending(true); setMessage(''); let result: GoodMediaSaveResult;
    try { result = await saveGoodMediaAction(initial.goodId, request.current.values, request.current.revision, request.current.operationId); }
    catch { result = { error: UNKNOWN_SAVE, uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setSnapshot(result.snapshot); setAssets({ video: result.snapshot.video, shortclip: result.snapshot.shortclip }); setMessage('저장했습니다. 상품상세에 적용되었습니다.'); setError(false); setUncertain(false); request.current = null; }
  }
  /* 저장 버튼은 네이티브 button에 kit 버튼 모양을 입힌다 — 화면 전송 실패 재시도 테스트(PresentationTransportFailure)가
     전시 설정 화면들과 함께 네이티브 제출 버튼을 찾는다. 모양·동작은 kit Button과 같다. */
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-media">
    <Link className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(initial.goodId)}`}>← 상품 수정으로</Link>
    {/* 읽지 못한 화면(unavailable)의 상품명은 내부 번호로 채워져 있어 보이지 않는다. */}
    <AdminPageHeader title="상품 동영상·숏클립" description={initial.unavailable ? undefined : [initial.goodName, goodCode].filter(Boolean).join(' · ')} />
    <p className="text-sm text-muted-foreground">영상을 확인한 뒤 저장하면 상품상세 갤러리에 표시됩니다. 첫 화면은 <Link className="text-foreground underline underline-offset-4" href={GOODS_MEDIA_SETTINGS_PATH}>대표미디어 전시 설정</Link>을 따릅니다.</p>
    {initial.unavailable ? <p className="text-sm text-destructive" role="alert">현재 영상 구성을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title="영상 구성">
        <fieldset disabled={disabled} className="grid min-w-0 gap-6 lg:grid-cols-2">
          {GOODS_MEDIA_KINDS.map(kind => <div className="flex min-w-0 flex-col gap-4" key={kind}>
            <GoodsMediaUploadField kind={kind} asset={assets[kind]} disabled={disabled} onAsset={asset => choose(kind, asset)} onBusy={value => setBusy(current => ({ ...current, [kind]: value }))} />
            {assets[kind] ? <label className="flex flex-col gap-2 text-sm font-medium">{KIND_LABEL[kind]} 제목<Input value={assets[kind].title} required maxLength={20} onChange={event => setAssets(current => ({ ...current, [kind]: current[kind] ? { ...current[kind], title: event.target.value } : null }))} /><small className="text-xs font-normal text-muted-foreground tabular-nums">{Array.from(assets[kind].title).length}/20</small></label> : null}
          </div>)}
        </fieldset>
      </AdminSectionCard>
      <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border bg-card p-4">{message ? <p className={`text-sm${error ? ' text-destructive' : ' text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<button className={buttonVariants()} data-slot="button" type="submit" disabled={pending || busy.video || busy.shortclip || Boolean(initial.unavailable)}>{pending ? '저장 중…' : uncertain ? '저장됐는지 확인' : '영상 구성 저장'}</button></div>
    </form>
  </section>;
}
