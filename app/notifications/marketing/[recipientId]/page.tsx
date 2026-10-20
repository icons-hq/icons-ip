import { notFound, redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyMarketingMessage } from '@/lib/admin/marketing-messages.server';
import { isUuid } from '@/lib/uuid';
import { CustomerMarketingMessage } from '@/components/screens/CustomerMarketingMessage';
export const metadata={title:'마케팅 소식 — ICONS',robots:{index:false,follow:false}};
export default async function MarketingNotificationPage({params}:{params:Promise<{recipientId:string}>}){
 const {recipientId}=await params;if(!isUuid(recipientId))notFound();const path=`/notifications/marketing/${recipientId}`,auth=await getCurrentAuthState();if(!auth.user)redirect(`/login?next=${encodeURIComponent(path)}`);if(!isOnboarded(auth.profile,auth.user.email))redirect(onboardingPath(path));
 const message=await loadMyMarketingMessage(recipientId);if(!message)notFound();return <CustomerMarketingMessage message={message} />;
}
