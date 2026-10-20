'use client';

import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createGoodsDescriptionToolScope, goodsDescriptionToolFragment, planGoodsDescriptionInsertion, type GoodsDescriptionTool, type GoodsDescriptionToolTicket } from '@/lib/admin/goods-description-tools';
import { GOODS_HTML_MAX_LENGTH, sanitizeGoodsDescription } from '@/lib/goods-description';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { BodyTemplateTools } from './BodyTemplateTools';
import type { BodyTemplateEditorTarget } from '@/lib/admin/body-templates';
import { CONTENT_ALIGNMENTS, CONTENT_DIVIDER_STYLES, CONTENT_FONT_SIZES, CONTENT_QUOTE_STYLES, type ContentAlignment, type ContentDividerStyle, type ContentFontSize, type ContentQuoteStyle } from '@/lib/content-format';

type Target = { ticket: GoodsDescriptionToolTicket; form: HTMLFormElement; input: HTMLTextAreaElement; source: string; start: number; end: number };
type Dialog = { kind: 'quote' | 'link' | 'text'; target: Target; initialText: string };
const QUOTE_LABELS: Record<ContentQuoteStyle, string> = { line: '왼쪽 선', quotes: '따옴표', bubble: '말풍선', note: '메모', frame: '모서리' };
const DIVIDER_LABELS: Record<ContentDividerStyle, string> = { line: '긴 선', short: '짧은 선', bold: '굵은 선', chevron: '꺾인 선', diamond: '마름모', dots: '점선', slash: '사선', vertical: '세로선' };

