'use client';
import { useId, useRef, useState } from 'react';
import { readGoodReferenceFileAction, resolveGoodReferencesAction } from '@/app/admin/good-reference-actions';
import { GOOD_REFERENCE_LIMIT, GOOD_REFERENCE_STATUS_REASONS, parseGoodReferenceLines, type GoodReferenceMatch } from '@/lib/admin/good-references';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/** 선택기마다 다른 '고를 수 있는지' 규칙. 찾지 못함·보관·같은 값 겹침은 이 패널이 먼저 거른다. */
export type GoodBulkClassification<T> = { ok: true; id: string; item: T } | { ok: false; reason: string };
export interface GoodBulkAddOptions<T> {
  classify: (match: GoodReferenceMatch & { status: 'found'; id: string; name: string }) => GoodBulkClassification<T>;
  /** 지금 더 담을 수 있는 수. 넘으면 앞에서부터 이만큼만 담는다. */
  capacity: number;
  onAdd: (items: T[]) => void;
  /** 담은 뒤 안내의 끝말(예: '선택 완료를 눌러 반영해주세요.'). */
  appliedHint?: string;
}
type Row = { key: string; ref: string; label: string; ok: boolean; reason: string; id: string | null; item?: unknown };
type Result = { rows: Row[]; notes: string[] };

/**
 * 여러 상품을 한 번에 고른다(1014-112): 상품 URL·판매자상품코드·상품번호를 한 줄에 하나씩 붙여 넣거나, 엑셀·CSV 파일의 한 열을 읽는다.
 * 찾은 상품과 못 찾은 상품을 먼저 보여 주고, '추가'를 눌러야 선택에 담는다(편성 저장은 각 화면의 저장 버튼이 한다).
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
    if (parsed.headerSkipped) lineNotes.push('첫 줄은 머리글로 보고 건너뛰었습니다.');
    if (parsed.duplicates) lineNotes.push(`같은 값 ${parsed.duplicates.toLocaleString('ko-KR')}줄은 한 번만 확인했습니다.`);
    if (parsed.overflow) lineNotes.push(`한 번에 ${GOOD_REFERENCE_LIMIT.toLocaleString('ko-KR')}개까지 확인합니다. 나머지 ${parsed.overflow.toLocaleString('ko-KR')}줄은 나눠서 넣어주세요.`);
    const invalidRows: Row[] = parsed.invalid.map((line, index) => ({ key: `invalid:${index}`, ref: line.value, label: `${line.line}번째 줄`, ok: false, reason: line.reason, id: null }));
    if (!parsed.refs.length) {
      setResult(invalidRows.length || lineNotes.length ? { rows: invalidRows, notes: lineNotes } : null);
      setError(invalidRows.length ? '' : '상품 URL·상품코드를 한 줄에 하나씩 넣어주세요.');
      return;
    }
    const token = ++ticket.current; setPending(true); setError(''); setMessage('');
    try {
      const resolved = await resolveGoodReferencesAction(parsed.refs);
      if (token !== ticket.current) return;
      if (!resolved.ok) { setError(resolved.error); return; }
      const ids = new Set<string>();
      const rows = resolved.matches.map((match, index): Row => {
        const base = { key: `ref:${index}`, ref: match.ref, label: match.name ? `${match.name}${match.code ? ` · ${match.code}` : ''}` : match.ref, id: match.id };
        if (match.status === 'not_found') return { ...base, ok: false, reason: GOOD_REFERENCE_STATUS_REASONS.not_found };
        if (match.status === 'ambiguous') return { ...base, ok: false, reason: GOOD_REFERENCE_STATUS_REASONS.ambiguous };
        if (match.archived || !match.id || !match.name) return { ...base, ok: false, reason: GOOD_REFERENCE_STATUS_REASONS.archived };
        if (ids.has(match.id)) return { ...base, ok: false, reason: '위 줄과 같은 상품입니다.' };
        const decided = options.classify({ ...match, status: 'found', id: match.id, name: match.name });
        if (!decided.ok) return { ...base, ok: false, reason: decided.reason };
        ids.add(decided.id);
        return { ...base, ok: true, reason: '', item: decided.item };
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
      await check(joined, [`${file.name.slice(0, 80)}에서 ${read.cells.length.toLocaleString('ko-KR')}칸을 읽었습니다.`, ...read.warnings]);
    } catch { if (token === ticket.current) { setPending(false); setError('파일을 읽지 못했습니다. 형식을 확인한 뒤 다시 올려주세요.'); } }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  const addable = result?.rows.filter(row => row.ok) ?? [];
  const blocked = (result?.rows.length ?? 0) - addable.length;
  function add() {
    if (locked || !addable.length) return;
    const capacity = Math.max(0, options.capacity);
    const taken = addable.slice(0, capacity);
    if (!taken.length) { setMessage(`더 담을 수 없습니다. 추가 가능 ${capacity.toLocaleString('ko-KR')}개를 확인해주세요.`); return; }
    options.onAdd(taken.map(row => row.item as T));
    const left = addable.length - taken.length;
    setMessage(`${taken.length.toLocaleString('ko-KR')}개를 선택에 담았습니다.${left ? ` 한도를 넘는 ${left.toLocaleString('ko-KR')}개는 담지 않았습니다.` : ''}${options.appliedHint ? ` ${options.appliedHint}` : ''}`);
    setResult(null); setText('');
  }
  return <details className="group/bulk rounded-lg border px-3.5 py-2.5 text-sm" data-good-bulk-add="">
    <summary className="cursor-pointer font-medium text-foreground">여러 상품 한 번에 추가 <span className="font-normal text-muted-foreground">(여러 줄 붙여넣기 · 엑셀 파일)</span></summary>
    <div className="mt-3 flex min-w-0 flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground" id={noteId}>상품 URL·판매자상품코드·상품번호를 한 줄에 하나씩 넣습니다. 엑셀에서 한 열을 복사해 붙여도 됩니다(여러 열이면 각 줄의 첫 칸만 읽습니다). 한 번에 {GOOD_REFERENCE_LIMIT.toLocaleString('ko-KR')}개까지 확인합니다.</p>
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
        <p className="text-sm tabular-nums" role="status">추가 가능 <strong className="font-semibold">{addable.length.toLocaleString('ko-KR')}</strong>개 · 추가하지 않음 {blocked.toLocaleString('ko-KR')}개 · 지금 담을 수 있는 수 {Math.max(0, options.capacity).toLocaleString('ko-KR')}개</p>
        {result.notes.map(note => <p className="text-xs text-muted-foreground" key={note}>{note}</p>)}
        <ul className="flex max-h-56 flex-col overflow-auto rounded-md border">{result.rows.map(row => <li className="flex items-start gap-2 border-b px-2.5 py-1.5 text-xs last:border-b-0" key={row.key}>
          <AdminStatusBadge tone={statusTone('goodReference', row.ok ? 'ready' : row.id ? 'blocked' : 'missing')}>{row.ok ? '추가 가능' : row.id ? '추가 안 함' : '못 찾음'}</AdminStatusBadge>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{row.label}{row.label !== row.ref ? <small className="block text-muted-foreground">입력: {row.ref}</small> : null}{row.reason ? <small className="block text-muted-foreground">{row.reason}</small> : null}</span>
        </li>)}</ul>
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={locked} onClick={() => setResult(null)} size="sm" type="button" variant="ghost">결과 지우기</Button>
          <Button disabled={locked || !addable.length} onClick={add} size="sm" type="button">{`추가 가능한 ${addable.length.toLocaleString('ko-KR')}개 담기`}</Button></div>
      </div> : null}
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>
  </details>;
}
