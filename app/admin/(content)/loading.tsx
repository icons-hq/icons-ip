import { Loader2 } from 'lucide-react';

export default function AdminLoading() {
  return <section aria-busy="true" className="flex flex-col gap-2" data-admin-loading="">
    <h2 className="text-lg font-semibold tracking-tight text-foreground">업무 화면</h2>
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 aria-hidden="true" className="size-4 animate-spin" />최신 업무 정보를 불러오는 중입니다.</p>
  </section>;
}
