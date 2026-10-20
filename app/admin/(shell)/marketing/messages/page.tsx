import { MarketingMessagesScreen } from '@/components/admin/screens/MarketingMessagesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { MARKETING_MESSAGES_PATH, normalizeMarketingFilters } from '@/lib/admin/marketing-messages';
import { loadMarketingMessages } from '@/lib/admin/marketing-messages.server';
export default async function MarketingMessagesPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}={}){
 await requireAdminScreenAccess(MARKETING_MESSAGES_PATH,{capability:'marketing.manage'});const filters=normalizeMarketingFilters(await searchParams??{}),data=await loadMarketingMessages(filters);return <MarketingMessagesScreen key={JSON.stringify(data.filters)} data={data} />;
}
