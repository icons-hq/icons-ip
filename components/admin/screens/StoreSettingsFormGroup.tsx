import type { ReactNode } from 'react';

/**
 * 긴 설정 폼 안의 구역(기본 정보·배송비·반품처럼). 같은 모양의 입력칸이 한 덩어리로 이어지지 않게 묶음마다 머리를 둔다.
 * 묶음만 나눌 뿐 폼의 필드 이름·제출 값은 그대로다.
 */
export function SettingsFormGroup({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0" data-settings-group="">
    <header className="flex min-w-0 flex-col gap-0.5">
      {/* 묶음 제목은 입력칸 라벨(14px)보다 한 단계 커야 묶음이 잡힌다. */}
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </header>
    {children}
  </section>;
}

/**
 * 설정 폼의 저장 줄. 폼이 화면보다 길어도 저장 버튼이 화면 바닥 오른쪽에 남는다 — 설정 화면은 저장 자리가 같아야 찾지 않는다.
 * 카드 안쪽 여백(p-4 sm:p-5)을 밀어내 카드 폭 그대로 붙는다. 폼 뒤에 다른 구역이 이어지는 카드는 `lastInCard={false}`.
 * 저장 결과 안내도 이 줄에 넣는다 — 폼 끝에 두면 긴 폼의 위쪽을 보고 있을 때 결과가 보이지 않는다.
 */
export function SettingsSaveBar({ children, lastInCard = true }: { children: ReactNode; lastInCard?: boolean }) {
  return <div className={lastInCard
    ? 'sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t bg-card px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5'
    : 'sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-y bg-card px-4 py-3 sm:-mx-5 sm:px-5'} data-admin-savebar="">{children}</div>;
}
