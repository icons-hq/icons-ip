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
  return <div className="admin-story-body-editor">
    <div className="admin-story-body-editor__toolbar" aria-label="본문 서식">
      {([['h2', '제목'], ['p', '문단']] as const).map(([tag, label]) => <button disabled={blocked} key={tag} type="button" onMouseDown={event => event.preventDefault()} onClick={() => format({ tag })}>{label}</button>)}
      {([['strong', '굵게'], ['em', '기울임'], ['u', '밑줄'], ['s', '취소선']] as const).map(([emphasis, label]) => <button disabled={blocked} key={emphasis} type="button" onMouseDown={event => event.preventDefault()} onClick={() => format({ emphasis })}>{label}</button>)}
      <label>정렬<select aria-label="본문 정렬" defaultValue="" disabled={blocked} onPointerDown={remember} onChange={event => { format({ attribute: 'data-icons-align', value: event.target.value }); event.target.value = ''; }}><option value="" disabled>선택</option><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
      <label>글자 크기<select aria-label="본문 글자 크기" defaultValue="" disabled={blocked} onPointerDown={remember} onChange={event => { format({ attribute: 'data-icons-size', value: event.target.value }); event.target.value = ''; }}><option value="" disabled>선택</option>{CONTENT_FONT_SIZES.map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
      <button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert('<ul><li>목록 항목</li></ul>')}>목록</button>
      <button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert('<table><tbody><tr><th>항목</th><th>내용</th></tr><tr><td>항목</td><td>내용</td></tr></tbody></table>')}>표</button>
    </div>
    <div className="admin-story-body-editor__toolbar">
      <label>인용 모양<select disabled={blocked} value={quote} onPointerDown={remember} onChange={event => setQuote(event.target.value as ContentQuoteStyle)}>{CONTENT_QUOTE_STYLES.map((style, index) => <option key={style} value={style}>{['세로선', '따옴표', '말풍선', '메모', '모서리'][index]}</option>)}</select></label>
      <button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => { const selected = editor.current ? storyEditorSelectedHtml(editor.current, storyEditorRange(editor.current, remembered.current)) : ''; insert(`<blockquote data-icons-quote="${quote}">${selected || '인용할 내용'}</blockquote>`); }}>인용 넣기</button>
      <label>구분선 모양<select disabled={blocked} value={divider} onPointerDown={remember} onChange={event => setDivider(event.target.value as ContentDividerStyle)}>{CONTENT_DIVIDER_STYLES.map((style, index) => <option key={style} value={style}>{['긴 선', '짧은 선', '굵은 선', '꺾쇠', '다이아몬드', '점선', '사선', '세로선'][index]}</option>)}</select></label>
      <button disabled={blocked} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insert(`<hr data-icons-divider="${divider}">`)}>구분선 넣기</button>
    </div>
    <BodyTemplateTools accountId={accountId} surface="story" disabled={blocked} captureEditor={captureEditor} />
    <div ref={editor} role="textbox" aria-label="스토리 본문" aria-multiline="true" contentEditable={!blocked} suppressContentEditableWarning className="admin-story-body-editor__surface wc-shopping-story__body" onInput={readEditor} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
      onDrop={event => { event.preventDefault(); insert(event.dataTransfer.getData('text/html') || `<p>${escape(event.dataTransfer.getData('text/plain'))}</p>`); }}
      onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData('text/html') || `<p>${escape(event.clipboardData.getData('text/plain')).replaceAll('\n', '<br>')}</p>`); }} />
    <div className="admin-story-body-editor__link"><label>스토어 내부 링크<input value={link} onChange={event => setLink(event.target.value)} placeholder="/shop/상품코드 또는 /stories/..." disabled={blocked} /></label><button type="button" disabled={blocked || !safeShoppingStoryLink(link)} onClick={() => { if (insert(`<p><a href="${escape(link)}">${escape(link)}</a></p>`)) setLink(''); }}>링크 넣기</button></div>
    <details><summary>이미지 넣기</summary><ArtworkUploadField key={uploadKey} kind="curation" currentPath={null} currentUrl={null} fieldId={`story-image-${uploadKey}`} name="storyImage" label="본문 이미지" showCropGuide={false} showPath={false} onPathChange={setPath} />
      <label>이미지 설명<input value={alt} disabled={blocked} onChange={event => setAlt(event.target.value)} maxLength={200} /></label>
      <button type="button" disabled={blocked || !path} onClick={() => { if (insert(`<figure><img src="${path}" alt="${escape(alt)}"></figure>`)) { setPath(''); setAlt(''); setUploadKey(key => key + 1); } }}>업로드한 이미지 본문에 넣기</button>
    </details>
    <details><summary>HTML 가져오기</summary><label>붙여넣을 HTML<textarea value={source} onChange={event => setSource(event.target.value)} disabled={blocked} rows={5} /></label><button type="button" disabled={blocked || !source} onClick={() => { if (insert(source)) setSource(''); }}>정리해서 본문에 넣기</button></details>
    {warning ? <p role="status">{warning}</p> : null}<p className="admin-story-help">정렬·크기는 커서가 있는 문단이나 선택한 문단에 적용됩니다. 굵게·기울임·밑줄·취소선은 선택한 글에 적용됩니다. 외부 링크·외부 이미지·스크립트는 제거됩니다. 본문 30,000자, 이미지 20장까지 등록할 수 있습니다.</p>
  </div>;
}
