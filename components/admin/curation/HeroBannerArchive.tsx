'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { readArchivedHeroBannersAction, setHeroBannerArchivedAction } from '@/app/admin/curation-archive-actions';
import { ARCHIVED_HERO_PAGE_SIZE, curationArchiveForm, type ArchivedHeroBanner, type ArchivedHeroPage } from '@/lib/admin/curation-archive';
import type { AdminCurationActionState } from '@/lib/admin/curations';
import { curationKstInput } from '@/lib/admin/curation-editor';
import { CurationEditorDialog } from './CurationProductPicker';

interface HeroArchiveTarget {
  id: string;
  title: string;
  imageUrl: string | null;
  updatedAt: string;
}

function BannerThumbnail({ target }: { target: HeroArchiveTarget }) {
  return <div className="admin-store-editor__archive-target">
    {target.imageUrl ? (
      // Existing verified banner artwork is reused without uploading a new object.
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" src={target.imageUrl} />
    ) : null}
    <strong>{target.title || '제목 없는 배너'}</strong>
  </div>;
}

function HeroArchiveConfirmation({ target, archive, dirty = false, onClose, onCompleted }: {
  target: HeroArchiveTarget; archive: boolean; dirty?: boolean; onClose: () => void; onCompleted: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<AdminCurationActionState>({});
  const [pending, startTransition] = useTransition();
  const request = useRef<FormData | null>(null);
  const operationId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const busy = pending || Boolean(state.uncertain);
  const submit = () => {
    if (inFlight.current || pending || state.conflict) return;
    inFlight.current = true;
    operationId.current ??= crypto.randomUUID();
    request.current ??= curationArchiveForm({ operationId: operationId.current, id: target.id, expectedUpdatedAt: target.updatedAt, archive });
    const fixedRequest = request.current;
    startTransition(async () => {
      let result: AdminCurationActionState;
      try { result = await setHeroBannerArchivedAction(fixedRequest); }
      catch { result = { errors: { form: '처리 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }, uncertain: true }; }
      inFlight.current = false;
      if (result.message && !result.errors) { setState(result); onCompleted(); router.refresh(); }
      else {
        // A later denial cannot prove whether the first lost response committed.
        const uncertain = Boolean(state.uncertain || result.uncertain);
        setState({ ...result, uncertain, conflict: uncertain ? false : result.conflict });
        if (!uncertain) { request.current = null; operationId.current = null; }
      }
    });
  };
  return <CurationEditorDialog title={archive ? '배너를 삭제할까요?' : '배너를 복구할까요?'} closeDisabled={busy} onClose={onClose}>
    <BannerThumbnail target={target} />
    <p className="admin-store-editor__dialog-copy">{archive
      ? '홈에서 사라지고 등록 개수에서 제외됩니다. 삭제한 배너 목록에서 복구할 수 있습니다.'
      : '비노출 상태로 복구합니다. 노출 기간과 미리보기를 확인한 뒤 홈 노출을 켜주세요.'}</p>
    {dirty && archive ? <p className="admin-store-editor__dialog-copy">아직 적용하지 않은 변경사항은 저장되지 않습니다.</p> : null}
    {state.errors?.form ? <p className="admin-store-editor__dialog-copy" role="alert">{state.errors.form}</p> : null}
    <footer>
      <button disabled={busy} onClick={onClose} type="button">취소</button>
      {state.conflict ? <button onClick={() => { onClose(); router.refresh(); }} type="button">닫고 최신 저장본 불러오기</button>
        : <button disabled={pending} onClick={submit} type="button">{pending ? '처리 중…' : state.uncertain ? '같은 요청 결과 확인' : archive ? '배너 삭제' : '비노출로 복구'}</button>}
    </footer>
  </CurationEditorDialog>;
}

export function HeroBannerDeleteButton({ target, dirty, disabled, onDeleted }: {
  target: HeroArchiveTarget; dirty: boolean; disabled: boolean; onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button disabled={disabled} onClick={() => setOpen(true)} type="button">배너 삭제</button>
    {open ? <HeroArchiveConfirmation target={target} archive dirty={dirty} onClose={() => setOpen(false)} onCompleted={() => { setOpen(false); onDeleted(); }} /> : null}
  </>;
}

export function ArchivedHeroBanners({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ArchivedHeroPage | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ArchivedHeroBanner | null>(null);
  const [pending, startTransition] = useTransition();
  const readGeneration = useRef(0);
  const load = (number: number) => {
    const generation = ++readGeneration.current;
    setError('');
    startTransition(async () => {
      try {
        let response = await readArchivedHeroBannersAction(number);
        if (response.page && number > Math.max(1, Math.ceil(response.page.total / ARCHIVED_HERO_PAGE_SIZE))) {
          response = await readArchivedHeroBannersAction(Math.max(1, Math.ceil(response.page.total / ARCHIVED_HERO_PAGE_SIZE)));
        }
        if (generation !== readGeneration.current) return;
        if (response.page) setPage(response.page);
        else { setPage(null); setError(response.error || '삭제한 배너를 불러오지 못했습니다.'); }
      } catch {
        if (generation === readGeneration.current) { setPage(null); setError('삭제한 배너를 불러오지 못했습니다.'); }
      }
    });
  };
  const close = () => { if (selected) return; ++readGeneration.current; setOpen(false); };
  const pageCount = Math.max(1, Math.ceil((page?.total ?? 0) / ARCHIVED_HERO_PAGE_SIZE));
  return <>
    <button className="admin-store-editor__add" onClick={() => { setOpen(true); setPage(null); load(1); }} type="button">삭제한 배너</button>
    {open ? <CurationEditorDialog title="삭제한 배너" closeDisabled={Boolean(selected)} onClose={close}>
      <p className="admin-store-editor__dialog-copy">이미지와 문구를 보관하고 있습니다. 복구하면 등록 개수에 포함되며 비노출 상태로 돌아갑니다.</p>
      {pending ? <p className="admin-store-editor__dialog-copy" role="status">목록을 불러오는 중입니다.</p> : null}
      {error ? <p className="admin-store-editor__dialog-copy" role="alert">{error}</p> : null}
      {!pending && !error && page?.rows.length === 0 ? <p className="admin-store-editor__empty">삭제한 배너가 없습니다.</p> : null}
      {page ? <>
        <p className="admin-store-editor__dialog-copy">총 {page.total}개</p>
        <ul className="admin-store-editor__archived-list">{page.rows.map(banner => <li key={banner.id}>
          <BannerThumbnail target={banner} />
          <span>{curationKstInput(banner.archivedAt).replace('T', ' ')} 삭제</span>
          <button disabled={pending} onClick={() => setSelected(banner)} type="button">{banner.title || '제목 없는 배너'} 복구</button>
        </li>)}</ul>
        <nav aria-label="삭제한 배너 페이지" className="admin-store-editor__picker-pages">
          <button disabled={pending || page.page <= 1} onClick={() => load(page.page - 1)} type="button">이전</button>
          <span>{page.page} / {pageCount}</span>
          <button disabled={pending || page.page >= pageCount} onClick={() => load(page.page + 1)} type="button">다음</button>
        </nav>
      </> : null}
      {error ? <button disabled={pending} onClick={() => load(page?.page ?? 1)} type="button">목록 다시 불러오기</button> : null}
      <footer><button disabled={Boolean(selected)} onClick={close} type="button">닫기</button></footer>
    </CurationEditorDialog> : null}
    {selected ? <HeroArchiveConfirmation target={selected} archive={false} onClose={() => { setSelected(null); load(page?.page ?? 1); }} onCompleted={() => {
      setSelected(null); load(page?.page ?? 1); onRestored();
    }} /> : null}
  </>;
}
