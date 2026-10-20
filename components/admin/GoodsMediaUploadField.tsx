'use client';
import { useRef, useState } from 'react';
import { cancelGoodsMediaAction, verifyGoodsMediaAction } from '@/app/admin/goods-media-actions';
import { uploadGoodsMedia } from '@/lib/admin/goods-media-upload.client';
import { GOODS_MEDIA_ACCEPT, GOODS_MEDIA_GUIDANCE, validGoodsMediaUpload, type GoodsMediaAsset, type GoodsMediaKind } from '@/lib/goods-media';
import { GoodsVideoPlayer } from '@/components/shop/GoodsVideoPlayer';

export function GoodsMediaUploadField({ kind, asset, disabled, onAsset, onBusy }: {
  kind: GoodsMediaKind; asset: GoodsMediaAsset | null; disabled: boolean;
  onAsset: (asset: GoodsMediaAsset | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [uncertainId, setUncertainId] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null), label = kind === 'video' ? '동영상' : '숏클립';
  async function upload(retry = false) {
    if (pending || disabled || (!retry && !file)) return;
    setPending(true); setMessage(''); onBusy(true);
    try {
      const result = retry && uncertainId ? { ...await verifyGoodsMediaAction(uncertainId), uploadId: uncertainId } : await uploadGoodsMedia(kind, file!);
      if (result.ok) { onAsset(result.asset); setFile(null); setUncertainId(null); setMessage('파일 확인을 마쳤습니다. 저장하면 상품에 적용됩니다.'); if (field.current) field.current.value = ''; onBusy(false); }
      else { setMessage(result.error); const uncertain = result.uncertain && result.uploadId ? result.uploadId : null; setUncertainId(uncertain); onBusy(Boolean(uncertain)); }
    } catch { setMessage('업로드 결과를 확인하지 못했습니다. 다시 확인해주세요.'); onBusy(Boolean(uncertainId)); }
    finally { setPending(false); }
  }
  async function cancelUncertain() {
    if (!uncertainId || pending || disabled) return;
    setPending(true);
    try { await cancelGoodsMediaAction(uncertainId); setUncertainId(null); setFile(null); if (field.current) field.current.value = ''; onBusy(false); setMessage('업로드 연결을 취소했습니다. 기존 저장 영상은 유지됩니다.'); }
    catch { setMessage('취소 결과를 확인하지 못했습니다. 다시 확인해주세요.'); }
    finally { setPending(false); }
  }
  return <section className="admin-goods-media__upload" aria-labelledby={`goods-media-${kind}-heading`}>
    <h3 id={`goods-media-${kind}-heading`}>{label}</h3>
    <p>{GOODS_MEDIA_GUIDANCE}</p>
    {asset ? <><GoodsVideoPlayer key={asset.id} asset={asset} /><p>{asset.width} × {asset.height}px · {(asset.durationMs / 1000).toFixed(1)}초 · {(asset.byteSize / 1024 / 1024).toFixed(2)}MB</p></> : <div className="admin-goods-media__empty">등록된 {label}이 없습니다.</div>}
    <label htmlFor={`goods-media-${kind}-file`}>{label} 파일<input ref={field} id={`goods-media-${kind}-file`} type="file" accept={GOODS_MEDIA_ACCEPT} disabled={disabled || pending || Boolean(uncertainId)}
      onChange={event => { const value = event.target.files?.[0] ?? null; setFile(value); setMessage(value && !validGoodsMediaUpload({ kind, mimeType: value.type, size: value.size }) ? 'MP4 50MB 이하 파일을 선택해주세요.' : ''); }} /></label>
    <div className="admin-goods-media__upload-actions">
      <button type="button" className="wc-admin-kit__button" disabled={disabled || pending || (!uncertainId && (!file || !validGoodsMediaUpload({ kind, mimeType: file.type, size: file.size })))} onClick={() => void upload(Boolean(uncertainId))}>{pending ? '영상 확인 중…' : uncertainId ? '같은 업로드 결과 확인' : '파일 업로드·확인'}</button>
      {uncertainId ? <button type="button" className="wc-admin-kit__button" disabled={disabled || pending} onClick={() => void cancelUncertain()}>업로드 취소</button> : asset ? <button type="button" className="wc-admin-kit__button" disabled={disabled || pending} onClick={() => { onAsset(null); setMessage('저장하면 이 상품의 영상 연결을 해제합니다.'); }}>영상 연결 해제</button> : null}
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
