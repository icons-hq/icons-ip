-- R17 (MD-0002, 10/27 회의 28:03~28:48): 상세페이지 HTML 상한 30,000자 → 200,000자.
-- 한글로 꽉 채워도 UTF-8 약 600KB라 서버 액션 본문 3MB 안이다. lib/goods-description.ts GOODS_HTML_MAX_LENGTH와 같은 값.
-- 살아 있는 검사는 CHECK와 저장 래퍼 체인 끝(private.admin_save_good_before_discount_display, 최신 20261020085405) 두 곳이다.
-- 서버 임시저장(admin_goods_drafts)은 상세 HTML 전체를 함께 담으므로 512KB → 2MB로 함께 올린다(lib/admin/goods-drafts.ts).
begin;

alter table public.goods drop constraint goods_description_html_length;
alter table public.goods add constraint goods_description_html_length
  check(description_format <> 'html' or char_length(description) <= 200000);

do $$
declare
  body text;
  anchor text := $a$char_length(description_value)>30000$a$;
begin
  body := pg_get_functiondef('private.admin_save_good_before_discount_display(jsonb)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'goods_description_limit_anchor_missing';
  end if;
  execute replace(body, anchor, $a$char_length(description_value)>200000$a$);
end $$;
select private.register_operator_internal_contract('private.admin_save_good_before_discount_display(jsonb)'::regprocedure);

alter table public.admin_goods_drafts drop constraint admin_goods_drafts_form_values_check;
alter table public.admin_goods_drafts add constraint admin_goods_drafts_form_values_check
  check(jsonb_typeof(form_values)='object' and octet_length(form_values::text)<=2097152);

do $$
declare
  body text;
  anchor text := $a$octet_length(p_values::text)>524288$a$;
begin
  body := pg_get_functiondef('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'goods_draft_limit_anchor_missing';
  end if;
  execute replace(body, anchor, $a$octet_length(p_values::text)>2097152$a$);
end $$;
select private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure, 'catalog.manage', 'write', false);

notify pgrst, 'reload schema';
commit;
