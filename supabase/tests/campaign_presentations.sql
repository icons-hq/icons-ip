\set ON_ERROR_STOP on
-- 스펙 C §4.3: 캠페인 노출 설정(campaign_presentations)과 admin_save_campaign_presentation. Rollback-only.
-- 고정하는 것: 쓰기 경로는 RPC 하나뿐(테이블 직접 쓰기 불가)·ACL, promotion.manage 권한 판정(고객·멤버십 없는 staff 프로필·물류 매니저 거절),
-- 값 정리·모두 비면 삭제·형식 위반(22023)·캠페인 없음(P0002), 감사 기록 전후 값, draft 캠페인의 행은 비공개,
-- 캠페인 id 가 바뀌면 행이 따라가고 캠페인이 지워지면 행도 지워지는 것, admin_upsert_campaign 은 id 를 바꾸지 못하는 것.
-- PR2 리뷰 C m1·m2: 공개 열 다섯 개만 열 단위로 읽히고(updated_by 비공개), 바로가기에는 점 조각·역슬래시가 못 들어온다.
begin;

create function pg_temp.cp_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'campaign presentation assertion: %', label; end if; end $$;
create function pg_temp.cp_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-0000000177'||lpad(n::text, 2, '0'))::uuid $$;
-- 현재 롤·JWT 로 q 를 실행해 기대한 SQLSTATE(성공이면 'ok')로 끝나는지 본다.
create function pg_temp.cp_expect(q text, wanted text, label text) returns void language plpgsql as $$
declare got text := 'ok';
begin
 begin execute q; exception when others then got := sqlstate; end;
 if got is distinct from wanted then raise exception 'campaign presentation expectation: % (wanted %, got %)', label, wanted, got; end if;
end $$;
create function pg_temp.cp_save(campaign text, mode text, location text, link text) returns void language sql as $$
 select public.admin_save_campaign_presentation(campaign, mode, location, link) $$;

-- 사용자: 1 = 기본 운영자(promotion.manage), 2 = 물류 매니저(promotion.manage 없음), 3 = 고객, 4 = staff 프로필이지만 멤버십 없음.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.cp_uid(n), 'authenticated', 'authenticated', 'campaign-presentation-' || n || '@example.test', now(), '{}', '{}' from generate_series(1, 4) n;
update public.profiles set role = 'staff' where id in (pg_temp.cp_uid(1), pg_temp.cp_uid(2), pg_temp.cp_uid(4));
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.cp_uid(1), 'primary'), (pg_temp.cp_uid(2), 'logistics');
update private.operator_access_state set configured = true where id;

-- 캠페인: 게시 1건, draft 1건(superuser 직접 삽입 — admin_upsert_campaign 을 다시 시험하지 않는다).
insert into public.campaigns(id, kind, title, status, starts_at, ends_at) values
 ('cp-pub', 'event', '게시된 캠페인', 'published', now() - interval '1 day', now() + interval '10 days'),
 ('cp-draft', 'event', '준비 중 캠페인', 'draft', now() + interval '1 day', now() + interval '10 days');
select updated_at as cp_campaign_updated_at from public.campaigns where id = 'cp-pub' \gset

-- ACL: 저장 RPC 는 로그인 롤만, 표는 공개 읽기뿐이고 앱 롤에는 쓰기 권한이 없다.
select pg_temp.cp_assert(
 has_function_privilege('authenticated', 'public.admin_save_campaign_presentation(text,text,text,text)', 'execute')
 and not has_function_privilege('anon', 'public.admin_save_campaign_presentation(text,text,text,text)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_save_campaign_presentation(text,text,text,text)', 'execute'),
 'save RPC is for signed-in operators only');
