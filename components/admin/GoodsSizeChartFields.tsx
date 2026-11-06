'use client';

import { useId } from 'react';
import { GOODS_SIZE_LIMITS, type GoodsSizeChart } from '@/lib/goods-size-chart';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

/*
 * 사이즈표 입력 — 템플릿 룩(ADR-0028). 상품 사이즈 안내·사이즈 템플릿·그룹 공통정보(C 트랙)가 같이 쓴다.
 * 표는 칸마다 입력이 있어 좁은 화면에서 줄이지 않고 표 안에서 가로로 이동한다.
 */
const CELL_CLASS = 'min-w-28 max-w-64 px-3 py-2 align-top whitespace-normal';

export function GoodsSizeChartFields({ chart, onChange }: { chart: GoodsSizeChart; onChange: (chart: GoodsSizeChart) => void }) {
  const id = useId();
  const updateSize = (index: number, value: string) => onChange({ ...chart, sizes: chart.sizes.map((size, at) => at === index ? value : size) });
  const removeSize = (index: number) => onChange({ ...chart, sizes: chart.sizes.filter((_, at) => at !== index), measurements: chart.measurements.map(row => ({ ...row, values: row.values.filter((_, at) => at !== index) })) });
  const addSize = () => onChange({ ...chart, sizes: [...chart.sizes, ''], measurements: chart.measurements.map(row => ({ ...row, values: [...row.values, ''] })) });
  const updateRow = (index: number, change: Partial<GoodsSizeChart['measurements'][number]>) => onChange({ ...chart, measurements: chart.measurements.map((row, at) => at === index ? { ...row, ...change } : row) });
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-size-chart-fields="">
    <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={`${id}-unit`}>치수 단위</Label><NativeSelect className="w-full sm:w-32" id={`${id}-unit`} value={chart.unit} onChange={event => onChange({ ...chart, unit: event.target.value as 'cm' | 'mm' })}><option value="cm">cm</option><option value="mm">mm</option></NativeSelect></div>
    <p id={`${id}-guide`} className="text-sm text-muted-foreground">단위를 바꿔도 입력한 숫자는 변환되지 않습니다. 사이즈명 10자·10개, 측정 항목명 20자·10개까지 입력합니다. 치수는 0.1~99,999, 소수 한 자리까지 입력해주세요.</p>
    {chart.sizes.length ? <>
      <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="사이즈 입력표 가로 스크롤" tabIndex={0}>
        <Table aria-describedby={`${id}-guide`} className="min-w-[32.5rem]"><TableCaption className="sr-only">사이즈별 치수 입력</TableCaption>
          <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead scope="col" className="min-w-36 px-3">측정 항목</TableHead>{chart.sizes.map((size, index) => <TableHead key={index} scope="col" className={`${CELL_CLASS} h-auto`}><div className="flex flex-col gap-1.5"><label><span className="sr-only">사이즈명 {index + 1}</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={size} onChange={event => updateSize(index, event.target.value)} placeholder="사이즈명" /></label><button type="button" className={`${buttonVariants({ variant: 'outline', size: 'xs' })} self-start`} data-slot="button" aria-label={`사이즈 ${index + 1} 삭제`} disabled={chart.sizes.length <= 1} onClick={() => removeSize(index)}>삭제</button></div></TableHead>)}<TableHead scope="col" className="px-3">행 관리</TableHead></TableRow></TableHeader>
          <TableBody>{chart.measurements.map((row, rowIndex) => <TableRow key={rowIndex} className="hover:bg-transparent">
            <TableHead scope="row" className={`${CELL_CLASS} h-auto min-w-36`}><label><span className="sr-only">측정 항목명 {rowIndex + 1}</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={row.name} onChange={event => updateRow(rowIndex, { name: event.target.value })} placeholder="측정 항목명" /></label></TableHead>
            {row.values.map((value, columnIndex) => <TableCell key={columnIndex} className={CELL_CLASS}><label><span className="sr-only">{row.name || `측정 항목 ${rowIndex + 1}`} · {chart.sizes[columnIndex] || `사이즈 ${columnIndex + 1}`} 치수</span><input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" inputMode="decimal" type="text" maxLength={32} value={value} onChange={event => updateRow(rowIndex, { values: row.values.map((cell, at) => at === columnIndex ? event.target.value : cell) })} /></label></TableCell>)}
            <TableCell className="px-3 py-2 align-top"><button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" aria-label={`측정 항목 ${rowIndex + 1} 삭제`} disabled={chart.measurements.length <= 1} onClick={() => onChange({ ...chart, measurements: chart.measurements.filter((_, index) => index !== rowIndex) })}>삭제</button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap gap-2"><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={chart.sizes.length >= GOODS_SIZE_LIMITS.sizes} onClick={addSize}>사이즈 추가</button><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={chart.measurements.length >= GOODS_SIZE_LIMITS.measurements} onClick={() => onChange({ ...chart, measurements: [...chart.measurements, { name: '', values: chart.sizes.map(() => '') }] })}>측정 항목 추가</button></div>
      <label className="flex min-w-0 flex-col gap-2 text-sm"><span className="font-medium">측정 안내 (선택 · 500자)</span><textarea className={`${GOOD_TEXTAREA_CLASS} resize-y`} data-slot="textarea" rows={3} value={chart.note} onChange={event => onChange({ ...chart, note: event.target.value })} /><small className="self-end text-xs text-muted-foreground tabular-nums">{Array.from(chart.note).length} / 500자</small></label>
    </> : <div className="flex min-w-0 flex-col items-start gap-3 rounded-lg border border-dashed p-4"><p className="text-sm text-muted-foreground">등록된 사이즈표가 없습니다. 표를 작성하거나 템플릿을 불러오세요.</p><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" onClick={() => onChange({ ...chart, sizes: [''], measurements: [{ name: '', values: [''] }] })}>표 작성 시작</button></div>}
  </div>;
}
