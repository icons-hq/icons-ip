-- The verified run begins before the optional natural cold-open. A ready-gated
-- skip reaches the same interactive handoff immediately, so the authority
-- cannot treat the 18-second cinematic as a trusted client signal. Keep the
-- per-transition active-route minima; lower only whole-route floors by the
-- externally timed cold-open duration.

update private.last_bell_progression_rules
set minimum_elapsed_ms = case stage
  when 1 then 0
  when 2 then 47000
  when 3 then 47000
  when 4 then 232000
  when 5 then 362000
  when 6 then 407000
  when 7 then 407000
  when 8 then 407000
  when 9 then 442000
  when 10 then 572000
  when 11 then 582000
  else minimum_elapsed_ms
end,
minimum_transition_ms = case stage
  when 1 then 0
  when 2 then 47000
  when 3 then 0
  when 4 then 185000
  when 5 then 130000
  when 6 then 45000
  when 7 then 0
  when 8 then 0
  when 9 then 35000
  when 10 then 130000
  when 11 then 10000
  else minimum_transition_ms
end;