-- 읽기는 공개 열 다섯 개만 열 단위로 열려 있다(표 전체 SELECT 없음): 운영자 식별자 updated_by 는 비회원·고객에게 읽히지 않는다.
select pg_temp.cp_assert(
 (select bool_and(has_column_privilege(r, 'public.campaign_presentations', c, 'select'))
  from unnest(array['anon', 'authenticated']) r cross join unnest(array['campaign_id', 'popup_mode', 'popup_location', 'card_link_path', 'updated_at']) c)
 and (select bool_and(not has_column_privilege(r, 'public.campaign_presentations', 'updated_by', 'select') and not has_table_privilege(r, 'public.campaign_presentations', 'select'))
  from unnest(array['anon', 'authenticated']) r)
 and not has_table_privilege('service_role', 'public.campaign_presentations', 'select')
 and not has_column_privilege('service_role', 'public.campaign_presentations', 'updated_by', 'select')
 and (select bool_and(not has_table_privilege(r, 'public.campaign_presentations', p))
   from unnest(array['anon', 'authenticated', 'service_role']) r cross join unnest(array['insert', 'update', 'delete', 'truncate']) p),
 'table is public read only on its public columns and has no application write path');
select pg_temp.cp_assert((select relrowsecurity from pg_class where oid = 'public.campaign_presentations'::regclass), 'row level security is on');
select pg_temp.cp_assert(exists(select 1 from private.operator_rpc_contracts where signature = 'public.admin_save_campaign_presentation(text,text,text,text)'
  and capability = 'promotion.manage' and guard_kind = 'write')
 and exists(select 1 from private.operator_policy_contracts where table_name = 'campaign_presentations' and policy_name = 'campaign_presentations_public_read' and capability = 'promotion.manage'),
 'operator contracts are registered');

-- 권한: anon 은 실행 권한 자체가 없고, 고객·멤버십 없는 staff 프로필·물류 매니저는 거절, 로그인 없는 authenticated 롤은 인증 오류.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'online', null, null)$q$, '42501', 'anon cannot call the RPC');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'online', null, null)$q$, '28000', 'no signed-in user is an auth error');
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(3)::text, true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'online', null, null)$q$, '42501', 'a customer is forbidden');
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(4)::text, true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'online', null, null)$q$, '42501', 'a staff profile without a membership is forbidden');
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(2)::text, true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'online', null, null)$q$, '42501', 'a logistics manager lacks promotion.manage');
-- 직접 쓰기 경로는 없다(정책도 권한도 없음).
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, popup_mode) values('cp-pub', 'online')$q$, '42501', 'operators cannot insert directly');
select pg_temp.cp_expect($q$update public.campaign_presentations set popup_mode = 'offline'$q$, '42501', 'operators cannot update directly');
select pg_temp.cp_expect($q$delete from public.campaign_presentations$q$, '42501', 'operators cannot delete directly');
reset role;
select pg_temp.cp_assert(not exists(select 1 from public.campaign_presentations), 'nothing was written by the rejected calls');

-- 저장: 기본 운영자가 POP-UP(온·오프라인)·장소·바로가기를 정한다. 입력은 앞뒤 공백이 정리된다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_save('cp-pub', ' hybrid ', '  서울 마포구 월드컵로8길 69 1층  ', ' /ip/hong-sil-quest ');
reset role;
select pg_temp.cp_assert((select (popup_mode, popup_location, card_link_path, updated_by) = ('hybrid', '서울 마포구 월드컵로8길 69 1층', '/ip/hong-sil-quest', pg_temp.cp_uid(1))
  from public.campaign_presentations where campaign_id = 'cp-pub'), 'trimmed values are stored with the actor');
select pg_temp.cp_assert(exists(select 1 from public.audit_log where action = 'admin.campaign.presentation_saved' and target = 'campaigns:cp-pub' and actor_id = pg_temp.cp_uid(1)
  and diff->'before' = 'null'::jsonb
  and diff->'after' = '{"popupMode":"hybrid","popupLocation":"서울 마포구 월드컵로8길 69 1층","cardLinkPath":"/ip/hong-sil-quest"}'::jsonb), 'first save is audited with a null before');
