import Link from 'next/link';
import { ConsoleGrid } from '@/components/admin/console';
import { DEMOGRAPHIC_GENDER_LABELS } from '@/lib/customer-demographics';
import { DEMOGRAPHIC_AGE_LABELS, DEMOGRAPHIC_REPORT_NOTICE, demographicCount, demographicHref, type DemographicAgeBand, type DemographicFilters, type DemographicReport, type DemographicReportGender } from '@/lib/admin/customer-demographics';
import '@/app/styles/admin-customer-demographics.css';
import { CustomerDemographicFilters } from '@/components/admin/CustomerDemographicFilters';

export function CustomerDemographicsScreen({ filters, data }: { filters: DemographicFilters; data: DemographicReport | null }) {
  const genders = Object.keys(DEMOGRAPHIC_GENDER_LABELS) as DemographicReportGender[];
  const bands = Object.keys(DEMOGRAPHIC_AGE_LABELS) as DemographicAgeBand[];
  const count = (band: DemographicAgeBand, gender: DemographicReportGender) => data?.cells.find(cell => cell.ageBand === band && cell.gender === gender)?.count ?? null;
  const maximum = Math.max(1, ...data?.cells.map(cell => cell.count ?? 0) ?? []);
  return <section className="admin-console admin-stats wc-admin-kit admin-customer-demographics">
    <h2>성별·연령별 고객 분석</h2>
    <CustomerDemographicFilters key={JSON.stringify(filters)} filters={filters} now={data?.asOf ?? new Date().toISOString()} />
    <p className="admin-note">현재 가입 회원은 조회 시점의 회원으로 집계하며 기간 입력은 적용하지 않습니다. 결제 고객은 마감된 주·월의 실제 승인·입금 이력을 기준으로 한 번씩 집계하고, 이후 취소·환불도 포함합니다.</p>
    {filters.error ? <p role="alert">{filters.error}</p> : null}
    {data ? <>
      <p className="admin-note">{data.scope === 'members' ? '현재 가입 회원' : `${data.from} ~ ${data.to} 결제 고객`} · 연령 기준일 {data.ageAsOf} (KST)</p>
      <p className="admin-note">성별은 현재 선택 동의를 유지한 회원의 자가 입력값만 사용합니다. 결제 고객은 해당 동의 이후의 결제가 있어야 성별로 분류합니다. 미제공은 성별 미선택·철회·동의 전 결제이며, 0명이나 특정 성별로 추정하지 않습니다. 정지·탈퇴 신청 계정은 제외합니다.</p>
      <p className="admin-note" id="demographic-protection">{DEMOGRAPHIC_REPORT_NOTICE}</p>
      <div className="admin-customer-demographics__chart-panel"><h3>고객 구성</h3>
      <div className="admin-customer-demographics__legend">{genders.map(gender => <span key={gender} data-gender={gender}>{DEMOGRAPHIC_GENDER_LABELS[gender]}</span>)}</div>
      <div className="admin-customer-demographics__chart" role="img" aria-label="성별·연령별 인원 차트. 정확한 값과 비공개 여부는 아래 표에서 확인하세요.">
        {bands.map(band => <div key={band} className="admin-customer-demographics__band"><strong>{DEMOGRAPHIC_AGE_LABELS[band]}</strong><div>{genders.map(gender => {
          const amount = count(band, gender);
          return <div className="admin-customer-demographics__bar-row" key={gender} data-gender={gender}><span>{DEMOGRAPHIC_GENDER_LABELS[gender]}</span>
            <span className="admin-customer-demographics__bar-track"><i style={{ width: amount === null ? 0 : `${amount / maximum * 100}%` }} /></span><span>{demographicCount(amount)}</span></div>;
        })}</div></div>)}
      </div>
      </div>
      <div className="admin-customer-demographics__export"><h3>조회 결과</h3><Link className="wc-admin-kit__button" href={demographicHref(filters, '/api/admin/customer-demographics-workbook')}>성별·연령 통계 엑셀 다운로드</Link></div>
      <ConsoleGrid caption="성별·연령별 고객수 · 10명 미만 비공개" columns={[{ key: 'age', label: '연령대', width: '140px' },
        ...genders.map(gender => ({ key: gender, label: DEMOGRAPHIC_GENDER_LABELS[gender], width: '120px', align: 'end' as const }))]}
        rows={bands.map(band => ({ id: band, cells: [DEMOGRAPHIC_AGE_LABELS[band], ...genders.map(gender => demographicCount(count(band, gender)))] }))} />
    </> : null}
  </section>;
}
