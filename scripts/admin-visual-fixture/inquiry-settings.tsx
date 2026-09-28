import { useState } from 'react';
import { StoreSettingsScreen } from '../../components/admin/screens/StoreSettingsScreen';
import type { StoreSettingsSnapshot } from '../../lib/admin/store-settings';
import { INITIAL_SETTINGS_STAMP,simulateSettingsRevision } from './store-settings-actions';
const initial:StoreSettingsSnapshot={business:{},bankTransfer:null,updatedAt:INITIAL_SETTINGS_STAMP,inquiryAutoReplies:{
  order:{enabled:false,body:''},claim:{enabled:false,body:''},good:{enabled:false,body:''},account:{enabled:false,body:''},etc:{enabled:false,body:''},
}};
export function InquirySettingsFixture() {
  const [settings,setSettings]=useState(initial);
  return <><button type="button" onClick={()=>{
    const updatedAt='2026-09-28T01:00:00Z';simulateSettingsRevision(updatedAt);
    setSettings({...settings,updatedAt,inquiryAutoReplies:{...settings.inquiryAutoReplies,order:{enabled:true,body:'다른 관리자가 저장한 안내'}}});
  }}>외부 설정 변경 재현</button>
    <StoreSettingsScreen settings={settings} carriers={[]} history={[]} section="inquiry_auto_replies"
      canEdit={new URLSearchParams(window.location.search).get('role')!=='staff'}/></>;
}