select pg_temp.cp_assert((select updated_at = :'cp_campaign_updated_at'::timestamptz from public.campaigns where id = 'cp-pub'), 'saving a presentation does not touch the campaign row');

-- 같은 행을 바꾼다(upsert): 온라인으로 바꾸면 장소는 유지, 모드를 비우면 장소가 같이 비워진다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_save('cp-pub', 'online', '온라인 스토어', null);
reset role;
select pg_temp.cp_assert((select (popup_mode, popup_location) = ('online', '온라인 스토어') and card_link_path is null from public.campaign_presentations where campaign_id = 'cp-pub'), 'second save replaces the row');
select pg_temp.cp_assert(exists(select 1 from public.audit_log where action = 'admin.campaign.presentation_saved' and target = 'campaigns:cp-pub'
  and diff#>>'{before,popupMode}' = 'hybrid' and diff#>>'{after,popupMode}' = 'online'), 'second save audits the previous values');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_save('cp-pub', '', '모드 없는 장소', '/shop');
reset role;
select pg_temp.cp_assert((select popup_mode is null and popup_location is null and card_link_path = '/shop' from public.campaign_presentations where campaign_id = 'cp-pub'),
 'without a popup mode the location is dropped but the shortcut stays');
-- 모든 값이 비면 행을 지운다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_save('cp-pub', null, '  ', '');
reset role;
select pg_temp.cp_assert(not exists(select 1 from public.campaign_presentations where campaign_id = 'cp-pub'), 'all empty removes the row');
select pg_temp.cp_assert(exists(select 1 from public.audit_log where action = 'admin.campaign.presentation_saved' and target = 'campaigns:cp-pub'
  and diff->'after' = 'null'::jsonb and diff#>>'{before,cardLinkPath}' = '/shop'), 'removal is audited');
-- 이미 없는 행을 비워도 오류 없이 끝난다(멱등).
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, null)$q$, 'ok', 'clearing an empty presentation is idempotent');

-- 형식 위반은 22023, 없는 캠페인은 P0002. 허용 모드는 online·offline·hybrid 뿐.
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'popup', null, null)$q$, '22023', 'unknown mode');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'ONLINE', null, null)$q$, '22023', 'mode is case sensitive');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'offline', repeat('가', 121), null)$q$, '22023', 'location over 120 characters');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', 'offline', repeat('가', 120), null)$q$, 'ok', 'location of exactly 120 characters');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '//evil.example/path')$q$, '22023', 'protocol relative link');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, 'https://evil.example/path')$q$, '22023', 'absolute external link');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, 'javascript:alert(1)')$q$, '22023', 'script scheme');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, 'ip/hong-sil-quest')$q$, '22023', 'relative path without a leading slash');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/\evil.example')$q$, '22023', 'backslash after the slash');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a b')$q$, '22023', 'whitespace inside the path');
-- 점 조각(경로 부분의 `.`·`..` 세그먼트, 퍼센트 인코딩 포함)과 역슬래시는 `//외부호스트` 로 정규화되므로 거절한다.
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/..//evil.example')$q$, '22023', 'dot segment hiding a double slash');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/.//evil.example')$q$, '22023', 'single dot segment hiding a double slash');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/../b')$q$, '22023', 'dot dot segment in the middle');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/./b')$q$, '22023', 'dot segment in the middle');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/..')$q$, '22023', 'trailing dot dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/.')$q$, '22023', 'trailing dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/.')$q$, '22023', 'root dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/..?x=1')$q$, '22023', 'dot dot segment before the query');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/..#top')$q$, '22023', 'dot dot segment before the fragment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/%2e%2e//evil.example')$q$, '22023', 'encoded dot dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/%2E/b')$q$, '22023', 'encoded dot segment, upper case');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a/.%2e/b')$q$, '22023', 'mixed dot dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a\b')$q$, '22023', 'backslash inside the path');
-- 점이 든 평범한 경로·쿼리·해시는 통과한다(점 조각만 거절한다).
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/.well-known/x')$q$, 'ok', 'a dot file name is not a dot segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/a...b/c.d/..e/f..')$q$, 'ok', 'dots inside names are fine');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/.../x')$q$, 'ok', 'three dots is a plain segment');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/search?q=a/../b#c/./d')$q$, 'ok', 'dot segments after ? or # are not path segments');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/shop?displayCategory=0d2c1c1f-0000-4000-8000-000000000000&sort=popular')$q$, 'ok', 'a category display shortcut');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/' || repeat('a', 300))$q$, '22023', 'link over 300 characters');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-pub', null, null, '/' || repeat('a', 299))$q$, 'ok', 'link of exactly 300 characters');
select pg_temp.cp_expect($q$select pg_temp.cp_save('cp-missing', 'online', null, null)$q$, 'P0002', 'campaign does not exist');
select pg_temp.cp_expect($q$select pg_temp.cp_save('', 'online', null, null)$q$, 'P0002', 'empty campaign id');
select pg_temp.cp_expect($q$select pg_temp.cp_save(null, 'online', null, null)$q$, 'P0002', 'null campaign id');
reset role;
-- 거절된 호출은 아무것도 남기지 않는다: 위 성공 두 건(120자 장소 → 이어서 300자 링크로 덮어씀) 뒤에는 행이 하나, 링크가 300자.
select pg_temp.cp_assert((select count(*) = 1 and bool_and(char_length(card_link_path) = 300) and bool_and(popup_location is null) from public.campaign_presentations where campaign_id = 'cp-pub'),
 'only the last accepted save is stored: ' || coalesce((select popup_mode || '/' || coalesce(popup_location, '-') from public.campaign_presentations where campaign_id = 'cp-pub'), 'none'));