export function GoodsDescriptionTools({ accountId, formRef, disabled }: {
  accountId: string; formRef: RefObject<HTMLFormElement | null>; disabled: boolean;
}) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [dialog, setDialog] = useState<Dialog | null>(null), [message, setMessage] = useState('');
  const [dividerStyle, setDividerStyle] = useState<ContentDividerStyle>('line');
  useLayoutEffect(() => { scope.setEnabled(!disabled); }, [scope, disabled]);
  useEffect(() => {
    scope.activate();
    const form = formRef.current, signOut = () => scope.authenticate(null, null);
    form?.addEventListener('reset', scope.invalidate); form?.addEventListener('submit', scope.invalidate);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => {
      scope.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    }).data.subscription : null;
    return () => {
      scope.dispose(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
      form?.removeEventListener('reset', scope.invalidate); form?.removeEventListener('submit', scope.invalidate);
    };
  }, [scope, formRef]);
  const blocked = disabled || !snapshot.ready || snapshot.blocked;
  function capture(): Target | null {
    const ticket = scope.capture(), form = formRef.current, input = form?.elements.namedItem('description');
    const format = form?.elements.namedItem('descriptionFormat');
    if (!ticket || !form || !(input instanceof HTMLTextAreaElement) || input.disabled || input.readOnly
      || !(format instanceof HTMLSelectElement) || format.value !== 'html') return null;
    return { ticket, form, input, source: input.value, start: input.selectionStart, end: input.selectionEnd };
  }
  function targetError(target: Target): string | null {
    const format = target.form.elements.namedItem('descriptionFormat');
    if (!scope.canApply(target.ticket) || formRef.current !== target.form || !target.input.isConnected
      || target.input.form !== target.form || target.form.elements.namedItem('description') !== target.input
      || target.input.disabled || target.input.readOnly || target.input.value !== target.source
      || !(format instanceof HTMLSelectElement) || format.value !== 'html')
      return '상품 입력이나 로그인 상태가 바뀌었습니다. 창을 닫고 다시 열어주세요. 기존 내용은 유지됩니다.';
    return null;
  }
  function apply(target: Target, tool: GoodsDescriptionTool): string | null {
    const stale = targetError(target);
    if (stale) return stale;
    const fragment = goodsDescriptionToolFragment(tool);
    if (!fragment.ok) return fragment.error;
    const result = planGoodsDescriptionInsertion(target.source, target.start, target.end, fragment.value);
    if (!result.ok) return result.error;
    target.input.setRangeText(fragment.value, target.start, target.end, 'end');
    target.input.dispatchEvent(new Event('input', { bubbles: true }));
    setMessage('상세설명에 넣었습니다. 상품을 저장하면 반영됩니다.');
    return null;
  }
  function captureBodyTemplate(): BodyTemplateEditorTarget | null {
    const target = capture();
    if (!target) return null;
    return { bodyHtml: target.source, apply(html, mode) {
      const stale = targetError(target);
      if (stale) return { ok: false, error: stale };
      // The shared tool normalizes new templates. Keeping the supplied source
      // exact also lets its guarded undo restore the editor's original HTML,
      // including this product's own images and unsubmitted source formatting.
      const result = mode === 'insert'
        ? planGoodsDescriptionInsertion(target.source, target.start, target.end, html)
        : planGoodsDescriptionInsertion('', 0, 0, html);
      if (!result.ok) return result;
      target.input.setRangeText(html, mode === 'insert' ? target.start : 0, mode === 'insert' ? target.end : target.source.length, 'end');
      target.input.dispatchEvent(new Event('input', { bubbles: true }));
      setMessage('상세설명 입력을 바꿨습니다. 상품을 저장하면 반영됩니다.');
      return { ok: true, bodyHtml: target.input.value };
    } };
  }
  function open(kind: Dialog['kind']) {
    const target = capture();
    if (!target) return;
    let initialText = '';
    if (kind === 'text' && target.start !== target.end) {
      const template = document.createElement('template');
      template.innerHTML = sanitizeGoodsDescription(target.source.slice(target.start, target.end)).html;
      // Template content is inert; only text is copied into the plain text input.
      template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
      template.content.querySelectorAll('p,div,h1,h2,h3,h4,li,blockquote').forEach(node => node.after('\n'));
      initialText = template.content.textContent?.trim() ?? '';
    }
    setDialog({ kind, target, initialText }); setMessage('');
  }
  function close(current: Dialog) {
    if (scope.canApply(current.target.ticket)) scope.invalidate();
    setDialog(value => value === current ? null : value);
  }
  const active = dialog && !blocked && dialog.target.ticket.epoch === snapshot.epoch ? dialog : null;
  return <>
    <div className="row admin-goods-description-tools" aria-label="상세설명 추가 도구">
      <button className="btn btn-ghost" type="button" disabled={blocked} onClick={() => open('text')}>글자 서식</button>
      <button className="btn btn-ghost" type="button" disabled={blocked} onClick={() => open('quote')}>인용 넣기</button>
      <label>구분선 모양<select className="admin-field-control" disabled={blocked} value={dividerStyle} onInput={event => event.stopPropagation()}
        onChange={event => { event.stopPropagation(); setDividerStyle(event.target.value as ContentDividerStyle); }}>
        {CONTENT_DIVIDER_STYLES.map(style => <option key={style} value={style}>{DIVIDER_LABELS[style]}</option>)}
      </select></label>
      <button className="btn btn-ghost" type="button" disabled={blocked} onClick={() => {
        const target = capture(); if (!target) return;
        const error = apply(target, { kind: 'divider', ...(dividerStyle === 'line' ? {} : { style: dividerStyle }) });
        if (error) setMessage(error); else target.input.focus();
      }}>구분선 넣기</button>
      <button className="btn btn-ghost" type="button" disabled={blocked} onClick={() => open('link')}>링크 넣기</button>
      <BodyTemplateTools accountId={accountId} surface="goods" disabled={blocked} captureEditor={captureBodyTemplate} insertLabel="선택 위치에 넣기" />
    </div>
    {snapshot.blocked ? <p role="status">로그인 상태가 바뀌었습니다. 페이지를 새로 열어주세요.</p> : message ? <p role="status">{message}</p> : null}
    {active && typeof document !== 'undefined' ? createPortal(<div className="wc-root wc-admin admin-goods-description-dialog"
      onInput={event => event.stopPropagation()} onChange={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onSubmit={event => { event.preventDefault(); event.stopPropagation(); }}>
      <DescriptionToolDialog key={active.kind} kind={active.kind} initialText={active.initialText} onClose={() => close(active)} onApply={tool => apply(active.target, tool)} />
    </div>, document.body) : null}
  </>;
}

