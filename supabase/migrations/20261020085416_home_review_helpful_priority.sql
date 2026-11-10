-- Add helpful count only between rating and date in two home representatives.
-- Product eligibility/rank/statistics, valid BEST predicates, old ACLs and JSON remain unchanged.
set local search_path='';
do $source_contract$ begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_home_best_review_candidates(text[])'::regprocedure),'UTF8'),'sha256'),'hex')<>'f4efb00c9b92a8dd70c5bca90a07d7622320230fb492d4c10a9bf962122e72a5' then raise exception 'home_review_helpful_source_changed: public.get_home_best_review_candidates(text[])';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_home_review_candidates(text[])'::regprocedure),'UTF8'),'sha256'),'hex')<>'19dfccfd0c6beb739c8551b9c8621bb52005f3839e8af013f823d10a4401af6b' then raise exception 'home_review_helpful_source_changed: public.get_home_review_candidates(text[])';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.review_event_purchase_eligible(uuid,uuid,text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'601d8055c30c43bc05b8904a77b3cffe61b1fc9666499657e9336b2102d5c2b6' then raise exception 'home_review_helpful_source_changed: private.review_event_purchase_eligible(uuid,uuid,text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.review_event_review_fingerprint(public.reviews)'::regprocedure),'UTF8'),'sha256'),'hex')<>'995263eab804e62dc6485d74cd77cc794b8ce3b4239c9618f1bc95378032455f' then raise exception 'home_review_helpful_source_changed: private.review_event_review_fingerprint(public.reviews)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.review_best_problem(public.reviews)'::regprocedure),'UTF8'),'sha256'),'hex')<>'b1b3c33e3701f035e53c615b536e2bef6edf6a3eeb2695cf632e90dd8ff00129' then raise exception 'home_review_helpful_source_changed: private.review_best_problem(public.reviews)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.set_review_helpful(text,uuid,boolean)'::regprocedure),'UTF8'),'sha256'),'hex')<>'3aad610409a8c59d4b7b3e4b08f20dbb5a5c3f580a3d6f4c1d771a5d89b9e8b4' then raise exception 'home_review_helpful_source_changed: public.set_review_helpful(text,uuid,boolean)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_good_group_reviews_v2(text,text,boolean,integer,integer)'::regprocedure),'UTF8'),'sha256'),'hex')<>'d85fbb939a8eb70642f4be06bc62a191cb8217ebda44f6a8afb7d5dd08eb0512' then raise exception 'home_review_helpful_source_changed: public.get_good_group_reviews_v2(text,text,boolean,integer,integer)';end if;
 if to_regprocedure('public.get_public_review_helpful_count(uuid)') is not null or to_regclass('private.review_helpful_votes') is null then raise exception 'home_review_helpful_schema_contract_changed';end if;
end $source_contract$;

-- The new count boundary runs as the existing votes-table owner. Old mixed-owner
-- readers are replaced only after RESET ROLE returns to the migration session.
set local role postgres;
create function public.get_public_review_helpful_count(p_review_id uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select count(*)::bigint from private.review_helpful_votes v
 where v.review_id=p_review_id and exists(
  select 1 from public.reviews r join public.goods g on g.id=r.good_id join public.ips ip on ip.id=g.ip_id
  where r.id=p_review_id and r.status='visible'
   and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
   and ip.archived_at is null and ip.published_at is not null);
$$;
revoke all on function public.get_public_review_helpful_count(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_review_helpful_count(uuid) to anon,authenticated,postgres;
comment on function public.get_public_review_helpful_count(uuid) is
 'Public visible-review helpful count only. Hidden, missing, or unavailable product/IP returns zero; no voter identity, account gate, purchase gate, or state mutation.';
reset role;

do $home_review_helpful$ declare signature text;definition text;anchor text;replacement text;before_owner oid;before_acl aclitem[];begin
 anchor:='order by r.rating desc,r.created_at desc,r.id';
 replacement:='order by r.rating desc,public.get_public_review_helpful_count(r.id) desc,r.created_at desc,r.id';
 foreach signature in array array['public.get_home_best_review_candidates(text[])','public.get_home_review_candidates(text[])'] loop
  select proowner,proacl into before_owner,before_acl from pg_proc where oid=signature::regprocedure;
  if not has_function_privilege(before_owner,'public.get_public_review_helpful_count(uuid)'::regprocedure,'EXECUTE') then
   raise exception 'home_review_helpful_reader_dependency_denied: %',signature;end if;
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'home_review_helpful_anchor_changed: %',signature;end if;
  execute replace(definition,anchor,replacement);
  if exists(select 1 from pg_proc where oid=signature::regprocedure and (proowner<>before_owner or proacl is distinct from before_acl)) then
   raise exception 'home_review_helpful_existing_security_changed: %',signature;end if;
 end loop;
end $home_review_helpful$;

comment on function public.get_home_best_review_candidates(text[]) is
 'At most one currently eligible selected BEST review per requested public good (1..200 IDs). Rating/helpful/date/ID order; no private selection metadata, account locks, PDP toggle, three-review minimum, random selection, reward, or product-rank change.';
select private.register_operator_internal_contract('public.get_public_review_helpful_count(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_home_best_review_candidates(text[])'::regprocedure);
notify pgrst,'reload schema';
