'use client';

import { useActionState } from 'react';
import { setAdultGoodsVisibilityAction } from '@/app/admin/adult-goods-visibility-actions';
import { Button } from '@/components/admin/kit/ui/button';
import type { AdultGoodsVisibility } from '@/lib/adult-goods';

export function AdultGoodsVisibilityForm({ settings }: { settings: AdultGoodsVisibility }) {
  const [result, action, pending] = useActionState(setAdultGoodsVisibilityAction, {});
  return <form action={action} className="flex flex-col items-start gap-3">
    <input name="revision" type="hidden" value={settings.revision} />
    <fieldset className="flex flex-wrap gap-2" disabled={pending}>
      <legend className="mb-2 text-sm font-medium">
        현재 상태 · {settings.enabled ? '19 표시로 노출' : '모든 고객에게 숨김'}
      </legend>
      <Button type="submit" name="visibility" value="visible" aria-pressed={settings.enabled}
        disabled={settings.enabled || pending} variant={settings.enabled ? 'secondary' : 'outline'}>19 표시로 노출</Button>
      <Button type="submit" name="visibility" value="hidden" aria-pressed={!settings.enabled}
        disabled={!settings.enabled || pending} variant={settings.enabled ? 'outline' : 'secondary'}>모든 고객에게 숨김</Button>
    </fieldset>
    {result.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p>
      : <p role="status" className="text-sm text-muted-foreground">{pending ? '저장 중…' : result.message}</p>}
  </form>;
}
