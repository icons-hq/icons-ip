import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

/** This bare route deliberately has no React layout, analytics or media. The
 * fragment is removed synchronously before even the claim-session request. */
export async function GET() {
  const nonce = randomBytes(18).toString('base64');
  const bootstrap = `(async()=>{const fragment=location.hash;history.replaceState(null,'',location.pathname);const status=document.getElementById('gift-status');let token='';try{token=new URLSearchParams(fragment.slice(1)).get('token')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error();const response=await fetch('/api/gifts/claim-session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token})});token='';if(!response.ok)throw Error();location.replace('/gifts/receive/session')}catch{token='';status.textContent='사용할 수 없는 선물 링크입니다. 보낸 사람에게 새 링크를 요청해주세요.'}})();`;
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>선물 확인 — ICONS</title></head><body><main><h1>선물 확인</h1><p id="gift-status" role="status">선물 링크를 확인하고 있습니다.</p><noscript>선물 확인에는 자바스크립트가 필요합니다.</noscript></main><script nonce="${nonce}">${bootstrap}</script></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` },
  });
}
