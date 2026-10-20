'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { saveDetailExperienceAction, type ExperienceSaveResult } from '@/app/admin/product-detail-experience-actions';
import { PRODUCT_DETAIL_EXPERIENCE_PATH, type DetailExperienceSnapshot, type DetailExperiences, type ExperienceSection, type PurchaseMessages } from '@/lib/product-detail-experiences';

export function DetailExperienceScreen({ snapshot, section }: { snapshot: DetailExperienceSnapshot; section: ExperienceSection }) {
  return <section className="wc-admin-kit wc-admin-kit__screen admin-detail-experience">
    <AdminPageHeader title="상품상세 구매·탐색 설정" description="실제 구매 실적과 배송비, 본인의 관심상품을 상품상세에 연결합니다." />
    <nav aria-label="상품상세 추가 설정" className="admin-detail-experience__tabs">
      <Link href={PRODUCT_DETAIL_EXPERIENCE_PATH} aria-current={section === 'messages' ? 'page' : undefined}>구매유도 메시지</Link>
      <Link href={`${PRODUCT_DETAIL_EXPERIENCE_PATH}?tab=discovery`} aria-current={section === 'discovery' ? 'page' : undefined}>배송비·관심상품</Link>
      <Link href="/admin/display/detail">띠배너·리뷰·추천</Link>
      <Link href="/admin/display/detail/media">대표미디어 설정</Link>
    </nav>
    <ExperienceForm key={section} snapshot={snapshot} section={section} />
  </section>;
}
function ExperienceForm({ snapshot, section }: { snapshot: DetailExperienceSnapshot; section: ExperienceSection }) {
  const [values, setValues] = useState(snapshot.values), [revision, setRevision] = useState(snapshot.revisions[section]);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ id: string; values: DetailExperiences[ExperienceSection]; revision: number } | null>(null);
  const messages = values.messages;
  const change = <K extends keyof PurchaseMessages>(key: K, value: PurchaseMessages[K]) => setValues(current => ({ ...current, messages: { ...current.messages, [key]: value } }));
  async function save() {
    if (pending || snapshot.unavailable) return;
    request.current ??= { id: crypto.randomUUID(), values: values[section], revision };
    setPending(true); setMessage(''); let result: ExperienceSaveResult;
    try { result = await saveDetailExperienceAction(section, request.current.values, request.current.revision, request.current.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setValues(current => ({ ...current, [section]: result.values })); setRevision(result.revision); request.current = null; setUncertain(false); setError(false); setMessage('저장했습니다. 상품상세에 적용되었습니다.'); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    {snapshot.unavailable ? <p role="alert">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    <AdminSectionCard title={section === 'messages' ? '구매유도 메시지' : '배송비·관심상품'}>
      <fieldset disabled={pending || uncertain || snapshot.unavailable} className="admin-detail-experience__fields">
        {section === 'messages' ? <>
          <label><input type="checkbox" checked={messages.buyers} onChange={event => change('buyers', event.target.checked)} /><span>구매자수 표시<small>같은 상품을 구매한 서로 다른 고객 수입니다. 오늘 → 최근 7일 → 6개월 → 1년 순으로 기준 인원을 충족하는 가장 짧은 기간을 표시합니다.</small></span></label>
          <label className="admin-detail-experience__number">구매자수 노출 기준<input aria-label="구매자수 노출 기준" type="number" min="10" max="1000" value={messages.minBuyers} onChange={event => change('minBuyers', Number(event.target.value))} />명 이상</label>
          <label><input type="checkbox" checked={messages.twoYears} onChange={event => change('twoYears', event.target.checked)} /><span>최근 2년 구매자수까지 사용<small>1년 내 기준 인원이 부족하면 최근 2년 구매자가 1명 이상일 때 표시합니다. 이때는 입력한 기준 인원을 적용하지 않습니다.</small></span></label>
          <label><input type="checkbox" checked={messages.repeatBuyers} onChange={event => change('repeatBuyers', event.target.checked)} /><span>재구매자수 표시<small>해당 기간에 이 상품을 서로 다른 주문으로 2번 이상 구매한 고객 수입니다. 최근 3개월 → 6개월 → 1년 순으로 확인합니다.</small></span></label>
          <label className="admin-detail-experience__number">재구매자수 노출 기준<input aria-label="재구매자수 노출 기준" type="number" min="10" max="1000" value={messages.minRepeatBuyers} onChange={event => change('minRepeatBuyers', Number(event.target.value))} />명 이상</label>
          <label><input type="checkbox" checked={messages.bestSeller} onChange={event => change('bestSeller', event.target.checked)} /><span>베스트 상품 표시<small>오늘을 제외한 한국 시각 직전 3일의 확정 판매수량으로 공개 상품 상위 10개에 실제 순위를 표시합니다. 동률은 상품코드 순입니다.</small></span></label>
          <label><input type="checkbox" checked={messages.newProduct} onChange={event => change('newProduct', event.target.checked)} /><span>신상품 표시<small>최초 등록 시각부터 7일 동안 표시합니다.</small></span></label>
          <p className="admin-detail-experience__note">서버 결제 확정과 완료 취소·반품을 반영합니다. 방문수·장바구니 수를 구매자로 계산하지 않으며, 조건이 부족한 문구는 숨깁니다.</p>
        </> : <>
          <label><input type="checkbox" checked={values.discovery.shippingSavings} onChange={event => setValues(current => ({ ...current, discovery: { ...current.discovery, shippingSavings: event.target.checked } }))} /><span>배송비 절약상품 표시<small>상품상세에서 옵션·수량을 선택하면 실제 주문서 계산으로 개별 주문 대비 묶음 배송비가 줄어드는 상품을 보여줍니다. 지역 추가배송비와 쿠폰은 제외한 비교입니다.</small></span></label>
          <label><input type="checkbox" checked={values.discovery.interests} onChange={event => setValues(current => ({ ...current, discovery: { ...current.discovery, interests: event.target.checked } }))} /><span>관심상품 모아보기 표시<small>본인의 재구매·장바구니·찜과 이 브라우저의 최근 본 상품입니다. 끄면 상품상세와 별도 모아보기 진입점을 함께 숨깁니다.</small></span></label>
          <p className="admin-detail-experience__note">재구매는 최근 2년 내 확정 주문 2건 이상인 상품입니다. 최근 본 상품은 계정별로 이 브라우저에 상품코드 최대 30개만 저장하며 분석·마케팅 원장에 기록하지 않습니다.</p>
        </>}
      </fieldset>
    </AdminSectionCard>
    <div className="admin-detail-experience__save">{message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}<button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || Boolean(snapshot.unavailable)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</button></div>
  </form>;
}
