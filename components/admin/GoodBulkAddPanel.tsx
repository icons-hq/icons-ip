'use client';
import { useId, useRef, useState } from 'react';
import { readGoodReferenceFileAction, resolveGoodReferencesAction } from '@/app/admin/good-reference-actions';
import { GOOD_REFERENCE_LIMIT, GOOD_REFERENCE_STATUS_REASONS, SYSTEM_NUMBER_COLUMN_NOTICE, parseGoodReferenceLines, type GoodReferenceMatch } from '@/lib/admin/good-references';
import { hiddenDisplayGoodsBreakdown, type DisplayGoodVisibility } from '@/lib/admin/good-visibility';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { DisplayGoodVisibilityNote } from './DisplayGoodVisibility';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/**
 * 선택기마다 다른 '고를 수 있는지' 규칙. 찾지 못함·보관·같은 값 겹침은 이 패널이 먼저 거른다.
 * `visibility`는 그 선택기가 고객 화면 노출을 따로 판정할 때만 준다(홈 전시는 공개 홈 상품 목록으로 본다). 주지 않으면 조회 결과의 이유를 쓴다.
 */
export type GoodBulkClassification<T> = { ok: true; id: string; item: T; visibility?: DisplayGoodVisibility } | { ok: false; reason: string };
export interface GoodBulkAddOptions<T> {
  classify: (match: GoodReferenceMatch & { status: 'found'; id: string; name: string }) => GoodBulkClassification<T>;
  /** 지금 더 담을 수 있는 수. 넘으면 앞에서부터 이만큼만 담는다. */
  capacity: number;
  onAdd: (items: T[]) => void;
  /** 담은 뒤 안내의 끝말(예: '선택 완료를 눌러 반영해주세요.'). */
  appliedHint?: string;
}
/** 줄 상태. ready만 담는다. overLimit은 추가 가능했지만 지금 담을 수 있는 수를 넘어 담지 않은 줄이다. */
type RowState = 'ready' | 'blocked' | 'missing' | 'overLimit';
const ROW_LABELS: Record<RowState, string> = { ready: '추가 가능', blocked: '추가 안 함', missing: '못 찾음', overLimit: '한도 초과' };
type Row = { key: string; ref: string; label: string; state: RowState; reason: string; id: string | null; item?: unknown; visibility: DisplayGoodVisibility };
type Result = { rows: Row[]; notes: string[] };

const count = (value: number) => value.toLocaleString('ko-KR');
/** 안내 문장에 넣을 상품 이름(앞 3개, 나머지는 수). */
function rowNames(rows: readonly Row[]) {
  const shown = rows.slice(0, 3).map(row => row.label).join(', ');
  return rows.length > 3 ? `${shown} 외 ${count(rows.length - 3)}개` : shown;
}
const overLimitReason = (capacity: number) => `지금 담을 수 있는 수(${count(capacity)}개)를 넘어 담지 않았습니다. 선택을 줄인 뒤 다시 확인해주세요.`;

/**
 * 여러 상품을 한 번에 고른다(1014-112): 상품 URL(주소 또는 주소 끝 값)·판매자상품코드를 한 줄에 하나씩 붙여 넣거나, 엑셀·CSV 파일의 한 열을 읽는다.
 * 찾은 상품과 못 찾은 상품을 먼저 보여 주고, '추가'를 눌러야 선택에 담는다(편성 저장은 각 화면의 저장 버튼이 한다).
 * 고객 화면에 보이지 않는 상품(초안·IP 초안·성인(19금))도 담을 수 있지만 줄마다 그 이유를 표시한다(QA1 MD). 한도를 넘어 담지 못한 줄은 이유와 함께 남기고 입력 칸에도 되돌려 둔다.
 * 선택기 안의 검색 폼과 섞이지 않게 버튼은 모두 type="button"이고 Enter로 제출하지 않는다.
 */
