import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Download } from 'lucide-react';
import { ConsoleGrid } from '@/components/admin/console';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { STATS_NOTE } from '@/components/admin/StatsSummary';
import { DEMOGRAPHIC_GENDER_LABELS } from '@/lib/customer-demographics';
import { DEMOGRAPHIC_AGE_LABELS, DEMOGRAPHIC_REPORT_NOTICE, demographicCount, demographicHref, type DemographicAgeBand, type DemographicFilters, type DemographicReport, type DemographicReportGender } from '@/lib/admin/customer-demographics';
import { CustomerDemographicFilters } from '@/components/admin/CustomerDemographicFilters';

/* 성별 범례·막대 색(kit 차트 토큰, ADR-0028). 정확한 값은 아래 표가 진실원이다. */
const GENDER_COLORS: Record<DemographicReportGender, string> = {
  female: 'var(--chart-5)',
  male: 'var(--chart-3)',
  other: 'var(--chart-2)',
  undisclosed: 'var(--chart-1)',
};
const barColor = (gender: DemographicReportGender) => ({ '--demographic-color': GENDER_COLORS[gender] }) as CSSProperties;

export function CustomerDemographicsScreen({ filters, data }: { filters: DemographicFilters; data: DemographicReport | null }) {
  const genders = Object.keys(DEMOGRAPHIC_GENDER_LABELS) as DemographicReportGender[];
  const bands = Object.keys(DEMOGRAPHIC_AGE_LABELS) as DemographicAgeBand[];
  const count = (band: DemographicAgeBand, gender: DemographicReportGender) => data?.cells.find(cell => cell.ageBand === band && cell.gender === gender)?.count ?? null;
  const maximum = Math.max(1, ...data?.cells.map(cell => cell.count ?? 0) ?? []);
  return <div className="flex min-w-0 flex-col gap-4" data-stats-screen="demographics">
    <h2 className="text-lg leading-tight font-semibold tracking-tight">성별·연령별 고객 분석</h2>
    <CustomerDemographicFilters key={JSON.stringify(filters)} filters={filters} now={data?.asOf ?? new Date().toISOString()} />
    <p className={STATS_NOTE}>현재 가입 회원은 조회 시점의 회원으로 집계하며 기간 입력은 적용하지 않습니다. 결제 고객은 마감된 주·월의 실제 승인·입금 이력을 기준으로 한 번씩 집계하고, 이후 취소·환불도 포함합니다.</p>
    {filters.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{filters.error}</p> : null}
    {data ? <>
      <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{data.scope === 'members' ? '현재 가입 회원' : `${data.from} ~ ${data.to} 결제 고객`} · 연령 기준일 {data.ageAsOf} (KST)</p>
        <p>성별은 현재 선택 동의를 유지한 회원의 자가 입력값만 사용합니다. 결제 고객은 해당 동의 이후의 결제가 있어야 성별로 분류합니다. 미제공은 성별 미선택·철회·동의 전 결제이며, 0명이나 특정 성별로 추정하지 않습니다. 정지·탈퇴 신청 계정은 제외합니다.</p>
        <p id="demographic-protection">{DEMOGRAPHIC_REPORT_NOTICE}</p>
      </div>
      <section aria-labelledby="demographic-chart-title" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium" id="demographic-chart-title">고객 구성</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{genders.map(gender => <span className="inline-flex items-center gap-1.5" data-gender={gender} key={gender}><span aria-hidden="true" className="size-2.5 rounded-sm bg-(--demographic-color) forced-colors:bg-[CanvasText]" style={barColor(gender)} />{DEMOGRAPHIC_GENDER_LABELS[gender]}</span>)}</div>
        </div>
        <div aria-label="성별·연령별 인원 차트. 정확한 값과 비공개 여부는 아래 표에서 확인하세요." className="grid grid-cols-1 gap-x-8 gap-y-1 xl:grid-cols-2" role="img">
          {bands.map(band => <div className="grid gap-2 border-b py-2.5 last:border-b-0 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3 xl:[&:nth-last-child(2)]:border-b-0" key={band}><strong className="text-sm font-medium">{DEMOGRAPHIC_AGE_LABELS[band]}</strong><div className="flex flex-col gap-1">{genders.map(gender => {
            const amount = count(band, gender);
            return <div className="grid min-h-6 grid-cols-[2.5rem_minmax(0,1fr)_4rem] items-center gap-2 text-xs sm:grid-cols-[3rem_minmax(0,1fr)_5.5rem] sm:gap-3" data-gender={gender} key={gender}><span className="text-muted-foreground">{DEMOGRAPHIC_GENDER_LABELS[gender]}</span>
              <span className="block h-2.5 min-w-0 overflow-hidden rounded-full bg-muted"><i className="block h-full rounded-full bg-(--demographic-color) forced-colors:bg-[CanvasText]" style={{ ...barColor(gender), width: amount === null ? 0 : `${amount / maximum * 100}%` }} /></span><span className="text-right tabular-nums">{demographicCount(amount)}</span></div>;
          })}</div></div>)}
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-medium">조회 결과</h3><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={demographicHref(filters, '/api/admin/customer-demographics-workbook')}><Download aria-hidden="true" />성별·연령 통계 엑셀 다운로드</Link></div>
      <ConsoleGrid caption="성별·연령별 고객수 · 10명 미만 비공개" columns={[{ key: 'age', label: '연령대', width: '140px' },
        ...genders.map(gender => ({ key: gender, label: DEMOGRAPHIC_GENDER_LABELS[gender], width: '120px', align: 'end' as const }))]}
        rows={bands.map(band => ({ id: band, cells: [DEMOGRAPHIC_AGE_LABELS[band], ...genders.map(gender => demographicCount(count(band, gender)))] }))} />
    </> : null}
  </div>;
}
