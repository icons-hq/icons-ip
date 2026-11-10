import { notFound } from 'next/navigation';
import { MarketingMessageEditorScreen } from '@/components/admin/screens/MarketingMessageEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { MARKETING_MESSAGES_PATH } from '@/lib/admin/marketing-messages';
import { loadMarketingMessage, loadMarketingProducts } from '@/lib/admin/marketing-messages.server';
import { loadCustomerSegment } from '@/lib/admin/customer-segments.server';
import { isUuid } from '@/lib/uuid';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
export default async function MarketingMessagePage({params}:{params:Promise<{messageId:string}>}){
 const auth=await requireAdminScreenAccess(MARKETING_MESSAGES_PATH,{capability:'marketing.manage'});
 const session=await (await createClient()).auth.getSession();const sessionId=session.data.session?.user.id===auth.user.id?inquiryDraftSessionId(session.data.session.access_token):null;const {messageId}=await params;if(!isUuid(messageId))notFound();const detail=await loadMarketingMessage(messageId);if(!detail)notFound();const segment=detail.state==='draft'?await loadCustomerSegment(detail.segmentId):null;
 return <MarketingMessageEditorScreen actorId={auth.user.id} sessionId={sessionId} key={`${messageId}:${detail.revision}:${JSON.stringify(detail.runs)}`} detail={detail} initialSegment={segment?.segment??null} initialProducts={detail?await loadMarketingProducts(detail.content.goodIds):[]} />;
}
