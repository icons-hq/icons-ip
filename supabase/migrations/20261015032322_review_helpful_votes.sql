-- Review helpful marks and public/admin helpful-count readers.
-- One vote identity per original review and participant, shared across public
-- group PDPs. No review-event/purchase eligibility and no HOME BEST change.
-- Existing readers, moderation, author edit/delete, and their ACLs stay intact.

do $source_contract$ begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_good_group_reviews(text,text,boolean,integer,integer)'::regprocedure),'UTF8'),'sha256'),'hex')<>'26b0c9cd2294cbcf62c954ecb1738f874b9936e2217d1ecc538387f76c2c6768' then raise exception 'review_helpful_source_contract_changed: public.get_good_group_reviews(text,text,boolean,integer,integer)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'3458f0cc7ade2faa75c56d858e02408bcb5b9ff3488cb348dc158abdfddb8d30' then raise exception 'review_helpful_source_contract_changed: public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.goods_group_public_good(text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'88251457df65a45a8aa57eeb3972ae9a3f0215fced8c7a39d8e4487cbd3cc9a2' then raise exception 'review_helpful_source_contract_changed: private.goods_group_public_good(text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.goods_group_review_good_ids(text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'06ab883a8525f424537b9c0608c320f485719c2cef2f768ddfba14786fc1ce45' then raise exception 'review_helpful_source_contract_changed: private.goods_group_review_good_ids(text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.lock_account_action_subject(uuid)'::regprocedure),'UTF8'),'sha256'),'hex')<>'3d404beca5c0cef3a9a31b91858c3a5c98444e35346375a1db5159cb411b6ae5' then raise exception 'review_helpful_source_contract_changed: private.lock_account_action_subject(uuid)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.guard_account_insert_or_update()'::regprocedure),'UTF8'),'sha256'),'hex')<>'8b3a7e416c633fe11ecbcd53a8e4784e44a84997c315c8d8e8fab3c722b7ab93' then raise exception 'review_helpful_source_contract_changed: private.guard_account_insert_or_update()';end if;
 if to_regclass('private.review_helpful_votes') is not null
  or to_regprocedure('public.get_good_group_reviews_v2(text,text,boolean,integer,integer)') is not null
  or to_regprocedure('public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)') is not null
  or to_regprocedure('public.set_review_helpful(text,uuid,boolean)') is not null then
  raise exception 'review_helpful_already_defined';end if;
end $source_contract$;

create table private.review_helpful_votes (
 review_id uuid not null references public.reviews(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(review_id,user_id)
);
create index review_helpful_votes_user_idx on private.review_helpful_votes(user_id,review_id);
alter table private.review_helpful_votes enable row level security;
revoke all on private.review_helpful_votes from public,anon,authenticated,service_role;
-- Reuse the account-deletion table boundary, including future trusted inserts.
-- DELETE has no fence trigger so review/account FK cleanup cannot be blocked.
create trigger review_helpful_votes_account_fence before insert or update on private.review_helpful_votes
 for each row execute function private.guard_account_insert_or_update('user_id');

-- Identity is independent from participation: a suspended/onboarding-incomplete
-- signed-in viewer remains signed in, with readonly counts and no mark action.
create function private.review_helpful_viewer_id() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();session_text text:=auth.jwt()->>'session_id';
begin
 if actor is null or session_text is null or session_text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
  join auth.sessions s on s.user_id=u.id and s.id=session_text::uuid
  where u.id=actor and u.deleted_at is null and (s.not_after is null or s.not_after>statement_timestamp())) then return null;end if;
 return actor;
end $$;

-- Read-only equivalent of requireActiveUser/isOnboarded plus the account fence.
-- The explicit whitespace set matches ECMAScript String.trim used by isOnboarded.
-- No advisory lock is acquired by a public browsing reader.
create function private.review_helpful_actor_is_active(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select p_actor is not null and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp()) and p.suspended_at is null and p.onboarded_at is not null
   and nullif(btrim(coalesce(p.email,u.email),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') is not null and nullif(btrim(p.nickname,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') is not null
   and p.birth_date is not null and p.birth_date<=(statement_timestamp() at time zone 'UTC')::date
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
   and not exists(select 1 from private.account_action_fences f where f.subject_user_id=p_actor));
$$;