delete from public.campaign_presentations where campaign_id = 'cp-pub';

-- 표 제약은 RPC 를 거치지 않는 경로에서도 같은 모양을 지킨다(superuser 직접 삽입).
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, popup_location) values('cp-pub', '모드 없는 장소')$q$, '23514', 'table: location needs a mode');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, popup_mode) values('cp-pub', 'popup')$q$, '23514', 'table: mode list');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '//evil.example')$q$, '23514', 'table: link must be a single-slash path');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/..//evil.example')$q$, '23514', 'table: dot segment hiding a double slash');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/a/..')$q$, '23514', 'table: trailing dot dot segment');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/a/.')$q$, '23514', 'table: trailing dot segment');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/a/%2e%2E/b')$q$, '23514', 'table: encoded dot dot segment');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/a\b')$q$, '23514', 'table: backslash anywhere');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, card_link_path) values('cp-pub', '/.well-known/x?q=/../')$q$, 'ok', 'table: dot file names and query dots pass');
delete from public.campaign_presentations where campaign_id = 'cp-pub';
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, popup_mode, popup_location) values('cp-pub', 'online', '')$q$, '23514', 'table: empty location');
select pg_temp.cp_expect($q$insert into public.campaign_presentations(campaign_id, popup_mode) values('cp-none', 'online')$q$, '23503', 'table: campaign must exist');

-- 읽기: 게시된 캠페인의 행은 누구나, draft 캠페인의 행은 promotion.manage 운영자만.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_save('cp-pub', 'offline', '게시 장소', '/shop');
select pg_temp.cp_save('cp-draft', 'online', null, '/ip/draft');
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.cp_assert((select count(*) = 1 and bool_and(campaign_id = 'cp-pub') from public.campaign_presentations), 'guests read only published campaign rows');
-- 공개 열은 읽히고(같은 쿼리로 값 확인), 운영자 식별자 updated_by 와 `select *` 는 권한 오류다.
select pg_temp.cp_assert((select (campaign_id, popup_mode, popup_location, card_link_path) = ('cp-pub', 'offline', '게시 장소', '/shop') and updated_at is not null
 from public.campaign_presentations), 'guests read the public columns');
