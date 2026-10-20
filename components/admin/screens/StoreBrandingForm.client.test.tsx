import type { FormEvent, ReactElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
const mocks=vi.hoisted(()=>({save:vi.fn(),states:[] as unknown[],index:0,tasks:[] as Promise<void>[]}));
vi.mock('@/app/admin/store-branding-actions',()=>({saveStoreBrandingAction:mocks.save}));
vi.mock('react',async()=>{
  const actual=await vi.importActual<typeof import('react')>('react');
  return {...actual,
    useState:(initial:unknown)=>{
      const index=mocks.index++;
      if (!(index in mocks.states)) mocks.states[index]=initial;
      return [mocks.states[index],(next:unknown)=>{mocks.states[index]=typeof next==='function'?next(mocks.states[index]):next;}];
    },
    useTransition:()=>[false,(action:()=>Promise<void>)=>{mocks.tasks.push(action());}],
  };
});
import { StoreBrandingForm } from './StoreBrandingForm';
import { DEFAULT_STORE_BRANDING } from '@/lib/store-branding';
const initialStamp='2026-10-12T01:00:00.000001Z';
const operation='00000000-0000-4000-8000-000000016001';
const settings:StoreSettingsSnapshot={business:{},bankTransfer:null,inquiryAutoReplies:{order:{enabled:false,body:''},claim:{enabled:false,body:''},good:{enabled:false,body:''},account:{enabled:false,body:''},etc:{enabled:false,body:''}},branding:{...DEFAULT_STORE_BRANDING,displayName:'유지할 브랜드'},updatedAt:initialStamp};
function form(updatedAt=initialStamp) {
  mocks.index=0;
  return StoreBrandingForm({settings:{...settings,updatedAt},canEdit:true,operationId:operation}) as ReactElement<{onSubmit:(event:FormEvent<HTMLFormElement>)=>void}>;
}
function submit(element:ReturnType<typeof form>) {
  // No file is selected in this case; FormData(undefined) represents empty logo slots.
  element.props.onSubmit({preventDefault:vi.fn(),currentTarget:undefined} as unknown as FormEvent<HTMLFormElement>);
  return mocks.tasks.at(-1);
}
beforeEach(()=>{mocks.states=[];mocks.index=0;mocks.tasks=[];mocks.save.mockReset();});
it('전송 promise 실패는 폼을 보존하고 외부 새 버전이 와도 같은 요청으로 재시도한다',async()=>{
  mocks.save.mockRejectedValueOnce(new Error('network lost'));
  await expect(submit(form())).resolves.toBeUndefined();
  expect(mocks.states[3]).toMatchObject({error:expect.stringContaining('입력값을 유지')});
  expect(mocks.states[0]).toMatchObject({displayName:'유지할 브랜드'});
  mocks.save.mockResolvedValueOnce({message:'저장했습니다.',updatedAt:'2026-10-12T03:00:00.000001Z'});
  await submit(form('2026-10-12T02:00:00.000001Z'));
  expect(mocks.save.mock.calls).toHaveLength(2);
  for(const [payload,stamp,id] of mocks.save.mock.calls) {
    expect(payload.displayName).toBe('유지할 브랜드');expect(stamp).toBe(initialStamp);expect(id).toBe(operation);
  }
  expect(mocks.states[1]).toBe('2026-10-12T03:00:00.000001Z');
});
it('대표 이미지 경로는 저장 실패에도 유지하고 성공 후 다음 요청 ID를 새로 만든다',async()=>{
  const imagePath='public-media/catalog/curation/00000000-0000-4000-8000-000000026001.png';
  const NativeFormData=globalThis.FormData;
  vi.stubGlobal('FormData',class extends NativeFormData {constructor(){super();this.set('profileImagePath',imagePath);}});
  try {
    form();mocks.states[0]={...settings.branding,profileImagePath:imagePath};
    mocks.save.mockResolvedValueOnce({error:'대표 이미지는 160×160px 이상의 정사각형이어야 합니다.'});
    await submit(form());
    expect(mocks.states[0]).toMatchObject({profileImagePath:imagePath});expect(mocks.states[1]).toBe(initialStamp);expect(mocks.states[2]).toBe(operation);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({profileImagePath:imagePath,logoPath:null,mobileLogoPath:null});
    mocks.save.mockResolvedValueOnce({updatedAt:'2026-10-12T03:00:00.000001Z'});
    await submit(form());
    expect(mocks.save.mock.calls[1][2]).toBe(operation);expect(mocks.states[2]).not.toBe(operation);
    mocks.save.mockResolvedValueOnce({updatedAt:'2026-10-12T04:00:00.000001Z'});
    await submit(form());
    expect(mocks.save.mock.calls[2][1]).toBe('2026-10-12T03:00:00.000001Z');expect(mocks.save.mock.calls[2][2]).not.toBe(operation);
  } finally {vi.unstubAllGlobals();}
});
