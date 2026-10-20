import type { ShippingSettingsChargeGroup } from '@/lib/admin/shipping-settings-templates';
import type { ShippingChargeGroupSummary } from '@/lib/admin/shipping-charge-groups';
import { shippingFixtures, shippingIds } from './shipping-settings';

export function shippingChargeSettingsFixtures(mode: ShippingSettingsChargeGroup['mode'] = 'assign') {
  const base = shippingFixtures();
  const group: ShippingChargeGroupSummary = { id: '92000000-0000-4000-8000-000000000081', originId: shippingIds.origin,
    revision: 2, name: '합성 최소부과', enabled: true, archived: false, calculationMode: 'min', regionalMode: 'inherit' };
  const previousVersion = '92000000-0000-4000-8000-000000000082';
  const newVersion = '92000000-0000-4000-8000-000000000083';
  const chargeGroup: ShippingSettingsChargeGroup = mode === 'assign' ? { mode, groupId: group.id } : { mode };
  const settings = { ...base.settings, chargeGroup }, template = { ...base.template, settings };
  const wasAssigned = mode !== 'assign';
  const guard = { ...base.guard, assignmentRevision: wasAssigned ? 1 : 0, assignmentVersionId: wasAssigned ? previousVersion : null,
    groupId: wasAssigned ? group.id : null, groupRevision: wasAssigned ? group.revision : null };
  const afterGroup = mode === 'clear' ? null : group;
  const preview = { ...base.preview, template, targetGroup: mode === 'assign' ? group : null,
    goods: [{ ...base.preview.goods[0], ...guard, after: settings,
      effectiveBefore: { ...base.effective, chargeGroup: wasAssigned ? group : null },
      effectiveAfter: { ...base.effective, chargeGroup: afterGroup } }] };
  const apply = { ...base.apply, targetGroup: mode === 'assign' ? { id: group.id, revision: group.revision } : null, goods: [guard] };
  const applied = { ...base.applied, chargeGroupVersion: 1 as const, template, goods: [{ ...base.applied.goods[0],
    assignmentRevision: mode === 'preserve' ? guard.assignmentRevision : guard.assignmentRevision + 1,
    assignmentVersionId: mode === 'preserve' ? previousVersion : newVersion,
    groupId: afterGroup?.id ?? null, groupRevision: afterGroup?.revision ?? null }] };
  const save = { ...base.save, settings }, saved = { ...base.saved, template };
  return { ...base, group, guard, settings, template, preview, apply, applied, save, saved };
}
