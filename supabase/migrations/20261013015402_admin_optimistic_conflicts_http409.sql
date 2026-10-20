-- A stale editor version is an application HTTP 409, not PostgreSQL SQLSTATE
-- 40001. In the local Supabase HTTP stack, explicitly raising 40001 waited
-- until the 60-second gateway timeout, hiding the actionable conflict message.
-- Replace only this exact allowlist of manual domain-conflict raises. Genuine
-- engine serialization failures and customer reserve_tickets are untouched.
-- CREATE OR REPLACE keeps existing ownership/ACL. Assert every other pg_proc
-- attribute and the complete body (apart from the raise token) remain identical.
do $migration$
declare target record; target_oid oid; original_source text; original_definition text;
  original_metadata jsonb; actual_messages text[]; changed_source text; changed_metadata jsonb;
begin
  for target in select * from (values
    ('public.admin_delete_faq_entry(uuid,timestamp with time zone)','faq_conflict',1),
    ('public.admin_delete_goods_notice_preset(uuid,timestamp with time zone)','goods_notice_preset_conflict',1),
    ('public.admin_mark_shipments_exported(jsonb)','shipment_changed',1),
    ('public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamp with time zone)','faq_conflict',1),
    ('public.admin_save_fulfillment_origin(uuid,jsonb,timestamp with time zone)','fulfillment_origin_conflict',1),
    ('public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamp with time zone)','goods_notice_preset_conflict',1),
    ('public.admin_save_home_layout(uuid,bigint,jsonb)','home_layout_conflict',1),
    ('public.admin_save_origin_export_columns(uuid,jsonb,timestamp with time zone)','origin_settings_changed',1),
    ('public.admin_save_shipping_carrier(text,text,text,boolean,timestamp with time zone)','store_settings_conflict',1),
    ('public.admin_save_store_branding(uuid,jsonb,timestamp with time zone)','store_settings_conflict',1),
    ('public.admin_save_store_settings(text,jsonb,timestamp with time zone)','store_settings_conflict',2),
    ('public.admin_set_ip_directory(text,boolean,integer,text[],boolean)','ip_directory_conflict',1),
    ('private.admin_commit_goods_import_group_before_category(uuid,integer)','import_product_changed',2),
    ('private.guard_ip_directory_settings()','ip_directory_conflict',1)
  ) as expected(signature,conflict_message,raise_count) loop
    target_oid:=to_regprocedure(target.signature);
    if target_oid is null then raise exception 'Missing optimistic-conflict function: %',target.signature; end if;
    select p.prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into original_source,original_definition,original_metadata
      from pg_proc p where p.oid=target_oid;
    select array_agg(matches[1]) into actual_messages
      from regexp_matches(original_source,'raise[[:space:]]+serialization_failure[[:space:]]+using[[:space:]]+message[[:space:]]*=[[:space:]]*''([^'']+)''','gi') matches;
    if cardinality(actual_messages) is distinct from target.raise_count
      or exists(select 1 from unnest(actual_messages) message where message<>target.conflict_message)
      or (length(original_source)-length(replace(original_source,'raise serialization_failure','')))/length('raise serialization_failure')<>target.raise_count
    then raise exception 'Unexpected conflict body; review before migration: %',target.signature; end if;
    execute replace(original_definition,'raise serialization_failure','raise sqlstate ''PT409''');
    select p.prosrc,to_jsonb(p)-'prosrc' into changed_source,changed_metadata from pg_proc p where p.oid=target_oid;
    if changed_source is distinct from replace(original_source,'raise serialization_failure','raise sqlstate ''PT409''')
      or changed_metadata is distinct from original_metadata
    then raise exception 'Unexpected function/ACL change: %',target.signature; end if;
  end loop;
end;
$migration$;
