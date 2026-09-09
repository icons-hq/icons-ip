import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ guard:vi.fn(),origins:vi.fn(),settings:vi.fn() }));
vi.mock('@/lib/admin/guard.server',()=>({requireAdminScreenAccess:mocks.guard}));
vi.mock('@/lib/admin/fulfillment-origins.server',()=>({loadAdminFulfillmentOrigins:mocks.origins}));
vi.mock('@/lib/admin/store-settings.server',()=>({loadAdminStoreSettings:mocks.settings}));
vi.mock('@/components/admin/screens/FulfillmentOriginsScreen',()=>({FulfillmentOriginsScreen:()=>null}));
beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({role:'staff'});mocks.origins.mockResolvedValue([]);mocks.settings.mockResolvedValue({carriers:[],history:[]});});
it('checks route access before any settings read',async()=>{
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.origins).not.toHaveBeenCalled();
  expect(mocks.settings).not.toHaveBeenCalled();
});
it('keeps staff read-only and forwards only origin history',async()=>{
  mocks.settings.mockResolvedValue({carriers:[],history:[{action:'admin.fulfillment_origin.saved',id:'origin'},{action:'admin.store_settings.saved',id:'store'}]});
  const result=await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/origins');
  expect(result.props.canEdit).toBe(false);
  expect(result.props.history).toEqual([{action:'admin.fulfillment_origin.saved',id:'origin'}]);
});
