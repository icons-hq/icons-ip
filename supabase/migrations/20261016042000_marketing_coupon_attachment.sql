begin;

CREATE OR REPLACE FUNCTION private.normalize_marketing_content(p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare template text; title text; body text; image_path text; ids text[]; button jsonb; buttons jsonb:='[]'; max_lines integer;
begin
 if p_content is null or jsonb_typeof(p_content)<>'object' or not(p_content ?& array['template','title','body','imagePath','goodIds','buttons'])
  or exists(select 1 from jsonb_object_keys(p_content) key where key<>all(array['template','title','body','imagePath','goodIds','buttons','couponCode']))
  or jsonb_typeof(p_content->'template') is distinct from 'string' or jsonb_typeof(p_content->'title') is distinct from 'string'
  or jsonb_typeof(p_content->'body') is distinct from 'string' or jsonb_typeof(p_content->'imagePath') not in ('null','string')
  or jsonb_typeof(p_content->'goodIds') is distinct from 'array' or jsonb_typeof(p_content->'buttons') is distinct from 'array'
 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 if p_content?'couponCode' and (jsonb_typeof(p_content->'couponCode') not in ('null','string') or p_content->>'couponCode' !~ '^[A-Z0-9][A-Z0-9-]{2,23}$') then raise invalid_parameter_value using message='invalid_marketing_coupon';end if;
 template:=p_content->>'template';title:=btrim(p_content->>'title');body:=btrim(replace(p_content->>'body',E'\r\n',E'\n'));image_path:=p_content->>'imagePath';
 max_lines:=case template when 'text' then 16 when 'image' then 8 when 'product_list' then 2 when 'product_cards' then 2 end;
 if max_lines is null or char_length(title) not between 1 and 120 or title~'[[:cntrl:]]' or char_length(body) not between 1 and 500
  or body~E'[\\x01-\\x08\\x0B-\\x1F\\x7F]' or cardinality(string_to_array(body,E'\n'))>max_lines
  or image_path is not null and image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  or template='image' and image_path is null or template in ('text','product_cards') and image_path is not null
  or jsonb_array_length(p_content->'goodIds')>6 or jsonb_array_length(p_content->'buttons')>2
  or exists(select 1 from jsonb_array_elements(p_content->'goodIds') v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,119}$')
 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 select coalesce(array_agg(value order by position),'{}'::text[]) into ids from jsonb_array_elements_text(p_content->'goodIds') with ordinality a(value,position);
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id)
  or template in ('text','image') and cardinality(ids)<>0 or template='product_list' and cardinality(ids) not between 1 and 3
  or template='product_cards' and cardinality(ids) not between 1 and 6 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 for button in select value from jsonb_array_elements(p_content->'buttons') loop
  if jsonb_typeof(button)<>'object' or not(button ?& array['label','path'])
   or exists(select 1 from jsonb_object_keys(button) key where key<>all(array['label','path']))
   or jsonb_typeof(button->'label') is distinct from 'string' or char_length(btrim(button->>'label')) not between 1 and 20 or button->>'label'~'[[:cntrl:]]'
   or jsonb_typeof(button->'path') is distinct from 'string' or char_length(button->>'path') not between 1 and 500
   or button->>'path' !~ '^/([^/].*)?$' or button->>'path'~'[[:cntrl:]]' or strpos(button->>'path',chr(92))>0
   or button->>'path'~* '^/(admin|api|auth|login|logout)(/|[?#]|$)' or strpos(button->>'path','%')>0
  then raise invalid_parameter_value using message='invalid_marketing_button';end if;
  buttons:=buttons||jsonb_build_array(jsonb_build_object('label',btrim(button->>'label'),'path',button->>'path'));
 end loop;
 return jsonb_build_object('template',template,'title',title,'body',body,'imagePath',image_path,'goodIds',to_jsonb(ids),'buttons',buttons)||case when p_content?'couponCode' then jsonb_build_object('couponCode',p_content->'couponCode') else '{}'::jsonb end;
end $function$;


