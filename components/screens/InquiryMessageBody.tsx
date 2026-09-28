/** Automatic guidance accepts plain text and HTTPS FAQ links, never HTML. */
export function InquiryMessageBody({body,automatic=false}:{body:string;automatic?:boolean}) {
  if (!automatic) return <>{body}</>;
  return <>{body.split(/(https:\/\/[^\s<>"']+)/g).map((part,index)=>{
    if (!part.startsWith('https://')) return part;
    const href=part.replace(/[.,!?;:)\]}]+$/,'');
    try {
      const url=new URL(href);
      if (url.protocol!=='https:' || !url.hostname || url.username || url.password) return part;
      return <span key={index}><a href={href}>{href}</a>{part.slice(href.length)}</span>;
    } catch { return part; }
  })}</>;
}
