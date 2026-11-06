'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { safeShoppingStoryLink } from '@/lib/shopping-stories-content';
import { CONTENT_DIVIDER_STYLES, CONTENT_FONT_SIZES, CONTENT_QUOTE_STYLES, type ContentDividerStyle, type ContentQuoteStyle } from '@/lib/content-format';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { planStoryEditorFormat, planStoryEditorInsertion, renderStoryEditorHtml, restoreStoryEditorSelection, storyEditorHtml, storyEditorRange, storyEditorReplacement, storyEditorSelectedHtml } from '@/lib/admin/shopping-story-editor-dom';
import type { BodyTemplateEditorTarget } from '@/lib/admin/body-templates';
import { BodyTemplateTools } from './BodyTemplateTools';
import { ArtworkUploadField } from './ArtworkUploadField';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/* 쇼핑스토리 본문 편집기(템플릿 룩, ADR-0028). 서식 도구 막대는 kit 버튼·선택, 입력면은 공개 본문(.wc-shopping-story__body) 모양 그대로다. */
const TOOLBAR = 'flex flex-wrap items-end gap-1.5 p-2.5';
const TOOL_LABEL = 'flex flex-col gap-1 text-[11px] font-medium text-muted-foreground';
const FIELD = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium';
const DISCLOSURE = 'rounded-lg border px-4 py-3 text-sm [&[open]>summary]:mb-4';