create function public.set_review_helpful(p_good_id text,p_review_id uuid,p_marked boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;review_good text;review_author uuid;scope_ids text[];helpful_count bigint;marked boolean;session_id uuid;
begin
 if p_good_id is null or p_good_id!~'^[A-Za-z0-9_-]{1,200}$' or p_review_id is null or p_marked is null then
  raise invalid_parameter_value using message='invalid_review_helpful_request';end if;
 actor:=private.review_helpful_viewer_id();
 if actor is null then raise invalid_authorization_specification using message='review_helpful_auth_required';end if;
 session_id:=(auth.jwt()->>'session_id')::uuid;
 -- Same account key as deletion/participation, before profile/catalog/review rows.
 -- It also serializes simultaneous desired-state retries by the same participant.
 perform private.lock_account_action_subject(actor);
 perform 1 from auth.users where id=actor for share nowait;
 perform 1 from public.profiles where id=actor for share nowait;
 perform 1 from auth.sessions where id=session_id and user_id=actor for share nowait;
 if private.review_helpful_viewer_id() is distinct from actor then
  raise invalid_authorization_specification using message='review_helpful_auth_required';end if;
 if not private.review_helpful_actor_is_active(actor) then
  raise insufficient_privilege using message='review_helpful_account_unavailable';end if;
 -- Group structure writers own this key exclusively. Taking it shared first
 -- keeps the original review's membership stable without a new topology system.
 if not pg_try_advisory_xact_lock_shared(hashtextextended('goods-stock-successor-topology:v1',0)) then
  raise sqlstate 'PT409' using message='review_helpful_retry';end if;
 select good_id,user_id into review_good,review_author from public.reviews where id=p_review_id;
 if not found then raise no_data_found using message='review_helpful_review_unavailable';end if;
 perform 1 from public.goods where id=any(array[p_good_id,review_good]) order by id for share nowait;
 perform 1 from public.ips where id in(select ip_id from public.goods where id=any(array[p_good_id,review_good])) order by id for share nowait;
 -- Share blocks moderation/edit/delete while allowing different participants to
 -- mark one review concurrently. The unique key and account key prevent doubles.
 perform 1 from public.reviews where id=p_review_id and good_id=review_good and user_id=review_author and status='visible' for share nowait;
 if not found then raise no_data_found using message='review_helpful_review_unavailable';end if;
 scope_ids:=private.goods_group_review_good_ids(p_good_id);
 if not (review_good=any(scope_ids)) then raise no_data_found using message='review_helpful_review_unavailable';end if;
 if review_author=actor then raise insufficient_privilege using message='review_helpful_own_review';end if;
 if p_marked then
  insert into private.review_helpful_votes(review_id,user_id) values(p_review_id,actor) on conflict(review_id,user_id) do nothing;
 else
  delete from private.review_helpful_votes where review_id=p_review_id and user_id=actor;
 end if;
 select count(*)::bigint,coalesce(bool_or(user_id=actor),false) into helpful_count,marked
 from private.review_helpful_votes where review_id=p_review_id;
 return jsonb_build_object('reviewId',p_review_id,'helpfulCount',helpful_count,'helpfulByMe',marked,'canMarkHelpful',true);
exception when lock_not_available then raise sqlstate 'PT409' using message='review_helpful_retry';
end $$;

do $review_helpful_public$ declare definition text;anchor text;replacement text;begin
 definition:=pg_get_functiondef('public.get_good_group_reviews(text,text,boolean,integer,integer)'::regprocedure);
 anchor:=$anchor1$CREATE OR REPLACE FUNCTION public.get_good_group_reviews($anchor1$;
 replacement:=$replacement1$CREATE OR REPLACE FUNCTION public.get_good_group_reviews_v2($replacement1$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_1_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor2$declare ids text[];result jsonb;$anchor2$;
 replacement:=$replacement2$declare ids text[];result jsonb;viewer uuid:=private.review_helpful_viewer_id();viewer_active boolean:=private.review_helpful_actor_is_active(viewer);$replacement2$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_2_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor3$p_sort not in('recent','rating_desc','rating_asc')$anchor3$;
 replacement:=$replacement3$p_sort not in('recent','rating_desc','rating_asc','helpful_desc')$replacement3$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_3_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor4$r.admin_reply,r.admin_reply_at,$anchor4$;
 replacement:=$replacement4$r.admin_reply,r.admin_reply_at,helpful.helpful_count,helpful.helpful_by_me,$replacement4$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_4_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor5$join public.goods g on g.id=r.good_id$anchor5$;
 replacement:=$replacement5$join public.goods g on g.id=r.good_id
  cross join lateral(select count(*)::bigint helpful_count,coalesce(bool_or(v.user_id=viewer),false) helpful_by_me
   from private.review_helpful_votes v where v.review_id=r.id) helpful$replacement5$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_5_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor6$case when p_sort='rating_desc' then rating end desc nulls last,$anchor6$;
 replacement:=$replacement6$case when p_sort='helpful_desc' then helpful_count end desc nulls last,case when p_sort='rating_desc' then rating end desc nulls last,$replacement6$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 then raise exception 'review_helpful_public_anchor_6_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor7$jsonb_build_object('grouped',$anchor7$;
 replacement:=$replacement7$jsonb_build_object('viewerAuthenticated',viewer is not null,'grouped',$replacement7$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_7_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor8$'isMine',auth.uid() is not null and user_id=auth.uid(),$anchor8$;
 replacement:=$replacement8$'helpfulCount',helpful_count,'helpfulByMe',helpful_by_me,'canMarkHelpful',viewer_active and user_id<>viewer,'isMine',auth.uid() is not null and user_id=auth.uid(),$replacement8$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_public_anchor_8_changed';end if;
 definition:=replace(definition,anchor,replacement);
 execute definition;
end $review_helpful_public$;

do $review_helpful_admin$ declare definition text;anchor text;replacement text;begin
 definition:=pg_get_functiondef('public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure);
 anchor:=$anchor1$CREATE OR REPLACE FUNCTION public.admin_search_reviews_best($anchor1$;
 replacement:=$replacement1$CREATE OR REPLACE FUNCTION public.admin_search_reviews_helpful($replacement1$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_1_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor2$best_selection jsonb)$anchor2$;
 replacement:=$replacement2$best_selection jsonb, helpful_count bigint)$replacement2$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_2_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor3$'recent', 'oldest', 'rating_desc', 'rating_asc', 'good_name_asc', 'photo_count_desc'$anchor3$;
 replacement:=$replacement3$'recent', 'oldest', 'rating_desc', 'rating_asc', 'good_name_asc', 'photo_count_desc', 'helpful_desc'$replacement3$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_3_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor4$private.review_best_state(review) as best_selection$anchor4$;
 replacement:=$replacement4$private.review_best_state(review) as best_selection,
    helpful.helpful_count$replacement4$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_4_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor5$join public.goods as good on good.id = review.good_id$anchor5$;
 replacement:=$replacement5$join public.goods as good on good.id = review.good_id
  cross join lateral(select count(*)::bigint helpful_count from private.review_helpful_votes vote where vote.review_id=review.id) helpful$replacement5$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_5_changed';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor6$  order by
    case when v_sort = 'good_name_asc'$anchor6$;
 replacement:=$replacement6$  order by
    case when v_sort = 'helpful_desc' then helpful.helpful_count end desc nulls last,
    case when v_sort = 'good_name_asc'$replacement6$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'review_helpful_admin_anchor_6_changed';end if;
 definition:=replace(definition,anchor,replacement);
 execute definition;
end $review_helpful_admin$;

revoke all on function private.review_helpful_viewer_id(),private.review_helpful_actor_is_active(uuid),
 public.get_good_group_reviews_v2(text,text,boolean,integer,integer),
 public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text),
 public.set_review_helpful(text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.review_helpful_viewer_id(),private.review_helpful_actor_is_active(uuid) to postgres;
grant execute on function public.get_good_group_reviews_v2(text,text,boolean,integer,integer) to anon,authenticated,postgres;
grant execute on function public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text),
 public.set_review_helpful(text,uuid,boolean) to authenticated,postgres;
select private.register_operator_internal_contract('private.review_helpful_viewer_id()'::regprocedure);
select private.register_operator_internal_contract('private.review_helpful_actor_is_active(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_group_reviews_v2(text,text,boolean,integer,integer)'::regprocedure);
select private.register_operator_internal_contract('public.set_review_helpful(text,uuid,boolean)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure,'cs.manage','read',false);
notify pgrst,'reload schema';
