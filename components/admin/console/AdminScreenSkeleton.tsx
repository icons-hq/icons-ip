import { Skeleton } from '@/components/admin/kit/ui/skeleton';

export type AdminScreenSkeletonKind = 'list' | 'chat' | 'home';

const FILTER_FIELDS = [0, 1, 2, 3, 4, 5, 6, 7];
const COUNT_CHIPS = [0, 1, 2, 3, 4, 5];
const TABLE_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const HOME_CARDS = [0, 1, 2, 3];
const CHAT_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];
const CHAT_BUBBLES = [0, 1, 2, 3];

const CARD = 'rounded-xl bg-card ring-1 ring-foreground/10';

/** 조회 카드 + 건수 + 표. 대부분의 화면이 이 배치다. */
function ListSkeleton() {
  return (
    <>
      <div className={`${CARD} grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4`}>
        {FILTER_FIELDS.map((field) => (
          <div className="flex flex-col gap-2" key={field}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {COUNT_CHIPS.map((chip) => <Skeleton className="h-8 w-24 rounded-lg" key={chip} />)}
      </div>
      <div className={`${CARD} flex flex-col gap-3 p-4`}>
        <Skeleton className="h-8 w-full" />
        {TABLE_ROWS.map((row) => <Skeleton className="h-9 w-full" key={row} />)}
      </div>
    </>
  );
}

/** 상담하기: 대화 목록 · 대화 · 상담 정보 세 칸, 본문 전체 높이. */
function ChatSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-background md:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden border-r p-3">
        <Skeleton className="h-8 w-full" />
        {CHAT_ROWS.map((row) => <Skeleton className="h-14 w-full" key={row} />)}
      </div>
      <div className="hidden min-h-0 flex-col justify-end gap-4 overflow-hidden p-4 md:flex">
        {CHAT_BUBBLES.map((bubble) => <Skeleton className={`h-16 w-1/2 rounded-xl ${bubble % 2 ? 'self-end' : 'self-start'}`} key={bubble} />)}
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <div className="hidden min-h-0 flex-col gap-3 overflow-hidden border-l p-3 xl:flex">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** 홈: 건수 카드 줄 + 넓은 카드 두 장. */
function HomeSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {HOME_CARDS.map((card) => (
          <div className={`${CARD} flex flex-col gap-3 p-4`} key={card}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
        <div className={`${CARD} flex flex-col gap-3 p-4`}>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-60 w-full" />
        </div>
        <div className={`${CARD} flex flex-col gap-3 p-4`}>
          <Skeleton className="h-5 w-24" />
          {COUNT_CHIPS.map((row) => <Skeleton className="h-8 w-full" key={row} />)}
        </div>
      </div>
    </>
  );
}

/**
 * 새로고침·직접 진입에서 본문이 스트리밍되는 동안 보이는 골격. 메뉴 이동(소프트 이동)에서는 나오지 않는다.
 * 제목(h1)은 셸이 이미 실제 제목을 그리고, 낭독은 하지 않는다.
 */
export function AdminScreenSkeleton({ kind = 'list' }: { kind?: AdminScreenSkeletonKind }) {
  return (
    <div aria-hidden="true" className={kind === 'chat' ? 'h-full min-h-0' : 'flex min-w-0 flex-col gap-4'} data-admin-screen-skeleton={kind}>
      {kind === 'chat' ? <ChatSkeleton /> : kind === 'home' ? <HomeSkeleton /> : <ListSkeleton />}
    </div>
  );
}

/**
 * 새로고침·직접 진입에서 계정 확인이 끝나 셸이 오기 전까지의 빈 바탕. 쇼핑몰 공용 뼈대(`app/loading.tsx`) 대신 쓴다.
 * 사이드바 면과 같은 색이라 셸이 들어와도 바탕이 바뀌지 않고, 셸 없는 현장 검표 화면에도 어색하지 않다.
 */
export function AdminEntryFallback() {
  return (
    <div aria-busy="true" className="wc-admin min-h-svh bg-sidebar" data-admin-entry-fallback="">
      <p className="sr-only">화면을 불러오는 중입니다.</p>
    </div>
  );
}