select pg_temp.cp_expect($q$select updated_by from public.campaign_presentations$q$, '42501', 'guests cannot read updated_by');
select pg_temp.cp_expect($q$select * from public.campaign_presentations$q$, '42501', 'guests cannot select every column');
select pg_temp.cp_expect($q$select p.nickname from public.campaign_presentations c join public.public_profiles p on p.id = c.updated_by$q$, '42501', 'guests cannot follow updated_by to a profile');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(3)::text, true);
select pg_temp.cp_assert((select count(*) = 1 and bool_and(campaign_id = 'cp-pub') from public.campaign_presentations), 'customers read only published campaign rows');
select pg_temp.cp_expect($q$select updated_by from public.campaign_presentations$q$, '42501', 'customers cannot read updated_by');
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(2)::text, true);
select pg_temp.cp_assert((select count(*) = 1 and bool_and(campaign_id = 'cp-pub') from public.campaign_presentations), 'a manager without promotion.manage cannot read draft rows');
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_assert((select count(*) = 2 from public.campaign_presentations), 'promotion.manage operators read draft rows too');
select pg_temp.cp_expect($q$select updated_by from public.campaign_presentations$q$, '42501', 'even promotion.manage operators read through the public columns only');
select pg_temp.cp_assert((select count(*) = 2 and bool_and(campaign_id is not null and updated_at is not null) from (select campaign_id, popup_mode, popup_location, card_link_path, updated_at from public.campaign_presentations) c),
 'the admin console column list still reads');
reset role;
-- 게시 상태가 바뀌면 노출도 따라간다(draft → published).
update public.campaigns set status = 'published' where id = 'cp-draft';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.cp_assert((select count(*) = 2 from public.campaign_presentations), 'a published campaign exposes its row to guests');
reset role;

-- 캠페인 id 가 바뀌면 행이 따라가고(on update cascade), 캠페인이 지워지면 행도 지워진다.
update public.campaigns set id = 'cp-pub-renamed' where id = 'cp-pub';
select pg_temp.cp_assert((select popup_location = '게시 장소' from public.campaign_presentations where campaign_id = 'cp-pub-renamed')
 and not exists(select 1 from public.campaign_presentations where campaign_id = 'cp-pub'), 'presentation follows a campaign id change');
delete from public.campaigns where id = 'cp-draft';
select pg_temp.cp_assert(not exists(select 1 from public.campaign_presentations where campaign_id = 'cp-draft'), 'deleting a campaign deletes its presentation');

-- admin_upsert_campaign 은 id 를 바꾸지 못하고(catalog_id_immutable), 같은 id 로 본문을 고쳐도 노출 설정은 그대로다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cp_uid(1)::text, true);
select pg_temp.cp_expect($q$select public.admin_upsert_campaign('cp-pub-other', 'event', '이름 바꾸기', null, 'published', now() - interval '1 day', now() + interval '10 days', null, null, null, null, '[]'::jsonb, 'cp-pub-renamed')$q$,
 '22023', 'campaign ids are immutable through admin_upsert_campaign');
select pg_temp.cp_expect($q$select public.admin_upsert_campaign('cp-pub-renamed', 'event', '제목만 바꾸기', null, 'published', now() - interval '1 day', now() + interval '10 days', null, null, null, null, '[]'::jsonb, 'cp-pub-renamed')$q$,
 'ok', 'a body edit of the same id works');
reset role;
select pg_temp.cp_assert((select popup_mode = 'offline' and card_link_path = '/shop' from public.campaign_presentations where campaign_id = 'cp-pub-renamed'), 'a campaign body edit keeps its presentation');
select pg_temp.cp_assert((select title = '제목만 바꾸기' from public.campaigns where id = 'cp-pub-renamed'), 'the body edit was applied');

rollback;
