-- Last Bell progression is unlocked by spatial/interaction/actor evidence in
-- the fixed-step simulation. These values are only conservative server-side
-- physical lower bounds against an impossible burst replay; they do not
-- represent or enforce the 10-minute human playtest target.

update private.last_bell_progression_rules
set minimum_elapsed_ms = case stage
  when 1 then 0
  when 2 then 1000
  when 3 then 4000
  when 4 then 15000
  when 5 then 18000
  when 6 then 20000
  when 7 then 20000
  when 8 then 20000
  when 9 then 23000
  when 10 then 128000
  when 11 then 138000
  else minimum_elapsed_ms
end,
minimum_transition_ms = case stage
  when 1 then 0
  when 2 then 1000
  when 3 then 3000
  when 4 then 11000
  when 5 then 2000
  when 6 then 1000
  when 7 then 0
  when 8 then 0
  when 9 then 3000
  when 10 then 105000
  when 11 then 10000
  else minimum_transition_ms
end;