export function GoodBulkAddPanel<T>({ options, disabled = false }: { options: GoodBulkAddOptions<T>; disabled?: boolean }) {
  const textId = useId(), fileId = useId(), noteId = useId();
  const [text, setText] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null), [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), ticket = useRef(0);
  const locked = disabled || pending;

  async function check(source: string, notes: string[] = []) {
    if (locked) return;
    const parsed = parseGoodReferenceLines(source, typeof window === 'undefined' ? null : window.location.host);
    const lineNotes = [...notes];
    if (parsed.systemNumberColumn) lineNotes.push(SYSTEM_NUMBER_COLUMN_NOTICE);
    else if (parsed.headerSkipped) lineNotes.push('첫 줄은 머리글로 보고 건너뛰었습니다.');
    if (parsed.duplicates) lineNotes.push(`같은 값 ${count(parsed.duplicates)}줄은 한 번만 확인했습니다.`);
    if (parsed.overflow) lineNotes.push(`한 번에 ${count(GOOD_REFERENCE_LIMIT)}개까지 확인합니다. 나머지 ${count(parsed.overflow)}줄은 나눠서 넣어주세요.`);
    const invalidRows: Row[] = parsed.invalid.map((line, index) => ({ key: `invalid:${index}`, ref: line.value, label: `${line.line}번째 줄`, state: 'missing', reason: line.reason, id: null, visibility: 'missing' }));
    if (!parsed.refs.length) {
      setResult(invalidRows.length || lineNotes.length ? { rows: invalidRows, notes: lineNotes } : null);
      setError(invalidRows.length || parsed.systemNumberColumn ? '' : '상품 URL·판매자상품코드를 한 줄에 하나씩 넣어주세요.');
      return;
    }
    const token = ++ticket.current; setPending(true); setError(''); setMessage('');
    try {
      const resolved = await resolveGoodReferencesAction(parsed.refs);
      if (token !== ticket.current) return;
      if (!resolved.ok) { setError(resolved.error); return; }
      const ids = new Set<string>();
      const rows = resolved.matches.map((match, index): Row => {
        const base = { key: `ref:${index}`, ref: match.ref, label: match.name ? `${match.name}${match.code ? ` · ${match.code}` : ''}` : match.ref, id: match.id, visibility: match.visibility };
        if (match.status === 'not_found') return { ...base, state: 'missing', reason: GOOD_REFERENCE_STATUS_REASONS.not_found };
        if (match.status === 'ambiguous') return { ...base, state: 'missing', reason: GOOD_REFERENCE_STATUS_REASONS.ambiguous };
        if (match.archived || !match.id || !match.name) return { ...base, state: 'blocked', reason: GOOD_REFERENCE_STATUS_REASONS.archived };
        if (ids.has(match.id)) return { ...base, state: 'blocked', reason: '위 줄과 같은 상품입니다.' };
        const decided = options.classify({ ...match, status: 'found', id: match.id, name: match.name });
        if (!decided.ok) return { ...base, state: 'blocked', reason: decided.reason };
        ids.add(decided.id);
        return { ...base, state: 'ready', reason: '', item: decided.item, visibility: decided.visibility ?? match.visibility };
      });
      setResult({ rows: [...rows, ...invalidRows], notes: lineNotes });
    } catch { if (token === ticket.current) setError('상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { if (token === ticket.current) setPending(false); }
  }
  async function readFile(file: File | undefined) {
    if (!file || locked) return;
    const form = new FormData(); form.set('file', file);
    const token = ++ticket.current; setPending(true); setError(''); setMessage(''); setResult(null);
    try {
      const read = await readGoodReferenceFileAction(form);
      if (token !== ticket.current) return;
      setPending(false);
      if (!read.ok) { setError(read.error); return; }
      const joined = read.cells.join('\n');
      setText(joined);
      await check(joined, [`${file.name.slice(0, 80)}에서 ${count(read.cells.length)}칸을 읽었습니다.`, ...read.warnings]);
    } catch { if (token === ticket.current) { setPending(false); setError('파일을 읽지 못했습니다. 형식을 확인한 뒤 다시 올려주세요.'); } }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  const addable = result?.rows.filter(row => row.state === 'ready') ?? [];
  const blocked = (result?.rows.length ?? 0) - addable.length;
  const addableHidden = addable.filter(row => row.visibility !== 'public').length;
  function add() {
    if (locked || !addable.length) return;
    const capacity = Math.max(0, options.capacity);
    const taken = addable.slice(0, capacity), left = addable.slice(taken.length);
    /* 한도를 넘는 줄은 지우지 않는다 — 어느 상품이 빠졌는지 줄마다 남기고, 선택을 줄인 뒤 다시 확인할 수 있게 입력 칸에 되돌린다. */
    const remaining = left.map(row => ({ ...row, state: 'overLimit' as const, reason: overLimitReason(capacity) }));
    if (!taken.length) {
      setResult(current => current ? { ...current, rows: current.rows.map(row => row.state === 'ready' ? { ...row, state: 'overLimit', reason: overLimitReason(capacity) } : row) } : current);
      setMessage(`지금 담을 수 있는 수가 0개라 담지 않았습니다(${rowNames(left)}). 선택을 줄인 뒤 다시 확인해주세요.`);
      return;
    }
    options.onAdd(taken.map(row => row.item as T));
    const hidden = taken.filter(row => row.visibility !== 'public').map(row => row.visibility);
    setMessage([
      `${count(taken.length)}개를 선택에 담았습니다.`,
      hidden.length ? `그중 ${count(hidden.length)}개(${hiddenDisplayGoodsBreakdown(hidden)})는 고객 화면에 보이지 않습니다.` : '',
      left.length ? `지금 담을 수 있는 수(${count(capacity)}개)를 넘는 ${count(left.length)}개는 담지 않았습니다: ${rowNames(left)}. 아래 목록과 입력 칸에 남겨 두었습니다.` : '',
      options.appliedHint ?? '',
    ].filter(Boolean).join(' '));
    if (remaining.length) { setResult({ rows: remaining, notes: [] }); setText(remaining.map(row => row.ref).join('\n')); }
    else { setResult(null); setText(''); }
  }
  return <details className="group/bulk rounded-lg border px-3.5 py-2.5 text-sm" data-good-bulk-add="">
    <summary className="cursor-pointer font-medium text-foreground">여러 상품 한 번에 추가 <span className="font-normal text-muted-foreground">(여러 줄 붙여넣기 · 엑셀 파일)</span></summary>
    <div className="mt-3 flex min-w-0 flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground" id={noteId}>상품 URL(주소 또는 주소 끝 값)·판매자상품코드를 한 줄에 하나씩 넣습니다. 엑셀에서 한 열을 복사해 붙여도 됩니다(여러 열이면 각 줄의 첫 칸만 읽습니다). 한 번에 {count(GOOD_REFERENCE_LIMIT)}개까지 확인합니다. 초안 등 고객 화면에 보이지 않는 상품도 담을 수 있으며 줄마다 그 이유를 표시합니다.</p>
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium" htmlFor={textId}>여러 줄 붙여넣기
        <Textarea aria-describedby={noteId} className="min-h-24 font-mono text-xs" disabled={locked} id={textId} onChange={event => setText(event.target.value)}
          placeholder={'https://iconsip.com/shop/상품ID\nGC-0001'} rows={4} value={text} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={locked || !text.trim()} onClick={() => void check(text)} size="sm" type="button" variant="outline">{pending ? '확인 중…' : '상품 확인'}</Button>
        <label className="text-xs text-muted-foreground" htmlFor={fileId}>또는 엑셀로 추가(한 열)</label>
        <input accept=".xlsx,.csv,.tsv,.txt" className="max-w-full text-xs file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs" disabled={locked} id={fileId}
          onChange={event => void readFile(event.target.files?.[0])} ref={fileInput} type="file" />
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {result ? <div className="flex min-w-0 flex-col gap-2" data-good-bulk-result="">
        <p className="text-sm tabular-nums" role="status">추가 가능 <strong className="font-semibold">{count(addable.length)}</strong>개{addableHidden ? ` (고객 화면 미노출 ${count(addableHidden)}개 포함)` : ''} · 추가하지 않음 {count(blocked)}개 · 지금 담을 수 있는 수 {count(Math.max(0, options.capacity))}개</p>
        {result.notes.map(note => <p className="text-xs text-muted-foreground" key={note}>{note}</p>)}
        <ul className="flex max-h-[28rem] flex-col overflow-auto rounded-md border">{result.rows.map(row => <li className="flex items-start gap-2 border-b px-2.5 py-1.5 text-xs last:border-b-0" data-good-bulk-row={row.state} key={row.key}>
          <AdminStatusBadge tone={statusTone('goodReference', row.state)}>{ROW_LABELS[row.state]}</AdminStatusBadge>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{row.label}{row.label !== row.ref ? <small className="block text-muted-foreground">입력: {row.ref}</small> : null}{row.reason ? <small className="block text-muted-foreground">{row.reason}</small> : null}
            {row.state === 'ready' || row.state === 'overLimit' ? <DisplayGoodVisibilityNote visibility={row.visibility} /> : null}</span>
        </li>)}</ul>
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={locked} onClick={() => setResult(null)} size="sm" type="button" variant="ghost">결과 지우기</Button>
          <Button disabled={locked || !addable.length} onClick={add} size="sm" type="button">{`추가 가능한 ${count(addable.length)}개 담기`}</Button></div>
      </div> : null}
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>
  </details>;
}
