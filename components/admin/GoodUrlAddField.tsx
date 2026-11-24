'use client';
import { useId, useState } from 'react';
import { parseGoodUrl } from '@/lib/admin/good-url';
import { resolveGoodReferencesAction } from '@/app/admin/good-reference-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';
import { GoodBulkAddPanel, type GoodBulkAddOptions } from './GoodBulkAddPanel';

export type GoodUrlAddResult = { ok: boolean; message: string };

/**
 * 고객 화면 주소 끝 값은 상품 자동코드(소문자, 2026-11-25~)이거나 예전 상품 URL이다(ADR-0050). 선택기는 상품 URL로 고르므로
 * 여러 줄 추가와 같은 조회(admin_resolve_goods_references — 상품 URL·상품 자동코드)로 상품 URL을 먼저 찾는다.
 * 찾지 못하거나 확인에 실패하면 받은 값 그대로 넘긴다 — 선택기가 자기 규칙으로 다시 찾고 없으면 '찾지 못했습니다'를 알린다.
 */
async function goodIdForAddress(segment: string): Promise<string> {
  try {
    const resolved = await resolveGoodReferencesAction([segment]);
    const match = resolved.ok ? resolved.matches.find(item => item.ref === segment) : undefined;
    return match?.status === 'found' && match.id ? match.id : segment;
  } catch {
    return segment;
  }
}

/**
 * 전시 상품 선택기의 "URL로 추가". 주소 끝 값을 상품 URL로 바꾼 뒤 선택기마다 다른 조회·추가 규칙(`onAdd`)에 넘긴다.
 * 선택기 안의 검색 폼과 섞이지 않게 Enter는 이 칸에서만 처리한다(버튼도 type="button"이라 폼을 제출하지 않는다).
 * `bulk`를 주면 바로 아래에 '여러 줄 붙여넣기 · 엑셀로 추가(한 열)'를 함께 둔다(1014-112).
 */
export function GoodUrlAddField<T = never>({ onAdd, disabled = false, bulk }: {
  onAdd: (id: string) => GoodUrlAddResult | Promise<GoodUrlAddResult>; disabled?: boolean; bulk?: GoodBulkAddOptions<T>;
}) {
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
      const next = await onAdd(await goodIdForAddress(parsed.id));
      setResult(next);
      if (next.ok) setValue('');
    } catch { setResult({ ok: false, message: '상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
    finally { setPending(false); }
  }
  return <div className="my-3 flex min-w-0 flex-col gap-2" data-good-url-add="">
    <label className="text-sm leading-snug font-medium text-foreground" htmlFor={inputId}>상품 URL로 추가</label>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input className={`${GOOD_INPUT_CLASS} flex-1 basis-60`} data-slot="input" id={inputId} value={value} maxLength={500} inputMode="url" placeholder="https://iconsip.com/shop/hsq-0059 또는 /shop/hsq-0059" disabled={disabled || pending}
        onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} />
      <Button type="button" variant="outline" disabled={disabled || pending || !value.trim()} onClick={() => void add()}>{pending ? '확인 중…' : 'URL로 추가'}</Button>
    </div>
    {result ? <p className={result.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'} role={result.ok ? 'status' : 'alert'}>{result.message}</p> : null}
    {bulk ? <GoodBulkAddPanel disabled={disabled} options={bulk} /> : null}
  </div>;
}