function DescriptionToolDialog({ kind, initialText, onClose, onApply }: { kind: Dialog['kind']; initialText: string; onClose: () => void; onApply: (tool: GoodsDescriptionTool) => string | null }) {
  const [text, setText] = useState(initialText), [href, setHref] = useState(''), [error, setError] = useState('');
  const [quoteStyle, setQuoteStyle] = useState<ContentQuoteStyle>('line'), [alignment, setAlignment] = useState<ContentAlignment>('left');
  const [size, setSize] = useState<ContentFontSize>('16'), [emphasis, setEmphasis] = useState<('strong' | 'em' | 'u' | 's')[]>([]);
  const preview = kind === 'quote' ? goodsDescriptionToolFragment({ kind, text, style: quoteStyle })
    : kind === 'text' ? goodsDescriptionToolFragment({ kind, text, alignment, size, emphasis }) : null;
  function submit() {
    const failure = onApply(kind === 'quote' ? { kind, text, style: quoteStyle }
      : kind === 'text' ? { kind, text, alignment, size, emphasis } : { kind, text, href });
    if (failure) setError(failure); else onClose();
  }
  return <CustomerServiceDialog title={kind === 'quote' ? '상세설명에 인용 넣기' : kind === 'text' ? '상세설명 글자 서식' : '상세설명에 링크 넣기'} onClose={onClose}>
    <div className="admin-goods-description-dialog__form" onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
        event.preventDefault(); event.stopPropagation(); submit();
      }
    }}>
      <p>입력한 내용을 선택한 부분에 넣습니다. 선택한 글이 있으면 바뀝니다. 상품 저장 후 공개 화면에 반영됩니다.</p>
      {kind !== 'link' ? <><label>{kind === 'quote' ? '인용할 내용' : '서식을 적용할 내용'}<textarea className="admin-field-control" rows={5} value={text} maxLength={GOODS_HTML_MAX_LENGTH}
        onChange={event => { setText(event.target.value); setError(''); }} /></label>
        {kind === 'quote' ? <label>인용 모양<select className="admin-field-control" value={quoteStyle} onChange={event => setQuoteStyle(event.target.value as ContentQuoteStyle)}>
          {CONTENT_QUOTE_STYLES.map(style => <option key={style} value={style}>{QUOTE_LABELS[style]}</option>)}
        </select></label> : <>
          <p>선택한 HTML에서 글자만 가져옵니다. 이 창의 내용은 한 문단으로 넣으며 기존 선택 영역의 이미지·태그는 바뀝니다.</p>
          <div className="row"><label>정렬<select className="admin-field-control" value={alignment} onChange={event => setAlignment(event.target.value as ContentAlignment)}>
            {CONTENT_ALIGNMENTS.map(align => <option key={align} value={align}>{{ left: '왼쪽', center: '가운데', right: '오른쪽' }[align]}</option>)}
          </select></label><label>글자 크기<select className="admin-field-control" value={size} onChange={event => setSize(event.target.value as ContentFontSize)}>
            {CONTENT_FONT_SIZES.map(value => <option key={value} value={value}>{value}px</option>)}
          </select></label></div>
          <div className="row" role="group" aria-label="글자 강조">
            {([['strong', '굵게'], ['em', '기울임'], ['u', '밑줄'], ['s', '취소선']] as const).map(([tag, label]) => <button className="btn btn-ghost" type="button" key={tag} aria-pressed={emphasis.includes(tag)}
              onClick={() => setEmphasis(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])}>{label}</button>)}
          </div>
        </>}
      </>
        : <><label>링크 문구<input className="admin-field-control" value={text} maxLength={GOODS_HTML_MAX_LENGTH} onChange={event => { setText(event.target.value); setError(''); }} /></label>
          <label>링크 주소<input className="admin-field-control" value={href} maxLength={GOODS_HTML_MAX_LENGTH} placeholder="https://example.com 또는 /shop"
            onChange={event => { setHref(event.target.value); setError(''); }} /></label>
          <p>https·http·mailto·tel 주소 또는 /로 시작하는 내부 경로를 사용할 수 있습니다.</p></>}
      {error ? <p role="alert">{error}</p> : null}
      {preview?.ok ? <div aria-label="서식 미리보기" className="admin-goods-description-dialog__preview wc-goods-description" dangerouslySetInnerHTML={{ __html: sanitizeGoodsDescription(preview.value).html }} /> : null}
      <div className="row"><button type="button" className="btn btn-primary" onClick={submit}>상세설명에 넣기</button><button type="button" className="btn btn-ghost" onClick={onClose}>취소</button></div>
    </div>
  </CustomerServiceDialog>;
}
