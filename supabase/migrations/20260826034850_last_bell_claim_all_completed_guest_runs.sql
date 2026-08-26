-- A guest cookie can own more than one completed run because verified chapter
-- replays are allowed before sign-in. Claim every still-valid completed run
-- for that digest before the API expires the cookie, so an earlier or later
-- replay cannot be stranded without an account owner.
create or replace function public.last_bell_claim_run(
  p_run_id uuid,
  p_user_id uuid,
  p_guest_token_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run private.last_bell_runs%rowtype;
  v_digest bytea;
  v_claim_run_id uuid;
  v_granted integer := 0;
  v_claimed_runs integer := 0;
begin
  if p_run_id is null or p_user_id is null then
    raise check_violation using message = 'invalid_claim';
  end if;
  if p_guest_token_digest is null then
    raise check_violation using message = 'invalid_guest_run_cookie';
  end if;
  v_digest := private.last_bell_digest_from_hex(p_guest_token_digest);

  -- Serialize claims for one opaque guest identity before locking individual
  -- rows. Different run ids from the same cookie therefore cannot deadlock or
  -- split ownership across accounts.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(v_digest, 'hex'), 0)
  );

  select run_record.* into v_run
  from private.last_bell_runs as run_record
  where run_record.id = p_run_id
  for update;

  if not found then raise no_data_found using message = 'run_not_found'; end if;
  if v_run.guest_token_digest is distinct from v_digest then
    raise insufficient_privilege using message = 'run_access_denied';
  end if;
  if v_run.status <> 'completed' or v_run.claim_until <= pg_catalog.now() then
    raise object_not_in_prerequisite_state using message = 'claim_not_available';
  end if;
  if v_run.user_id is not null and v_run.user_id <> p_user_id then
    raise insufficient_privilege using message = 'run_claimed_by_another_user';
  end if;
  if exists (
    select 1
    from private.last_bell_runs as sibling_run
    where sibling_run.guest_token_digest = v_digest
      and sibling_run.user_id is not null
      and sibling_run.user_id <> p_user_id
  ) then
    raise insufficient_privilege using message = 'run_claimed_by_another_user';
  end if;

  for v_claim_run_id in
    select claimable_run.id
    from private.last_bell_runs as claimable_run
    where claimable_run.guest_token_digest = v_digest
      and claimable_run.user_id is null
      and claimable_run.status = 'completed'
      and claimable_run.claim_until > pg_catalog.now()
    order by claimable_run.id
    for update
  loop
    update private.last_bell_runs
    set user_id = p_user_id, claimed_at = pg_catalog.now()
    where id = v_claim_run_id;

    v_granted := v_granted
      + private.last_bell_materialize_entitlements(v_claim_run_id, p_user_id);
    v_claimed_runs := v_claimed_runs + 1;
  end loop;

  return jsonb_build_object(
    'status', case when v_claimed_runs > 0 then 'claimed' else 'idempotent' end,
    'granted', v_granted,
    'claimedRuns', v_claimed_runs
  );
end;
$$;

revoke all on function public.last_bell_claim_run(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.last_bell_claim_run(uuid, uuid, text)
  to service_role;