create function private.marketing_coupon_document(p_code text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('code',c.code,'name',c.name,'discountType',c.discount_type,'discountValue',c.discount_value,
  'maxDiscountAmount',c.max_discount_amount,'minSubtotal',c.min_subtotal,'startsAt',c.starts_at,'endsAt',c.ends_at,
  'validDays',c.valid_days,'issueStartsAt',coalesce(c.issue_starts_at,c.starts_at),'issueEndsAt',case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end,
  'available',c.status='active' and coalesce(c.issue_starts_at,c.starts_at)<=statement_timestamp()
    and ((case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end) is null or (case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end)>statement_timestamp())
    and (c.ends_at is null or c.ends_at>statement_timestamp()) and (c.issue_limit is null or c.issued_count<c.issue_limit))
 from public.coupons c where c.code=p_code;
$$;
revoke all on function private.marketing_coupon_document(text) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION private.marketing_content_available(p_content jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select not exists(select 1 from jsonb_array_elements_text(p_content->'goodIds') requested(id)
  left join public.goods g on g.id=requested.id left join public.ips i on i.id=g.ip_id
  where g.id is null or g.archived_at is not null or g.published_at is null or g.sale_restriction<>'none' or i.archived_at is not null or i.published_at is null) and (p_content->>'couponCode' is null or exists(select 1 from public.coupons c where c.code=p_content->>'couponCode' and c.status='active' and (c.ends_at is null or c.ends_at>statement_timestamp()) and ((case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end) is null or (case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end)>statement_timestamp())));
$function$;

CREATE OR REPLACE FUNCTION private.marketing_campaign_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',c.id,'reference',c.reference,'name',c.name,'revision',c.revision,'state',c.state,'segmentId',c.segment_id,
  'segmentRevision',c.segment_revision,'segmentName',s.name,'rule',c.rule,'ruleHash',c.rule_hash,'content',c.content,'coupon',private.marketing_coupon_document(c.content->>'couponCode'),'schedule',c.schedule,'exclusion',c.exclusion,
  'createdAt',c.created_at,'updatedAt',c.updated_at,'archived',c.archived_at is not null,
  'estimate',private.customer_segment_estimate_document(c.estimate_id),
  'selectedProducts',coalesce((select jsonb_agg(jsonb_build_object('kind','good','id',g.id,'label',g.name,'extra',g.code) order by requested.position) from jsonb_array_elements_text(c.content->'goodIds') with ordinality requested(id,position) join public.goods g on g.id=requested.id),'[]'::jsonb),
  'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'scheduledAt',r.scheduled_at,'state',r.state,'reason',r.reason,'startedAt',r.started_at,'completedAt',r.completed_at,
   'candidateCount',r.candidate_count,'sentCount',(select count(*) from private.marketing_recipients rec where rec.run_id=r.id and rec.state='sent'),
   'excludedCount',(select count(*) from private.marketing_recipients rec where rec.run_id=r.id and rec.state='excluded'),
   'readCount',(select count(*) from private.marketing_recipients rec join public.notifications n on n.id=rec.notification_id where rec.run_id=r.id and n.read_at is not null)) order by r.scheduled_at,r.id)
   from private.marketing_runs r where r.campaign_id=c.id),'[]'::jsonb)) from private.marketing_campaigns c join private.customer_segments s on s.id=c.segment_id where c.id=p_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_marketing_message(p_recipient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or private.is_account_write_fenced(auth.uid()) then return null;end if;
 select jsonb_build_object('id',rec.id,'registeredAt',rec.registered_at,'content',c.content,'coupon',private.marketing_coupon_document(c.content->>'couponCode'),
  'goodIds',coalesce((select jsonb_agg(g.id order by choice.position)
    from jsonb_array_elements_text(c.content->'goodIds') with ordinality choice(id,position) join public.goods g on g.id=choice.id join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null),'[]'::jsonb)) into result
 from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id join private.marketing_campaigns c on c.id=r.campaign_id
 where rec.id=p_recipient_id and rec.customer_id=auth.uid() and rec.state='sent' and exists(select 1 from public.profiles where id=auth.uid() and suspended_at is null);
 return result;
end $function$;


create function public.admin_marketing_coupon_options(p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value;end if;
 with filtered as materialized(select c.code,c.name from public.coupons c where c.status='active' and (c.ends_at is null or c.ends_at>statement_timestamp())
  and (p_query='' or strpos(lower(c.code||' '||c.name),lower(btrim(p_query)))>0)), rows as(select * from filtered order by name,code limit 20 offset(p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,'rows',coalesce((select jsonb_agg(private.marketing_coupon_document(code) order by name,code) from rows),'[]')) into result;return result;
end $$;
revoke all on function public.admin_marketing_coupon_options(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_marketing_coupon_options(text,integer) to authenticated;
select private.register_operator_rpc_contract('public.admin_marketing_coupon_options(text,integer)'::regprocedure,'marketing.manage','read',false);
commit;
