'use client';
import { useId, useState } from 'react';
import { parseGoodUrl } from '@/lib/admin/good-url';

export type GoodUrlAddResult = { ok: boolean; message: string };

/**
 * 전시 상품 선택기의 "URL로 추가". 주소에서 상품 ID를 꺼낸 뒤 선택기마다 다른 조회·추가 규칙(`onAdd`)에 넘긴다.
 * 선택기 안의 검색 폼과 섞이지 않게 Enter는 이 칸에서만 처리한다.
 */
export function GoodUrlAddField({ onAdd, disabled = false }: { onAdd: (id: string) => GoodUrlAddResult | Promise<GoodUrlAddResult>; disabled?: boolean }) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GoodUrlAddResult | null>(null);
  async function add() {
    if (pending || disabled) return;
    const parsed = parseGoodUrl(value, typeof window === 'undefined' ? null : window.location.host);
    if (!parsed.ok) { setResult({ ok: false, message: parsed.error }); return; }
    setPending(true);
    try {
      const next = await onAdd(parsed.id);
      setResult(next);
      if (next.ok) setValue('');
    } catch { setResult({ ok: false, message: '상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
    finally { setPending(false); }
  }
  return <div className="admin-good-url-add">
    <label htmlFor={inputId}>상품 URL로 추가</label>
    <div className="admin-good-url-add__row">
      <input id={inputId} value={value} maxLength={500} inputMode="url" placeholder="https://iconsip.com/shop/상품ID 또는 /shop/상품ID" disabled={disabled || pending}
        onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} />
      <button type="button" disabled={disabled || pending || !value.trim()} onClick={() => void add()}>{pending ? '확인 중…' : 'URL로 추가'}</button>
    </div>
    {result ? <p className={result.ok ? 'admin-good-url-add__status' : 'admin-good-url-add__error'} role={result.ok ? 'status' : 'alert'}>{result.message}</p> : null}
  </div>;
}
