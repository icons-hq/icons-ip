import { timingSafeEqual } from 'node:crypto';
import { processMarketingMessages } from '@/lib/marketing-messages-jobs.server';
import { startCronRun } from '@/lib/system-health/cron-run.server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request){const secret=process.env.CRON_SECRET,expected=Buffer.from(secret||''),authorization=request.headers.get('authorization'),actual=Buffer.from(authorization?.startsWith('Bearer ')?authorization.slice(7):'');
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({ok:false},{status:401,headers});
 const run=startCronRun('marketing-messages');
 try{return run.finish(Response.json({ok:true,...await processMarketingMessages()},{headers}));}catch(error){return run.fail(error,Response.json({ok:false},{status:503,headers}));}
}
