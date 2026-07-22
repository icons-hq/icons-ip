create temporary table figure_good_ids as
select id
from public.goods
where name ~* '(피규어|figure|figurine)'
   or type ~* '(피규어|figure|figurine)';

with rewritten as (
  select
    game.id,
    coalesce(
      jsonb_agg(to_jsonb(lineup.good_id) order by lineup.ordinality)
        filter (where figure_good.id is null),
      '[]'::jsonb
    ) as goods_ids
  from public.games as game
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(game.config #> '{variant,goodsIds}') = 'array'
        then game.config #> '{variant,goodsIds}'
      else '[]'::jsonb
    end
  ) with ordinality as lineup(good_id, ordinality)
  left join figure_good_ids as figure_good on figure_good.id = lineup.good_id
  where game.config #>> '{variant,kind}' = 'goods'
    and jsonb_typeof(game.config #> '{variant,goodsIds}') = 'array'
  group by game.id
)
update public.games as game
set config = jsonb_set(
  jsonb_set(game.config, '{variant,goodsIds}', rewritten.goods_ids),
  '{marbleCount}',
  to_jsonb(jsonb_array_length(rewritten.goods_ids))
)
from rewritten
where game.id = rewritten.id
  and game.config #> '{variant,goodsIds}' is distinct from rewritten.goods_ids;

update public.reward_policies as policy
set active = false
where policy.active
  and policy.target_good_id in (select id from figure_good_ids);

update public.goods
set
  stock = 'soldout',
  stock_qty = 0,
  archived_at = pg_catalog.now()
where archived_at is null
  and id in (select id from figure_good_ids);

update public.ips
set synopsis = case id
  when 'kakao-friends' then '라이언, 춘식이, 어피치 등 카카오프렌즈 감성의 피크닉 굿즈와 소품 mock 라인입니다.'
  when 'attack-on-titan' then '진격의 거인 리바이의 차분한 전투 전야 무드를 아크릴과 카드로 구성한 mock 컬렉션입니다.'
end
where id in ('kakao-friends', 'attack-on-titan');
