import { notFound } from 'next/navigation';
import { MarketingMessageEditorScreen } from '@/components/admin/screens/MarketingMessageEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { MARKETING_MESSAGES_PATH } from '@/lib/admin/marketing-messages';
import { loadMarketingMessage, loadMarketingProducts } from '@/lib/admin/marketing-messages.server';
import { loadCustomerSegment } from '@/lib/admin/customer-segments.server';
import { isUuid } from '@/lib/uuid';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
export default async function NewMarketingMessagePage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}={}){
 const auth=await requireAdminScreenAccess(MARKETING_MESSAGES_PATH,{capability:'marketing.manage'});
 const session=await (await createClient()).auth.getSession();const sessionId=session.data.session?.user.id===auth.user.id?inquiryDraftSessionId(session.data.session.access_token):null;const query=await searchParams??{},copyId=Array.isArray(query.copy)?query.copy[0]:query.copy;if(copyId&&!isUuid(copyId))notFound();const detail=copyId?await loadMarketingMessage(copyId):null;if(copyId&&!detail)notFound();const segment=detail?await loadCustomerSegment(detail.segmentId):null;
 return <MarketingMessageEditorScreen actorId={auth.user.id} sessionId={sessionId} key={copyId??'new'} detail={detail} initialSegment={segment?.segment??null} initialProducts={detail?await loadMarketingProducts(detail.content.goodIds):[]} copy={!!copyId} />;
}
