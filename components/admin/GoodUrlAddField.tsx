'use client';
import { useId, useState } from 'react';
import { parseGoodUrl } from '@/lib/admin/good-url';
import { Button } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

export type GoodUrlAddResult = { ok: boolean; message: string };

/**
 * 전시 상품 선택기의 "URL로 추가". 주소에서 상품 ID를 꺼낸 뒤 선택기마다 다른 조회·추가 규칙(`onAdd`)에 넘긴다.
 * 선택기 안의 검색 폼과 섞이지 않게 Enter는 이 칸에서만 처리한다(버튼도 type="button"이라 폼을 제출하지 않는다).
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
  return <div className="my-3 flex min-w-0 flex-col gap-2" data-good-url-add="">
    <label className="text-sm leading-snug font-medium text-foreground" htmlFor={inputId}>상품 URL로 추가</label>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input className={`${GOOD_INPUT_CLASS} flex-1 basis-60`} data-slot="input" id={inputId} value={value} maxLength={500} inputMode="url" placeholder="https://iconsip.com/shop/상품ID 또는 /shop/상품ID" disabled={disabled || pending}
        onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} />
      <Button type="button" variant="outline" disabled={disabled || pending || !value.trim()} onClick={() => void add()}>{pending ? '확인 중…' : 'URL로 추가'}</Button>
    </div>
    {result ? <p className={result.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'} role={result.ok ? 'status' : 'alert'}>{result.message}</p> : null}
  </div>;
}
