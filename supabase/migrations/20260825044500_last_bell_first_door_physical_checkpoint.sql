-- The classroom slider now follows its physical contract immediately:
-- open -> passage sensor -> close -> closed -> lock -> locked -> checkpoint.
-- A ready-gated skip can complete that sequence in about six seconds. The
-- following restore-power objective still requires the observable 47-second
-- first-infected stealth traversal, so removing the door wait does not remove
-- the authored encounter evidence or the full-route floor.

update private.last_bell_progression_rules
set
  minimum_elapsed_ms = 6000,
  minimum_transition_ms = 6000
where stage = 2;

update private.last_bell_progression_rules
set
  minimum_elapsed_ms = 47000,
  minimum_transition_ms = 41000
where stage = 3;
