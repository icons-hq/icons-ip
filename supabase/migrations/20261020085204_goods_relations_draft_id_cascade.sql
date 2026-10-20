-- Draft goods can change their public URL through admin_save_good. Editorial
-- references follow that identity change just like existing catalog links.
alter table public.goods_relations drop constraint goods_relations_representative_good_id_fkey;
alter table public.goods_relations add constraint goods_relations_representative_good_id_fkey
  foreign key(representative_good_id) references public.goods(id) on update cascade;
alter table public.goods_relation_members drop constraint goods_relation_members_good_id_fkey;
alter table public.goods_relation_members add constraint goods_relation_members_good_id_fkey
  foreign key(good_id) references public.goods(id) on update cascade;
