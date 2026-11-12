'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { saveStorePresentationAction, type StorePresentationSaveResult } from '@/app/admin/store-presentation-actions';
import { Search } from 'lucide-react';
import { AdminNotice, AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { Button } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { STORE_PRESENTATION_PATH, STORE_THEME_COLORS, storeThemeForeground,
  type StorePresentation, type StorePresentationSection, type StorePresentationSnapshot } from '@/lib/store-presentation';

/* 링크 탭(템플릿 룩, ADR-0028) — 셸의 콘솔 전환과 같은 모양. */
/* 탭이 많아 좁은 화면에서 잘리지 않게 줄을 바꾼다(가로 스크롤은 단서가 없어 쓰지 않는다). */
const TABS = 'inline-flex max-w-full flex-wrap items-center gap-0.5 self-start rounded-lg bg-muted p-0.5';
const TAB = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const GROUP = 'flex min-w-0 flex-col gap-3';
const LEGEND = 'mb-3 text-sm font-medium text-foreground';
const HELP = 'text-sm leading-relaxed text-muted-foreground';
const CHOICES = 'flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4';
const CHOICE = 'flex items-center gap-2 text-sm';
const CHECK = 'flex items-start gap-2.5 text-sm [&>input]:mt-0.5';

export function StorePresentationScreen({ snapshot, section }: { snapshot: StorePresentationSnapshot; section: StorePresentationSection }) {
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="스토어 전시 설정" description="공통 색상과 홈 검색, 공개 상품목록의 표시 방식을 설정합니다." />
    <nav className={TABS} aria-label="전시 설정 종류">
      <Link aria-current={section === 'common' ? 'page' : undefined} className={TAB} href={STORE_PRESENTATION_PATH}>공통 테마·홈 검색</Link>
      <Link aria-current={section === 'listing' ? 'page' : undefined} className={TAB} href={`${STORE_PRESENTATION_PATH}?tab=listing`}>상품목록</Link>
    </nav>
    {/* 저장 버튼 아래 작은 글씨면 탭만 옮기다 입력을 잃는다 — 탭 바로 아래에 둔다. */}
    {section === 'common' ? <AdminNotice tone="info">공통 테마와 상품목록은 각각 저장합니다.</AdminNotice> : null}
    <PresentationForm key={section} snapshot={snapshot} section={section} />
  </section>;
}
function PresentationForm({ snapshot, section }: { snapshot: StorePresentationSnapshot; section: StorePresentationSection }) {
  const [values, setValues] = useState(snapshot.values);
  const [savedValues, setSavedValues] = useState(snapshot.values[section]);
  const [revision, setRevision] = useState(snapshot.revisions[section]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<{ values: StorePresentation[StorePresentationSection]; revision: number; id: string } | null>(null);
  const common = values.common, listing = values.listing;
  /* 미리보기도 공개 머리말과 같이 칠한다: 기본형은 메뉴 밑줄만, 컬러형은 머리말·메뉴 바탕까지 테마 색이다. */
  const themedHeader = common.headerStyle === 'color', themeInk = storeThemeForeground(common.themeColor);
  const themed = themedHeader ? { backgroundColor: common.themeColor, color: themeInk } : undefined;
  const dirty = JSON.stringify(values[section]) !== JSON.stringify(savedValues);
  useAdminLeaveGuard({ dirty: dirty || uncertain, message: '저장하지 않은 전시 설정을 두고 이동할까요?' });
  function changeCommon<K extends keyof typeof common>(key: K, value: typeof common[K]) { setValues(current => ({ ...current, common: { ...current.common, [key]: value } })); }
  function changeListing<K extends keyof typeof listing>(key: K, value: typeof listing[K]) { setValues(current => ({ ...current, listing: { ...current.listing, [key]: value } })); }
  async function save() {
    if (pending) return;
    request.current ??= { values: values[section], revision, id: crypto.randomUUID() };
    const attempt = request.current;
    setPending(true); setMessage('');
    let result: StorePresentationSaveResult;
    try { result = await saveStorePresentationAction(section, attempt.values, attempt.revision, attempt.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) {
      setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain));
      if (!result.uncertain) request.current = null;
      return;
    }
    setRevision(result.revision); setSavedValues(attempt.values); request.current = null; setUncertain(false); setError(false); setMessage('저장했습니다. 공개 화면에도 적용되었습니다.');
  }
  return <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
      <AdminSectionCard title={section === 'common' ? '공통 테마·홈 검색' : '상품목록 표시'}>
        <fieldset disabled={pending || uncertain} className="grid min-w-0 gap-7">
          {section === 'common' ? <>
            <fieldset className={GROUP}><legend className={LEGEND}>컬러 테마</legend><div className="flex flex-wrap gap-2">{STORE_THEME_COLORS.map((color, index) => <label className="relative block size-[38px] cursor-pointer" key={color} title={`${index === 0 ? 'ICONS 기본 ' : ''}${color}`}>
              <input className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0" type="radio" name="themeColor" value={color} checked={common.themeColor === color} onChange={() => changeCommon('themeColor', color)} />
              <span className="block size-full rounded-full border outline-offset-[3px] peer-checked:outline-2 peer-checked:outline-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50" style={{ backgroundColor: color }} /><span className="sr-only">{index === 0 ? 'ICONS 기본 ' : ''}{color}</span>
            </label>)}</div><p className={HELP}>{common.themeColor.toUpperCase()} · 기본형은 상단 메뉴 밑줄, 컬러형은 머리말과 상단 메뉴 바탕에 쓰입니다. 어드민 색상에는 적용되지 않습니다.</p></fieldset>
            <fieldset className={GROUP}><legend className={LEGEND}>공통 상단 메뉴 디자인</legend><div className={CHOICES}>
              <label className={CHOICE}><input type="radio" name="headerStyle" checked={common.headerStyle === 'basic'} onChange={() => changeCommon('headerStyle', 'basic')} />기본형</label>
              <label className={CHOICE}><input type="radio" name="headerStyle" checked={common.headerStyle === 'color'} onChange={() => changeCommon('headerStyle', 'color')} />컬러형</label>
            </div><p className={HELP}>컬러형은 스토어 헤더에 선택한 색을 적용합니다. 로고는 <Link className="text-foreground underline underline-offset-4" href="/admin/settings/store?section=branding">스토어 정보</Link>에서 관리합니다.</p></fieldset>
            <label className={CHECK}><input type="checkbox" checked={common.showHomeSearch} onChange={event => changeCommon('showHomeSearch', event.target.checked)} /><span className="flex flex-col gap-1">스토어 홈에 상품 검색 배너 표시<small className={HELP}>홈 본문에 검색창을 추가합니다. 상단 검색 아이콘은 항상 유지됩니다.</small></span></label>
          </> : <>
            <fieldset className={GROUP}><legend className={LEGEND}>썸네일 비율</legend><div className={CHOICES}><label className={CHOICE}><input type="radio" name="imageShape" checked={listing.imageShape === 'square'} onChange={() => changeListing('imageShape', 'square')} />정사각형 1:1</label><label className={CHOICE}><input type="radio" name="imageShape" checked={listing.imageShape === 'portrait'} onChange={() => changeListing('imageShape', 'portrait')} />세로직사각형 4:5</label></div><p className={HELP}>이미지를 자르지 않고 여백을 유지합니다. 스토리 섹션에서 직접 지정한 비율은 우선 적용됩니다.</p></fieldset>
            <fieldset className={GROUP}><legend className={LEGEND}>이미지 전시</legend><div className={CHOICES}><label className={CHOICE}><input type="radio" name="imageMode" checked={listing.imageMode === 'primary'} onChange={() => changeListing('imageMode', 'primary')} />대표이미지만</label><label className={CHOICE}><input type="radio" name="imageMode" checked={listing.imageMode === 'gallery'} onChange={() => changeListing('imageMode', 'gallery')} />대표·추가이미지 최대 10장</label></div></fieldset>
            {([
              ['showColors', '컬러칩 표시', '상품 편집의 목록 색상칩에 실제 등록한 이름과 색만 표시합니다.'],
              ['showDescription', '상세설명 표시', 'PC에서 상세정보 텍스트 일부(최대 240자)를 표시합니다.'],
              ['showCart', '장바구니 버튼 표시', '옵션·추가 입력이 있으면 상품상세에서 선택합니다. BEST·스토리 관련상품에서는 제외합니다.'],
              ['showTags', 'BEST·NEW 태그 표시', '품절·할인·그 외 상품 배지는 유지됩니다.'],
            ] as const).map(([key, label, hint]) => <label className={CHECK} key={key}><input type="checkbox" checked={listing[key]} onChange={event => changeListing(key, event.target.checked)} /><span className="flex flex-col gap-1">{label}<small className={HELP}>{hint}</small></span></label>)}
          </>}
        </fieldset>
      </AdminSectionCard>
      <aside className="flex min-w-0 flex-col gap-1 rounded-xl border bg-muted/40 p-5 lg:sticky lg:top-20" aria-label="저장 전 미리보기"><h2 className="text-base font-medium">저장 전 미리보기</h2><p className="text-xs text-muted-foreground">표시 방식을 확인하는 예시입니다.</p>
        {section === 'common' ? <div className="mx-auto mt-4 w-full max-w-[340px] overflow-hidden rounded-lg border bg-background lg:max-w-none"><div className="flex items-center justify-between px-4 py-6" style={themed}><strong style={{ color: 'inherit' }}>STORE</strong><Search aria-hidden="true" className="size-4" /></div><div className="flex justify-center gap-4 border-y p-3 text-xs" style={themed}><span className="border-b-2 pb-0.5" style={{ borderBottomColor: themedHeader ? themeInk : common.themeColor }}>NEW</span><span>BEST</span><span>상품</span></div><div className="p-3">{common.showHomeSearch ? <div className="mb-3 flex justify-between gap-2 rounded-md border p-2.5 text-[11px]">스토어 내 상품검색<span>검색</span></div> : null}<div className="grid min-h-[110px] place-items-center rounded-md bg-muted text-xs text-muted-foreground">스토어 홈 콘텐츠</div></div></div>
          : <div className="mx-auto mt-4 w-full max-w-[220px] rounded-lg border bg-background p-3"><div className="relative mb-2.5 grid aspect-square place-items-center rounded-md bg-muted text-xs text-muted-foreground data-[shape=portrait]:aspect-[4/5]" data-shape={listing.imageShape}><span>상품 이미지</span>{listing.imageMode === 'gallery' ? <small className="absolute bottom-2">‹　1 / 10　›</small> : null}</div>{listing.showTags ? <small className="text-xs font-medium">NEW</small> : null}<h3 className="my-2 text-sm font-medium">상품명 예시</h3>{listing.showColors ? <div role="img" aria-label="색상칩 예시" className="my-2 flex gap-1.5"><span className="size-3.5 rounded-full border" style={{ backgroundColor: '#654f43' }} /><span className="size-3.5 rounded-full border" style={{ backgroundColor: '#eae1d8' }} /></div> : null}<strong className="text-sm font-semibold">10,000원</strong>{listing.showDescription ? <p className="mt-1 text-xs text-muted-foreground">등록한 상세정보의 일부가 PC에 표시됩니다.</p> : null}{listing.showCart ? <span className="mt-3 inline-block rounded-md border px-4 py-1.5 text-xs">담기</span> : null}</div>}
      </aside>
    </div>
    <div className="flex flex-col items-stretch justify-end gap-3 sm:flex-row sm:items-center">{message ? <p className={`text-sm sm:mr-auto ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<Button disabled={pending} type="submit">{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button>
      <Button type="button" variant="outline" disabled={pending || uncertain || !dirty} onClick={async () => {
        if (!await adminConfirm('저장하지 않은 변경을 취소하고 마지막 저장값으로 돌아갈까요?')) return;
        setValues(current => ({ ...current, [section]: savedValues })); request.current = null; setMessage('입력 변경을 취소했습니다.'); setError(false);
      }}>변경 취소</Button></div>
    {section === 'listing' ? <p className="text-sm text-muted-foreground">상품목록·NEW·BEST·검색·찜한상품·관련상품에 적용합니다. 홈 큐레이션의 별도 디자인과 관리자 미리보기는 유지됩니다.</p> : null}
  </form>;
}
