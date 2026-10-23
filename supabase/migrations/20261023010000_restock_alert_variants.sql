-- LFS 패리티 2차 L2 (#567) — PD-11 옵션 단위 재입고 알림.
--
-- 지금까지 재입고 알림은 굿즈 단위였다(restock_alerts unique(user, good)). 다옵션 굿즈에서
-- 옵션 하나만 품절이면 굿즈는 여전히 판매 중이라 그 옵션의 재입고를 기다릴 길이 없었다.
-- 신청에 옵션 키(variant_id)를 더한다. NULL 은 "모든 옵션" — 기존 굿즈 단위 신청이 그대로 이 뜻으로
-- 남는다(백필 없음).
--
-- 발화는 두 갈래다.
--   ① 굿즈 행의 판매 가능 전이(기존 trg_goods_notify_restock): 굿즈 단위 신청과, 그 순간 살 수 있는
--      옵션의 옵션 신청을 깨운다. 판매 가능 술어(공개·보관·판매 제한·결제수단·IP 공개·품절 표시·재고)는
--      기존 정의를 그대로 둔다.
--   ② 옵션 행의 살 수 없음→살 수 있음 전이(신규 goods_variants_restock_notify): 그 옵션의 신청과 굿즈
--      단위 신청을 깨운다. 다른 옵션이 판매 중이면 굿즈 행은 전후 모두 판매 가능이라 ①은 아무것도
--      깨우지 않는다 — 옵션 신청은 옵션 행의 전이로만 성립한다. 부모 굿즈의 재고 외 판매 가능
--      조건(공개·보관·판매 제한·결제수단·IP 공개·품절 표시)은 따로 확인한다.
-- 두 갈래가 같은 신청을 함께 보아도 pending → notified 전이는 한 번뿐이라 알림도 한 번이다.
--
-- 두 트리거는 재고를 바꾸는 트랜잭션(주문 생성·취소 환원·재고 조정·옵션 편집) 안에서 돈다. 팬아웃은
-- 예외를 밖으로 던지지 않는다 — 실패하면 그 블록만 되돌려 신청을 pending 으로 남기고(다음 전이에서
-- 다시 깨운다) 재고 쓰기는 그대로 진행한다. 재고 수량은 읽기만 한다.

-- ── 1. 옵션 키 ───────────────────────────────────────────────────────
-- 옵션은 반드시 같은 굿즈의 옵션이다(goods_variants_id_good_key). 장바구니 품목과 같은 형태로
-- 굿즈 URL 변경(on update cascade)·옵션 삭제(on delete cascade)를 따라가고, 검사는 커밋 시점에
-- 한다 — 굿즈 id 변경은 굿즈 FK 와 옵션 FK 두 경로로 같은 행에 전파되기 때문이다.
alter table public.restock_alerts
  add column variant_id uuid,
  add constraint restock_alerts_variant_good_fkey
    foreign key (variant_id, good_id) references public.goods_variants (id, good_id)
    on update cascade on delete cascade
    deferrable initially deferred;

-- 사용자×굿즈×옵션 1행. 평범한 unique 는 NULL 끼리 겹쳐도 막지 못하므로 nulls not distinct 로
-- "모든 옵션" 신청도 사용자×굿즈당 1행으로 고정한다. 재신청은 새 행이 아니라 같은 행을 되돌린다.
alter table public.restock_alerts drop constraint restock_alerts_user_good_key;
alter table public.restock_alerts
  add constraint restock_alerts_user_good_variant_key unique nulls not distinct (user_id, good_id, variant_id);

-- 옵션 전이 트리거의 pending 조회와 옵션 FK cascade 를 함께 받는다.
create index restock_alerts_variant_status_idx
  on public.restock_alerts (variant_id, status)
  where variant_id is not null;

-- ── 2. 깨우기(공용 팬아웃) ───────────────────────────────────────────
-- target_variant_id 가 null 이면 굿즈 단위 전이(①), 아니면 그 옵션의 전이(②)다.
-- 알림 문구·링크·dedupe 키는 어느 갈래가 깨워도 신청 하나에 같은 모양이다.
create function private.wake_restock_alerts(target_good public.goods, target_variant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  woken integer := 0;
  -- 재신청→재품절→재입고 사이클마다 새 알림이어야 하므로 시각을 키에 넣는다(기존 규율).
  -- now() 는 트랜잭션 시작에 고정되므로 문장 시각(clock_timestamp) 밀리초로 사이클을 구분한다.
  stamp text := ((extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint)::text;
begin
  if target_good.id is null then
    return 0;
  end if;

  -- 신청이 없는 굿즈가 절대다수다. 아래 예외 블록(서브트랜잭션)에 들어가기 전에 거른다.
  if not exists (
    select 1 from public.restock_alerts as alert
    where alert.good_id = target_good.id and alert.status = 'pending'
  ) then
    return 0;
  end if;

  begin
    with flipped as (
      update public.restock_alerts as alert
      set status = 'notified', notified_at = now()
      where alert.good_id = target_good.id
        and alert.status = 'pending'
        and case
          -- ② 옵션이 살 수 있게 됐다: 그 옵션 신청과 "모든 옵션" 신청이 충족된다.
          when target_variant_id is not null then
            alert.variant_id is null or alert.variant_id = target_variant_id
          -- ① 굿즈가 판매 가능해졌다: "모든 옵션" 신청은 사용 중인 옵션 하나라도 살 수 있을 때,
          --    옵션 신청은 그 옵션을 지금 살 수 있을 때만 충족된다. goods.stock_qty 는 보관 옵션
          --    재고까지 더한 캐시라(ADR-0015) 그것만으로는 살 수 있는 옵션이 있다는 뜻이 아니다.
          when alert.variant_id is null then exists (
            select 1 from public.goods_variants as variant
            where variant.good_id = target_good.id
              and variant.archived_at is null
              and variant.stock_qty > 0
          )
          else exists (
            select 1 from public.goods_variants as variant
            where variant.id = alert.variant_id
              and variant.good_id = target_good.id
              and variant.archived_at is null
              and variant.stock_qty > 0
          )
        end
      returning alert.user_id, alert.variant_id
    ), fanned as (
      insert into public.notifications (
        user_id,
        type,
        title,
        body,
        link_path,
        source_type,
        source_id,
        dedupe_key
      )
      select
        flipped.user_id,
        'restock_available',
        '재입고 알림',
        left(
          case
            when flipped.variant_id is null or variant.name is null
              then target_good.name || ' 굿즈가 다시 판매를 시작했어요.'
            else target_good.name || ' · ' || variant.name || ' 옵션이 다시 판매를 시작했어요.'
          end,
          500
        ),
        -- 옵션 신청은 그 옵션을 고른 상세로 연다(?variant=, PD-14).
        '/shop/' || target_good.id
          || case when flipped.variant_id is null then '' else '?variant=' || flipped.variant_id::text end,
        'good',
        target_good.id,
        -- 옵션 신청은 키에 옵션을 담는다. 같은 사용자의 "모든 옵션" 신청과 옵션 신청이 한 문장에서
        -- 함께 깨어나도 서로의 알림을 지우지 않는다. 옵션 키는 굿즈 id 길이와 무관하게 128자 안이다.
        case
          when flipped.variant_id is null then 'restock:' || target_good.id || ':' || stamp
          else 'restock:' || flipped.variant_id::text || ':' || stamp
        end
      from flipped
      left join public.goods_variants as variant on variant.id = flipped.variant_id
      on conflict (user_id, dedupe_key) do nothing
      returning 1
    )
    select count(*) into woken from flipped;
  exception when others then
    -- 재고 쓰기를 되돌리지 않는다. 이 블록의 신청 전이·알림만 되돌아가 신청은 pending 으로 남는다.
    raise warning 'restock_alert_wake_failed good=% variant=% sqlstate=%',
      target_good.id, target_variant_id, sqlstate;
    return 0;
  end;

  return woken;
end;
$$;

revoke all on function private.wake_restock_alerts(public.goods, uuid)
  from public, anon, authenticated, service_role;

-- ── 3. ① 굿즈 행의 판매 가능 전이 ───────────────────────────────────
-- 판매 가능 술어는 20260910072933 의 정의 그대로다. 팬아웃만 공용 함수로 옮긴다.
create or replace function private.notify_goods_restock()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- 판매 가능 술어가 거짓→참으로 전이할 때만 발화한다.
  if not (
    new.archived_at is null
    and new.published_at is not null
    and new.sale_restriction='none'
    and (new.allow_card_payment or new.allow_bank_transfer)
    and exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null)
    and new.stock <> 'soldout'
    and new.stock_qty > 0
  ) or (
    old.archived_at is null
    and old.published_at is not null
    and old.sale_restriction='none'
    and (old.allow_card_payment or old.allow_bank_transfer)
    and old.stock <> 'soldout'
    and old.stock_qty > 0
  ) then
    return new;
  end if;

  perform private.wake_restock_alerts(new, null);
  return new;
end;
$function$;

revoke all on function private.notify_goods_restock() from public, anon, authenticated, service_role;

-- ── 4. ② 옵션 행의 살 수 없음→살 수 있음 전이 ──────────────────────
create function private.notify_goods_variant_restock()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_good public.goods;
begin
  -- 트리거 WHEN 과 같은 조건이다. 함수가 다른 자리에 다시 쓰여도 뜻이 바뀌지 않게 여기서도 본다.
  if not (new.archived_at is null and new.stock_qty > 0)
    or (old.archived_at is null and old.stock_qty > 0) then
    return null;
  end if;

  -- 굿즈 행을 잠근 뒤에 신청을 본다. 신청 RPC 는 같은 행을 for share 로 잡은 채 판정·삽입하므로
  -- 잠그지 않고 보면 커밋 직전의 신청을 놓쳐 그 신청이 다음 사이클까지 침묵한다. 재고를 쓰는
  -- 경로는 이미 이 행을 잠갔고(재고 캐시 갱신 트리거도 같은 잠금을 잡는다) 잠금 순서도 그대로다.
  select * into target_good from public.goods where id = new.good_id for update;
  if not found then
    return null;
  end if;

  -- 재고 외 판매 가능 조건. 재고 조건은 이 옵션의 전이 자체다.
  if not (
    target_good.archived_at is null
    and target_good.published_at is not null
    and target_good.sale_restriction = 'none'
    and (target_good.allow_card_payment or target_good.allow_bank_transfer)
    and target_good.stock <> 'soldout'
    and exists (
      select 1 from public.ips
      where id = target_good.ip_id and published_at is not null and archived_at is null
    )
  ) then
    return null;
  end if;

  perform private.wake_restock_alerts(target_good, new.id);
  return null;
end;
$$;

revoke all on function private.notify_goods_variant_restock() from public, anon, authenticated, service_role;

-- 이름은 goods_variants_refresh_stock 뒤에 오도록 지었다(같은 시점 AFTER 트리거는 이름순).
-- 재고 캐시 갱신이 먼저 굿즈 행을 잠그고 굿즈 단위 전이(①)를 끝낸 뒤 이 트리거가 남은 옵션 신청을 본다.
create trigger goods_variants_restock_notify
after update of stock_qty, archived_at on public.goods_variants
for each row
when (
  (new.archived_at is null and new.stock_qty > 0)
  and not (old.archived_at is null and old.stock_qty > 0)
)
execute function private.notify_goods_variant_restock();

-- ── 5. 신청 RPC ─────────────────────────────────────────────────────
-- 굿즈 단위(모든 옵션) 신청. 시그니처·권한·에러 코드는 그대로다. 바뀐 것:
--   · 유일성이 (user, good, variant) 라 충돌 대상에 옵션 키(null)를 더한다.
--   · "판매 중" 판정은 사용 중인 옵션 중 살 수 있는 것이 있는가다(공개 상세의 품절 판정과 같다).
--     goods.stock_qty 는 보관 옵션 재고까지 더한 캐시라, 그 값만 보면 공개 화면은 품절인데
--     신청은 good_available 로 거절됐다. 보관 옵션 재고가 없는 굿즈에서는 이전과 같은 판정이다.
--   · 탈퇴 신청으로 쓰기가 봉인된 계정의 신청을 거절한다(계정 fence 관례, 20260813193000).
create or replace function public.request_restock_alert(target_good_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  good_stock text;
  good_archived_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if private.is_account_write_fenced(actor_id) then
    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;

  -- 판정과 신청 사이에 재입고 전이가 끼지 않도록 굿즈 행을 잠근다(전이 쪽은 for update).
  select good.stock, good.archived_at
  into good_stock, good_archived_at
  from public.goods as good
  where good.id = target_good_id
  for share;

  if not found or good_archived_at is not null then
    raise exception 'good_missing' using errcode = 'P0002';
  end if;

  -- 판매 중인 굿즈에 신청이 붙으면 전이 조건(거짓→참)이 영영 성립하지 않는다.
  if good_stock <> 'soldout' and exists (
    select 1 from public.goods_variants as variant
    where variant.good_id = target_good_id
      and variant.archived_at is null
      and variant.stock_qty > 0
  ) then
    raise exception 'good_available' using errcode = '22023';
  end if;

  insert into public.restock_alerts (user_id, good_id, variant_id)
  values (actor_id, target_good_id, null)
  on conflict (user_id, good_id, variant_id)
  do update set status = 'pending', notified_at = null, created_at = now();
end;
$$;

revoke all on function public.request_restock_alert(text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_restock_alert(text) to authenticated;

-- 옵션 단위 신청(PD-11). 굿즈는 판매 중이고 고른 옵션만 품절일 때 쓴다.
-- 예약판매 옵션은 재고가 아니라 예약 기간·물량으로 열리고 닫혀 재입고 알림 대상이 아니다.
create function public.request_variant_restock_alert(target_good_id text, target_variant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  good_stock text;
  good_archived_at timestamptz;
  variant_stock_qty integer;
  variant_archived_at timestamptz;
  variant_preorder_policy_id uuid;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if target_good_id is null or target_variant_id is null then
    raise exception 'variant_missing' using errcode = 'P0002';
  end if;

  if private.is_account_write_fenced(actor_id) then
    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;

  -- 굿즈 단위 신청과 같은 잠금. 옵션 행은 잠그지 않는다 — 재고를 쓰는 경로가 굿즈 → 옵션
  -- 순서로 잠그고, 옵션 재고 갱신 트리거와 옵션 전이 트리거가 굿즈 행을 for update 로 다시
  -- 잡으므로 이 잠금 하나로 판정·삽입과 전이가 직렬화된다.
  select good.stock, good.archived_at
  into good_stock, good_archived_at
  from public.goods as good
  where good.id = target_good_id
  for share;

  if not found or good_archived_at is not null then
    raise exception 'good_missing' using errcode = 'P0002';
  end if;

  select variant.stock_qty, variant.archived_at, variant.preorder_policy_id
  into variant_stock_qty, variant_archived_at, variant_preorder_policy_id
  from public.goods_variants as variant
  where variant.id = target_variant_id
    and variant.good_id = target_good_id;

  if not found or variant_archived_at is not null then
    raise exception 'variant_missing' using errcode = 'P0002';
  end if;

  if variant_preorder_policy_id is not null then
    raise exception 'variant_preorder' using errcode = '22023';
  end if;

  if good_stock <> 'soldout' and variant_stock_qty > 0 then
    raise exception 'variant_available' using errcode = '22023';
  end if;

  insert into public.restock_alerts (user_id, good_id, variant_id)
  values (actor_id, target_good_id, target_variant_id)
  on conflict (user_id, good_id, variant_id)
  do update set status = 'pending', notified_at = null, created_at = now();
end;
$$;

revoke all on function public.request_variant_restock_alert(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_variant_restock_alert(text, uuid) to authenticated;

-- ── 6. 메일 producer 용 옵션 이름 ───────────────────────────────────
-- 재입고 메일은 앱 producer 가 service role 로 notified 신청을 읽어 보낸다. service role 에는
-- goods_variants 읽기 권한이 없으므로(20260908020855 — 카탈로그 옵션은 anon·authenticated 공개
-- 읽기만 연다) 권한을 넓히지 않고, 그 굿즈의 notified 옵션 신청이 가리키는 옵션 이름만 돌려준다.
-- 알림 뒤에 사용 중지된 옵션도 이름은 그대로 돌려준다(알림 시점에는 판매 중이었다).
create function public.service_restock_alert_option_names(target_good_id text)
returns table (variant_id uuid, option_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select variant.id, variant.name
  from public.goods_variants as variant
  where variant.good_id = target_good_id
    and exists (
      select 1 from public.restock_alerts as alert
      where alert.good_id = target_good_id
        and alert.variant_id = variant.id
        and alert.status = 'notified'
    )
  order by variant.sort_order, variant.id;
$$;

revoke all on function public.service_restock_alert_option_names(text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_restock_alert_option_names(text) to service_role;
