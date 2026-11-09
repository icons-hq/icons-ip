import { ChevronRight } from 'lucide-react';

/** 몇 단계 중 어디인지 보이는 순서 표시(상품 일괄등록·상품속성). 누르는 버튼이 아니라 글자라 테두리를 두지 않는다. */
export function GoodsFlowSteps({ steps, current }: { steps: string[]; current: number }) {
  return <ol aria-label="진행 순서" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-goods-import="steps">
    {steps.map((step, index) => <li aria-current={index === current ? 'step' : undefined} className="flex items-center gap-2" key={step}>
      {index ? <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
      <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full text-xs font-semibold tabular-nums ${index === current ? 'bg-primary text-primary-foreground' : index < current ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>
      <span className={index === current ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{step}</span>
    </li>)}
  </ol>;
}
