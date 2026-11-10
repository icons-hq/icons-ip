"""Actual nonwaiting collector races; callable only by a reviewed leased-clone harness."""
from __future__ import annotations
import json,os,signal,subprocess,time,uuid

def fixture_id(n):return 'a7220000-0000-4000-8000-'+str(n).zfill(12)

def main(cid,database,out,owned,run,read_sql,quote):
    owned();children=[];cases=[]
    def check(value,message):
        if not value:raise RuntimeError(message)
    def start(body,label,open_input=False):
        owned();application='rrh_'+label+'_'+uuid.uuid4().hex[:8]
        child=subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        children.append(child);child.stdin.write('set application_name='+quote(application)+";set statement_timeout='15s';set lock_timeout='10s';\n"+body+'\n');child.stdin.flush()
        if not open_input:child.stdin.close();child.stdin=None
        return child,application
    def observe(application):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            owned();actual=read_sql(cid,database,"select coalesce(state,'')||'|'||coalesce(wait_event_type,'') from pg_stat_activity where datname="+quote(database)+' and application_name='+quote(application))
            if actual.startswith('idle in transaction|'):return actual
            time.sleep(.04)
        raise RuntimeError('owned_holder_not_ready:'+application)
    def finish(child,label,expected=None,timeout=6):
        stdout,stderr=child.communicate(timeout=timeout);path=out/('race-'+label+'.log');path.write_text(stdout+stderr);path.chmod(0o600)
        if expected:check(child.returncode!=0 and expected in stderr,label+':expected_error_missing')
        else:check(child.returncode==0,label+':unexpected_error')
        lines=[line for line in stdout.splitlines() if line.startswith('{')]
        return json.loads(lines[-1]) if lines else None
    def release(child,commit=True):child.stdin.write(('commit;' if commit else 'rollback;')+'\n');child.stdin.close();child.stdin=None
    def call(label):
        child,_=start('begin;set local role service_role;select public.service_observe_review_rating_daily();commit;',label)
        return finish(child,label)
    def contract(label,sql):run('begin;select pg_advisory_xact_lock(1920168564,1);'+sql+';commit;',label)
    def observations():return json.loads(read_sql(cid,database,"select coalesce(jsonb_agg(to_jsonb(d) order by as_of),'[]') from private.review_rating_daily_observations d where version=7722;"))
    lock='select pg_advisory_xact_lock(1920168564,1);'
    enable='update private.review_rating_observation_contracts set enabled=true,collection_started_at=coalesce(collection_started_at,clock_timestamp()) where version=7722'
    today="(clock_timestamp() at time zone 'Asia/Seoul')::date-1"
    clear='delete from private.review_rating_daily_observations where version=7722 and as_of='+today+';update private.review_rating_observation_contracts set last_success_at=null where version=7722'
    try:
        check(read_sql(cid,database,"select (clock_timestamp() at time zone 'Asia/Seoul')::time>=time '00:05';")=='t','actual_positive_race_requires_KST_00_05_or_later')
        contract('enable-synthetic-version',enable)
        before=observations();holder,name=start('begin;'+lock+'select 1;','busy-holder',True);observe(name)
        started=time.monotonic();result=call('immediate-busy');elapsed=(time.monotonic()-started)*1000
        check(result==dict(status='busy',version=None,asOf=None,observedAt=None,fingerprint=None) and holder.poll() is None and observations()==before,'busy_did_not_return_without_holder_release')
        release(holder);finish(holder,'busy-holder-commit');cases.append(dict(name='immediate_busy',holderStillOpenWhenWorkerReturned=True,elapsedMs=elapsed,status='PASS'))

        winner,name=start('begin;set local role service_role;select public.service_observe_review_rating_daily();','first-winner',True);observe(name)
        loser=call('first-loser');check(loser['status']=='busy','concurrent_first_not_busy')
        release(winner);first=finish(winner,'first-winner-commit');repeat=call('response-loss-retry')
        check(first['status']=='recorded' and repeat=={**first,'status':'already_recorded'} and len(observations())==1,'first_observation_not_exactly_once')
        cases.append(dict(name='simultaneous_first_and_response_loss_retry',oneRow=True,sameObservedAt=True,sameFingerprint=True,status='PASS'))

        contract('clear-own-observation-for-rollback',clear)
        loser,name=start('begin;set local role service_role;select public.service_observe_review_rating_daily();','rollback-first',True);observe(name)
        check(call('rollback-contender')['status']=='busy','rollback_contender_not_busy')
        release(loser,False);discarded=finish(loser,'rollback-first-result');check(not observations(),'rolled_back_first_left_observation')
        recorded=call('after-rollback-recorded');check(recorded['status']=='recorded' and recorded['observedAt']!=discarded['observedAt'] and len(observations())==1,'rollback_retry_not_new_first_success')
        cases.append(dict(name='rollback_first_then_retry',uncommittedResultNotRetained=True,status='PASS'))

        holder,name=start('begin;'+lock+'update private.review_rating_observation_contracts set enabled=false where version=7722;select 1;','stop-holder',True);observe(name)
        check(call('stop-contender')['status']=='busy','stop_not_serialized');release(holder);finish(holder,'stop-commit')
        check(call('after-stop')['status']=='disabled','committed_stop_not_observed');before=observations()
        holder,name=start('begin;'+lock+enable+';select 1;','resume-holder',True);observe(name)
        check(call('resume-contender')['status']=='busy','resume_not_serialized');release(holder);finish(holder,'resume-commit')
        check(call('after-resume')['status']=='already_recorded' and observations()==before,'resume_replaced_first_observation')
        cases.append(dict(name='stop_resume_ordering',originalObservationPreserved=True,status='PASS'))

        # A committed live review change affects the next live view, never today's first observation.
        before=observations();run("begin;update public.reviews set rating=2 where id="+quote(fixture_id(301))+";commit;",'mutate-live-review')
        check(call('after-live-mutation')['status']=='already_recorded' and observations()==before,'live_change_rewrote_observation')
        cases.append(dict(name='live_mutation_after_collection',firstObservationUnchanged=True,status='PASS'))

        signature='public.admin_review_insights(text,text,text,integer,integer)'
        definition=read_sql(cid,database,'select pg_get_functiondef('+quote(signature)+'::regprocedure);')
        check(definition.count('AS $function$')==1,'current_reader_drift_anchor_changed')
        drift=definition.replace('AS $function$','AS $function$\n-- clone-only source drift\n',1)
        holder,name=start('begin;'+lock+drift+';select 1;','source-drift-holder',True);observe(name)
        check(call('source-drift-contender')['status']=='busy','source_drift_not_serialized');release(holder);finish(holder,'source-drift-commit')
        worker,_=start('begin;set local role service_role;select public.service_observe_review_rating_daily();commit;','drift-collector')
        finish(worker,'drift-collector','review_rating_contract_changed')
        claims=json.dumps({'sub':fixture_id(1),'role':'authenticated','session_id':fixture_id(101)})
        auth="do $$begin perform set_config('request.jwt.claim.sub',"+quote(fixture_id(1))+",true);perform set_config('request.jwt.claims',"+quote(claims)+",true);end$$;set local role authenticated;"
        worker,_=start('begin;'+auth+"select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1);commit;",'drift-history')
        finish(worker,'drift-history','review_rating_contract_changed');run('begin;'+definition+';commit;','restore-current-reader')
        check(read_sql(cid,database,'select pg_get_functiondef('+quote(signature)+'::regprocedure);')==definition,'source_definition_not_restored')
        cases.append(dict(name='committed_source_drift',collectorFailedClosed=True,historyFailedClosed=True,originalDefinitionRestored=True,status='PASS'))
        return dict(status='PASS',cases=cases)
    finally:
        for child in children:
            if child.poll() is None:
                try:os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:child.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    try:os.killpg(child.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    child.communicate(timeout=3)
