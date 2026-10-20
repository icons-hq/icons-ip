'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COUNTRY_NAME_SOURCE, countryNamePage, findCountryName } from '@/lib/admin/country-names';
import { KOREAN_PROVINCES, KOREAN_REGION_SOURCE, findKoreanProvince, koreanOriginValue } from '@/lib/admin/korean-regions';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { Field } from './fields';

type CountryNameFinderProps = {
  onClose: () => void;
} & ({ mode: 'copy' } | { mode: 'apply'; currentValue: string; disabled: boolean; onApply: (name: string) => boolean });

/** The picker is outside the native product form, including its autosave event listeners. */
export function CountryNamePicker(props: CountryNameFinderProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-root wc-admin admin-country-finder-shell" onChange={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); event.stopPropagation(); }}>
    <CountryNameFinder {...props} />
  </div>, document.body);
}

export function CountryNameFinder(props: CountryNameFinderProps) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [selectedCode, setSelectedCode] = useState('');
  const [scope, setScope] = useState<'country' | 'domestic'>('country');
  const [provinceCode, setProvinceCode] = useState(''), [districtCode, setDistrictCode] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState(false), [copying, setCopying] = useState(false);
  const mounted = useRef(true), copyOperation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const result = countryNamePage(query, page), province = findKoreanProvince(provinceCode);
  const selectedValue = scope === 'country' ? findCountryName(selectedCode)?.name ?? '' : koreanOriginValue(provinceCode, districtCode);
  const blocked = props.mode === 'apply' && props.disabled;
  function select(code: string) { setSelectedCode(code); setMessage(''); setError(false); }
  function changeScope(next: 'country' | 'domestic') {
    setScope(next); select(''); setProvinceCode(''); setDistrictCode('');
  }
  async function confirm() {
    if (!selectedValue || blocked || copying || copyOperation.current) return;
    if (props.mode === 'apply') {
      if (props.onApply(selectedValue)) props.onClose();
      else { setMessage('현재 입력을 바꿀 수 없습니다. 상품 상태를 확인해주세요.'); setError(true); }
      return;
    }
    copyOperation.current = true; setCopying(true); setMessage(''); setError(false);
    try {
      await navigator.clipboard.writeText(selectedValue);
      if (mounted.current) setMessage('제조국 값을 복사했습니다. 엑셀의 제조국 칸에 붙여넣으세요.');
    } catch {
      if (mounted.current) { setMessage('자동 복사를 사용할 수 없습니다. 선택한 입력값을 직접 복사해주세요.'); setError(true); }
    } finally { copyOperation.current = false; if (mounted.current) setCopying(false); }
  }
  return <CustomerServiceDialog title={props.mode === 'copy' ? '제조국 찾기' : '원산지 국가·지역 찾기'} onClose={props.onClose}>
    <section className="admin-country-finder">
      <p>{props.mode === 'copy' ? '국가·지역 또는 국내 상세지역을 골라 엑셀의 제조국 칸에 붙여넣으세요.' : '선택한 값을 현재 원산지 입력에 넣습니다. 상품 저장 후 반영됩니다.'}</p>
      <fieldset className="admin-country-finder__scope" disabled={copying}>
        <legend className="wc-sr-only">찾기 범위</legend>
        <label><input type="radio" name="originFinderScope" value="country" checked={scope === 'country'} onChange={() => changeScope('country')} />국가·지역</label>
        <label><input type="radio" name="originFinderScope" value="domestic" checked={scope === 'domestic'} onChange={() => changeScope('domestic')} />국내 상세지역</label>
      </fieldset>
      {scope === 'country' ? <>
      <label className="admin-country-finder__query">국가·지역명 또는 코드<input type="search" maxLength={120} value={query} disabled={copying}
        placeholder="예: 대한민국, 한국, Korea, KR" onChange={event => { setQuery(event.target.value); setPage(1); select(''); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }} /></label>
      <p role="status">검색 결과 {result.total.toLocaleString('ko-KR')}개</p>
      <fieldset className="admin-country-finder__choices" disabled={copying}>
        <legend className="wc-sr-only">국가·지역 선택</legend>
        {result.rows.map(row => <label className="admin-country-finder__choice" key={row.code} data-selected={row.code === selectedCode || undefined}>
          <input type="radio" name="countryNameChoice" value={row.code} checked={row.code === selectedCode} onChange={() => select(row.code)} />
          <span><strong>{row.name}</strong><small>{row.english}</small></span><span className="admin-country-finder__code">{row.code} · {row.alpha3}</span>
        </label>)}
        {!result.rows.length && <p>일치하는 국가·지역이 없습니다. 원산지는 직접 입력할 수도 있습니다.</p>}
      </fieldset>
      <nav className="admin-country-finder__actions" aria-label="국가·지역 목록 페이지">
        <button type="button" className="wc-admin-kit__button" disabled={copying || result.page <= 1} onClick={() => setPage(result.page - 1)}>이전</button>
        <span>{result.page} / {result.pages}</span>
        <button type="button" className="wc-admin-kit__button" disabled={copying || result.page >= result.pages} onClick={() => setPage(result.page + 1)}>다음</button>
      </nav>
      </> : <div className="admin-country-finder__domestic">
        <p>시·도만 선택하거나 시·군·구까지 지정할 수 있습니다.</p>
        <label>시·도<select value={provinceCode} disabled={copying} onChange={event => {
          setProvinceCode(event.target.value); setDistrictCode(''); setMessage(''); setError(false);
        }}>
          <option value="">시·도를 선택해주세요</option>
          {KOREAN_PROVINCES.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
        </select></label>
        {province && (province.districts.length ? <label>시·군·구 (선택)<select value={districtCode} disabled={copying} onChange={event => {
          setDistrictCode(event.target.value); setMessage(''); setError(false);
        }}>
          <option value="">{province.name}만 사용</option>
          {province.districts.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
        </select></label> : <p>세종특별자치시는 시·도 선택으로 완료됩니다.</p>)}
      </div>}
      <div className="admin-country-finder__selection">
        {props.mode === 'apply' && <p>현재 원산지: <strong>{props.currentValue || '입력 안 함'}</strong></p>}
        <label>선택한 입력값<input readOnly value={selectedValue} onFocus={event => event.target.select()} placeholder="국가·지역 또는 국내 상세지역을 선택해주세요" /></label>
        {blocked && <p role="status">현재 상품 상태에서는 원산지를 바꿀 수 없습니다.</p>}
        {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
        <div className="admin-country-finder__actions">
          <button type="button" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={!selectedValue || blocked || copying} onClick={() => void confirm()}>
            {props.mode === 'copy' ? copying ? '복사 중…' : '제조국 값 복사' : '현재 입력에 적용'}
          </button>
          <button type="button" className="wc-admin-kit__button" onClick={props.onClose}>취소</button>
        </div>
      </div>
      <p className="admin-country-finder__source">{scope === 'country' ? <><a href={COUNTRY_NAME_SOURCE.url} target="_blank" rel="noreferrer">국가명: Unicode CLDR</a><a href={COUNTRY_NAME_SOURCE.licenseUrl} target="_blank" rel="noreferrer">라이선스</a></> : <a href={KOREAN_REGION_SOURCE.url} target="_blank" rel="noreferrer">국내 지역: 국토교통부 · {KOREAN_REGION_SOURCE.version}</a>}</p>
    </section>
  </CustomerServiceDialog>;
}

/** Keep the existing editable text field and write only its selected Korean name. */
export function GoodsOriginField({ defaultValue, error, label, readOnly, required, disabled }: {
  defaultValue: string; error?: string; label: string; readOnly: boolean; required: boolean; disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [currentValue, setCurrentValue] = useState<string | null>(null), [message, setMessage] = useState('');
  const blocked = disabled || readOnly;
  function input() { return root.current?.querySelector<HTMLInputElement>('input[name="noticeOrigin"]'); }
  return <div className="admin-country-origin-field" ref={root}>
    <Field defaultValue={defaultValue} error={error} label={label} name="noticeOrigin" placeholder="대한민국" readOnly={readOnly} required={required} />
    <button type="button" className="wc-admin-kit__button" disabled={blocked} onClick={() => { const field = input(); if (!blocked && field) { setCurrentValue(field.value); setMessage(''); } }}>원산지 국가·지역 찾기</button>
    {message && <p role="status">{message}</p>}
    {currentValue !== null && <CountryNamePicker mode="apply" currentValue={currentValue} disabled={blocked} onClose={() => setCurrentValue(null)} onApply={name => {
      const field = input();
      if (blocked || !field || field.readOnly || field.disabled) return false;
      field.value = name;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      setMessage(`${name} 입력을 적용했습니다. 상품 저장 후 반영됩니다.`);
      return true;
    }} />}
  </div>;
}