function escape(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
export function ShoppingStoryBodyEditor({ accountId, value, onChange, disabled }: { accountId: string; value: string; onChange: (html: string) => void; disabled: boolean }) {
  const editor = useRef<HTMLDivElement>(null), lastValue = useRef(''), remembered = useRef<Range | null>(null);
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const status = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const blocked = disabled || !status.ready || status.blocked;
  const [source, setSource] = useState(''), [link, setLink] = useState(''), [path, setPath] = useState(''), [alt, setAlt] = useState(''), [warning, setWarning] = useState('');
  const [quote, setQuote] = useState<ContentQuoteStyle>('line'), [divider, setDivider] = useState<ContentDividerStyle>('line');
  const [uploadKey, setUploadKey] = useState(0);
  useLayoutEffect(() => { scope.setEnabled(!disabled); }, [scope, disabled]);
  useEffect(() => {
    scope.activate(); const signOut = () => scope.authenticate(null, null); window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => scope.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null)).data.subscription : null;
    return () => { scope.dispose(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [scope]);
  useEffect(() => { if (editor.current && value !== lastValue.current) { editor.current.innerHTML = renderStoryEditorHtml(value); lastValue.current = value; remembered.current = null; scope.invalidate(); } }, [value, scope]);
  function remember() { if (editor.current) remembered.current = storyEditorRange(editor.current, remembered.current); }
  function readEditor() {
    if (!editor.current || blocked) return;
    const html = storyEditorHtml(editor.current); lastValue.current = html; onChange(html); remember();
  }
  function commit(result: ReturnType<typeof storyEditorReplacement>) {
    if (!result.ok) { setWarning(result.error); return result; }
    if (!editor.current) return { ok: false as const, error: '본문 입력창을 다시 확인해주세요.' };
    editor.current.innerHTML = renderStoryEditorHtml(result.html); lastValue.current = result.html; onChange(result.html);
    editor.current.focus(); remembered.current = result.selection ? restoreStoryEditorSelection(editor.current, result.selection) : storyEditorRange(editor.current);
    setWarning(result.warnings.join(' ')); return { ok: true as const, bodyHtml: result.html };
  }
  function insert(html: string) {
    if (blocked || !editor.current || !scope.capture()) return false;
    return commit(planStoryEditorInsertion(editor.current, storyEditorRange(editor.current, remembered.current), html)).ok;
  }
  function format(operation: Parameters<typeof planStoryEditorFormat>[2]) {
    if (blocked || !editor.current || !scope.capture()) return;
    commit(planStoryEditorFormat(editor.current, storyEditorRange(editor.current, remembered.current), operation));
  }
  function captureEditor(): BodyTemplateEditorTarget | null {
    const node = editor.current, ticket = scope.capture(); if (!node || !ticket || blocked) return null;
    const bodyHtml = storyEditorHtml(node), dom = node.innerHTML, range = storyEditorRange(node, remembered.current);
    return { bodyHtml, apply(html, mode) {
      if (!scope.canApply(ticket) || editor.current !== node || !node.isConnected || !node.isContentEditable || node.innerHTML !== dom || storyEditorHtml(node) !== bodyHtml)
        return { ok: false, error: '본문이나 로그인 상태가 바뀌었습니다. 현재 내용을 유지했으니 템플릿을 다시 열어주세요.' };
      return commit(mode === 'replace' ? storyEditorReplacement(html) : planStoryEditorInsertion(node, range, html));
    } };
  }
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-col divide-y rounded-lg border bg-muted/40">
      <div className={TOOLBAR} aria-label="본문 서식">
        {([['h2', '제목'], ['p', '문단']] as const).map(([tag, label]) => <Button disabled={blocked} key={tag} type="button" onMouseDown={event => event.preventDefault()} onClick={() => format({ tag })} size="sm" variant="outline">{label}</Button>)}
        {([['strong', '굵게'], ['em', '기울임'], ['u', '밑줄'], ['s', '취소선']] as const).map(([emphasis, label]) => <Button disabled={blocked} key={emphasis} type="button" onMouseDown={event => event.preventDefault()} onClick={() => format({ emphasis })} size="sm" variant="outline">{label}</Button>)}
        <label className={TOOL_LABEL}>정렬<NativeSelect aria-label="본문 정렬" defaultValue="" disabled={blocked} onPointerDown={remember} onChange={event => { format({ attribute: 'data-icons-align', value: event.target.value }); event.target.value = ''; }} size="sm"><option value="" disabled>선택</option><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></NativeSelect></label>
        <label className={TOOL_LABEL}>글자 크기<NativeSelect aria-label="본문 글자 크기" defaultValue="" disabled={blocked} onPointerDown={remember} onChange={event => { format({ attribute: 'data-icons-size', value: event.target.value }); event.target.value = ''; }} size="sm"><option value="" disabled>선택</option>{CONTENT_FONT_SIZES.map(size => <option key={size} value={size}>{size}px</option>)}</NativeSelect></label>
        <Button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert('<ul><li>목록 항목</li></ul>')} size="sm" variant="outline">목록</Button>
        <Button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert('<table><tbody><tr><th>항목</th><th>내용</th></tr><tr><td>항목</td><td>내용</td></tr></tbody></table>')} size="sm" variant="outline">표</Button>
      </div>
      <div className={TOOLBAR}>
        <label className={TOOL_LABEL}>인용 모양<NativeSelect disabled={blocked} value={quote} onPointerDown={remember} onChange={event => setQuote(event.target.value as ContentQuoteStyle)} size="sm">{CONTENT_QUOTE_STYLES.map((style, index) => <option key={style} value={style}>{['세로선', '따옴표', '말풍선', '메모', '모서리'][index]}</option>)}</NativeSelect></label>
        <Button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => { const selected = editor.current ? storyEditorSelectedHtml(editor.current, storyEditorRange(editor.current, remembered.current)) : ''; insert(`<blockquote data-icons-quote="${quote}">${selected || '인용할 내용'}</blockquote>`); }} size="sm" variant="outline">인용 넣기</Button>
        <label className={TOOL_LABEL}>구분선 모양<NativeSelect disabled={blocked} value={divider} onPointerDown={remember} onChange={event => setDivider(event.target.value as ContentDividerStyle)} size="sm">{CONTENT_DIVIDER_STYLES.map((style, index) => <option key={style} value={style}>{['긴 선', '짧은 선', '굵은 선', '꺾쇠', '다이아몬드', '점선', '사선', '세로선'][index]}</option>)}</NativeSelect></label>
        <Button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert(`<hr data-icons-divider="${divider}">`)} size="sm" variant="outline">구분선 넣기</Button>
      </div>
    </div>
    <BodyTemplateTools accountId={accountId} surface="story" disabled={blocked} captureEditor={captureEditor} />
    <div ref={editor} role="textbox" aria-label="스토리 본문" aria-multiline="true" contentEditable={!blocked} suppressContentEditableWarning className="wc-shopping-story__body max-h-[650px] min-h-80 overflow-y-auto rounded-lg border bg-background p-5 font-normal outline-none [overflow-wrap:anywhere] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" onInput={readEditor} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
      onDrop={event => { event.preventDefault(); insert(event.dataTransfer.getData('text/html') || `<p>${escape(event.dataTransfer.getData('text/plain'))}</p>`); }}
      onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData('text/html') || `<p>${escape(event.clipboardData.getData('text/plain')).replaceAll('\n', '<br>')}</p>`); }} />
    <div className="flex flex-wrap items-end gap-2.5"><label className={`${FIELD} flex-1`}>스토어 내부 링크<Input value={link} onChange={event => setLink(event.target.value)} placeholder="/shop/상품코드 또는 /stories/..." disabled={blocked} /></label><Button type="button" disabled={blocked || !safeShoppingStoryLink(link)} onClick={() => { if (insert(`<p><a href="${escape(link)}">${escape(link)}</a></p>`)) setLink(''); }} variant="outline">링크 넣기</Button></div>
    <details className={DISCLOSURE}><summary className="cursor-pointer font-medium">이미지 넣기</summary><div className="flex flex-col gap-3"><ArtworkUploadField key={uploadKey} kind="curation" currentPath={null} currentUrl={null} fieldId={`story-image-${uploadKey}`} name="storyImage" label="본문 이미지" showCropGuide={false} showPath={false} onPathChange={setPath} />
      <label className={FIELD}>이미지 설명<Input value={alt} disabled={blocked} onChange={event => setAlt(event.target.value)} maxLength={200} /></label>
      <Button className="self-start" type="button" disabled={blocked || !path} onClick={() => { if (insert(`<figure><img src="${path}" alt="${escape(alt)}"></figure>`)) { setPath(''); setAlt(''); setUploadKey(key => key + 1); } }} variant="outline">업로드한 이미지 본문에 넣기</Button>
    </div></details>
    <details className={DISCLOSURE}><summary className="cursor-pointer font-medium">HTML 가져오기</summary><div className="flex flex-col gap-3"><label className={FIELD}>붙여넣을 HTML<Textarea className="font-mono text-xs" value={source} onChange={event => setSource(event.target.value)} disabled={blocked} rows={5} /></label><Button className="self-start" type="button" disabled={blocked || !source} onClick={() => { if (insert(source)) setSource(''); }} variant="outline">정리해서 본문에 넣기</Button></div></details>
    {warning ? <p className="text-xs text-[var(--wc-warning)]" role="status">{warning}</p> : null}<p className="text-xs leading-relaxed text-muted-foreground">정렬·크기는 커서가 있는 문단이나 선택한 문단에 적용됩니다. 굵게·기울임·밑줄·취소선은 선택한 글에 적용됩니다. 외부 링크·외부 이미지·스크립트는 제거됩니다. 본문 30,000자, 이미지 20장까지 등록할 수 있습니다.</p>
  </div>;
}
