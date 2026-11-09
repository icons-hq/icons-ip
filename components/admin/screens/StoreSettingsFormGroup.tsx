import type { ReactNode } from 'react';

/**
 * 긴 설정 폼 안의 구역(기본 정보·배송비·반품처럼). 같은 모양의 입력칸이 한 덩어리로 이어지지 않게 묶음마다 머리를 둔다.
 * 묶음만 나눌 뿐 폼의 필드 이름·제출 값은 그대로다.
 */
export function SettingsFormGroup({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0" data-settings-group="">
    <header className="flex min-w-0 flex-col gap-0.5">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </header>
    {children}
  </section>;
}
