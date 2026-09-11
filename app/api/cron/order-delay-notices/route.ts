import {timingSafeEqual} from 'node:crypto';
import {processOrderDelayEmails} from '@/lib/email/order-delay-jobs.server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;const authorization=request.headers.get('authorization');
 const expected=Buffer.from(secret||'');const actual=Buffer.from(authorization?.startsWith('Bearer ')?authorization.slice(7):'');
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({ok:false},{status:401,headers});
 try{
  const result=await processOrderDelayEmails();const ok=!result.failed&&!result.unknown&&!result.stale;
  return Response.json({ok,...result},{status:ok?200:503,headers});
 }catch{return Response.json({ok:false},{status:503,headers});}
}
