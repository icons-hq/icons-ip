'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { saveStorePresentationAction, type StorePresentationSaveResult } from '@/app/admin/store-presentation-actions';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { STORE_PRESENTATION_PATH, STORE_THEME_COLORS, storeThemeForeground,
  type StorePresentation, type StorePresentationSection, type StorePresentationSnapshot } from '@/lib/store-presentation';

export function StorePresentationScreen({ snapshot, section }: { snapshot: StorePresentationSnapshot; section: StorePresentationSection }) {
  return <section className="wc-admin-kit wc-admin-kit__screen admin-store-presentation">
    <AdminPageHeader title="스토어 전시 설정" description="공통 색상과 홈 검색, 공개 상품목록의 표시 방식을 설정합니다." />
    <nav className="admin-store-presentation__tabs" aria-label="전시 설정 종류">
      <Link aria-current={section === 'common' ? 'page' : undefined} href={STORE_PRESENTATION_PATH}>공통 테마·홈 검색</Link>
      <Link aria-current={section === 'listing' ? 'page' : undefined} href={`${STORE_PRESENTATION_PATH}?tab=listing`}>상품목록</Link>
    </nav>
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
  const dirty = JSON.stringify(values[section]) !== JSON.stringify(savedValues);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!window.confirm('저장하지 않은 전시 설정을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', prevent); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true); };
  }, [dirty, uncertain]);
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
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="admin-store-presentation__layout">
      <AdminSectionCard title={section === 'common' ? '공통 테마·홈 검색' : '상품목록 표시'}>
        <fieldset disabled={pending || uncertain} className="admin-store-presentation__fields">
          {section === 'common' ? <>
            <fieldset><legend>컬러 테마</legend><div className="admin-store-presentation__palette">{STORE_THEME_COLORS.map((color, index) => <label key={color} title={`${index === 0 ? 'ICONS 기본 ' : ''}${color}`}>
              <input type="radio" name="themeColor" value={color} checked={common.themeColor === color} onChange={() => changeCommon('themeColor', color)} />
              <span style={{ backgroundColor: color }} /><span className="wc-sr-only">{index === 0 ? 'ICONS 기본 ' : ''}{color}</span>
            </label>)}</div><p>{common.themeColor.toUpperCase()} · 어드민 색상에는 적용되지 않습니다.</p></fieldset>
            <fieldset><legend>공통 GNB 디자인</legend><div className="admin-store-presentation__choices">
              <label><input type="radio" name="headerStyle" checked={common.headerStyle === 'basic'} onChange={() => changeCommon('headerStyle', 'basic')} />기본형</label>
              <label><input type="radio" name="headerStyle" checked={common.headerStyle === 'color'} onChange={() => changeCommon('headerStyle', 'color')} />컬러형</label>
            </div><p>컬러형은 스토어 헤더에 선택한 색을 적용합니다. 로고는 <Link href="/admin/settings/store?section=branding">스토어 정보</Link>에서 관리합니다.</p></fieldset>
            <label className="admin-store-presentation__check"><input type="checkbox" checked={common.showHomeSearch} onChange={event => changeCommon('showHomeSearch', event.target.checked)} /><span>스토어 홈에 상품 검색 배너 표시<small>홈 본문에 검색창을 추가합니다. 상단 검색 아이콘은 항상 유지됩니다.</small></span></label>
          </> : <>
            <fieldset><legend>썸네일 비율</legend><div className="admin-store-presentation__choices"><label><input type="radio" name="imageShape" checked={listing.imageShape === 'square'} onChange={() => changeListing('imageShape', 'square')} />정사각형 1:1</label><label><input type="radio" name="imageShape" checked={listing.imageShape === 'portrait'} onChange={() => changeListing('imageShape', 'portrait')} />세로직사각형 4:5</label></div><p>이미지를 자르지 않고 여백을 유지합니다. 스토리 섹션에서 직접 지정한 비율은 우선 적용됩니다.</p></fieldset>
            <fieldset><legend>이미지 전시</legend><div className="admin-store-presentation__choices"><label><input type="radio" name="imageMode" checked={listing.imageMode === 'primary'} onChange={() => changeListing('imageMode', 'primary')} />대표이미지만</label><label><input type="radio" name="imageMode" checked={listing.imageMode === 'gallery'} onChange={() => changeListing('imageMode', 'gallery')} />대표·추가이미지 최대 10장</label></div></fieldset>
            {([
              ['showColors', '컬러칩 표시', '상품 편집의 목록 색상칩에 실제 등록한 이름과 색만 표시합니다.'],
              ['showDescription', '상세설명 표시', 'PC에서 상세정보 텍스트 일부(최대 240자)를 표시합니다.'],
              ['showCart', '장바구니 버튼 표시', '옵션·추가 입력이 있으면 상품상세에서 선택합니다. BEST·스토리 관련상품에서는 제외합니다.'],
              ['showTags', 'BEST·NEW 태그 표시', '품절·할인·그 외 상품 배지는 유지됩니다.'],
            ] as const).map(([key, label, hint]) => <label className="admin-store-presentation__check" key={key}><input type="checkbox" checked={listing[key]} onChange={event => changeListing(key, event.target.checked)} /><span>{label}<small>{hint}</small></span></label>)}
          </>}
        </fieldset>
      </AdminSectionCard>
      <aside className="admin-store-presentation__preview" aria-label="저장 전 미리보기"><h2>저장 전 미리보기</h2><p>표시 방식을 확인하는 예시입니다.</p>
        {section === 'common' ? <div className="admin-store-presentation__preview-store"><div className="admin-store-presentation__preview-header" style={common.headerStyle === 'color' ? { backgroundColor: common.themeColor, color: storeThemeForeground(common.themeColor) } : undefined}><strong style={{ color: 'inherit' }}>STORE</strong><span aria-hidden>⌕</span></div><div className="admin-store-presentation__preview-nav">NEW　 BEST　 상품</div><div className="admin-store-presentation__preview-body">{common.showHomeSearch ? <div className="admin-store-presentation__preview-search">스토어 내 상품검색<span>검색</span></div> : null}<div className="admin-store-presentation__preview-placeholder">스토어 홈 콘텐츠</div></div></div>
          : <div className="admin-store-presentation__preview-product"><div className="admin-store-presentation__preview-image" data-shape={listing.imageShape}><span>상품 이미지</span>{listing.imageMode === 'gallery' ? <small>‹　1 / 10　›</small> : null}</div>{listing.showTags ? <small>NEW</small> : null}<h3>상품명 예시</h3>{listing.showColors ? <div aria-label="색상칩 예시" className="admin-store-presentation__preview-colors"><span style={{ backgroundColor: '#654f43' }} /><span style={{ backgroundColor: '#eae1d8' }} /></div> : null}<strong>10,000원</strong>{listing.showDescription ? <p>등록한 상세정보의 일부가 PC에 표시됩니다.</p> : null}{listing.showCart ? <span className="admin-store-presentation__preview-cart">담기</span> : null}</div>}
      </aside>
    </div>
    <div className="admin-store-presentation__save">{message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}<button className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending} type="submit">{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</button>
      <button className="wc-admin-kit__button" type="button" disabled={pending || uncertain || !dirty} onClick={() => {
        if (!window.confirm('저장하지 않은 변경을 취소하고 마지막 저장값으로 돌아갈까요?')) return;
        setValues(current => ({ ...current, [section]: savedValues })); request.current = null; setMessage('입력 변경을 취소했습니다.'); setError(false);
      }}>변경 취소</button></div>
    <p className="admin-store-presentation__scope">{section === 'listing' ? '상품목록·NEW·BEST·검색·찜한상품·관련상품에 적용합니다. 홈 큐레이션의 별도 디자인과 관리자 미리보기는 유지됩니다.' : '공통 테마와 상품목록은 각각 저장합니다.'}</p>
  </form>;
}
