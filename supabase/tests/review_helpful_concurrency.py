"""Concurrency probes restricted to the caller's newly leased disposable clone."""
import os,signal,subprocess,time,uuid

def main(cid,db,out,own,run,sql,quote):
    own();results=[];children=[]
    def check(v,msg):
        if not v:raise RuntimeError(msg)
    def start(body,name,open_input=False):
        own();app='helpful_'+name+'_'+uuid.uuid4().hex[:8]
        p=subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        children.append(p)
        p.stdin.write('set application_name='+quote(app)+";set statement_timeout='15s';set lock_timeout='12s';\n"+body+'\n');p.stdin.flush()
        if not open_input:p.stdin.close();p.stdin=None
        return p,app
    def state(app,wanted):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            own()
            actual=sql(cid,db,'select coalesce(state,\'\')||\'|\'||coalesce(wait_event_type,\'\') from pg_stat_activity where datname='+quote(db)+' and application_name='+quote(app))
            if wanted(actual):return actual
            time.sleep(.04)
        raise RuntimeError('Expected lock state absent '+app+':'+actual)
    def finish(p,label,expected=None):
        stdout,stderr=p.communicate(timeout=18)
        (out/('race-'+label+'.log')).write_text(stdout+stderr)
        if expected:check(p.returncode!=0 and expected in stderr,label+': expected '+expected+' got '+stderr)
        else:check(p.returncode==0,label+': '+stderr)
        return stdout
    def release(p,commit=True):
        p.stdin.write('commit;\n' if commit else 'rollback;\n');p.stdin.close();p.stdin=None
    def writer(actor,review=301,pdp='helpful-a',marked=True):
        return "begin;select helpful_test.actor(%d);set local role authenticated;select public.set_review_helpful(%s,helpful_test.id(%d),%s);commit;"%(actor,quote(pdp),review,str(marked).lower())
    def retry_race(label,mutation,actor,review,pdp,after_error):
        blocker,name=start('begin;'+mutation+';select 1;',label+'-block',True)
        observed=state(name,lambda s:s.startswith('idle in transaction|'))
        worker,_=start(writer(actor,review,pdp),label+'-write')
        finish(worker,label+'-retry','review_helpful_retry')
        release(blocker);finish(blocker,label+'-commit')
        worker,_=start(writer(actor,review,pdp),label+'-after');finish(worker,label+'-after',after_error)
        results.append(dict(name=label,observed=observed,result='PASS'))
    try:
        # Same-voter desired states serialize on the existing account advisory key.
        blocker,name=start("begin;select helpful_test.actor(3);set local role authenticated;select public.set_review_helpful('helpful-a',helpful_test.id(301),true);",'same-actor-block',True)
        state(name,lambda s:s.startswith('idle in transaction|'))
        worker,wname=start(writer(3,marked=False),'same-actor-write')
        observed=state(wname,lambda s:s.endswith('|Lock'))
        release(blocker);finish(blocker,'same-actor-first');finish(worker,'same-actor-second')
        check(sql(cid,db,"select count(*) from private.review_helpful_votes where review_id=helpful_test.id(301) and user_id=helpful_test.id(3)")=='0','same-actor final state differs')
        results.append(dict(name='same_actor_desired_state',observed=observed,finalCount=0,result='PASS'))
        # Existing account deletion mutex excludes a new vote after fence commit.
        mutation="select private.lock_account_action_subject(helpful_test.id(4));insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values(helpful_test.id(611),helpful_test.id(4),helpful_test.id(612),'awaiting_email_intent');insert into private.account_action_fences(subject_user_id,deletion_event_id) values(helpful_test.id(4),helpful_test.id(611))"
        blocker,name=start('begin;'+mutation+';select 1;','fence-block',True);state(name,lambda s:s.startswith('idle in transaction|'))
        worker,wname=start(writer(4),'fence-write');observed=state(wname,lambda s:s.endswith('|Lock'))
        release(blocker);finish(blocker,'fence-commit');finish(worker,'fence-after','review_helpful_account_unavailable')
        results.append(dict(name='account_fence',observed=observed,result='PASS'))
        retry_race('review_hide',"update public.reviews set status='hidden',hidden_at=now(),hidden_reason='TEST race' where id=helpful_test.id(303)",3,303,'helpful-a','review_helpful_review_unavailable')
        retry_race('goods_unpublish',"update public.goods set published_at=null where id='helpful-c'",3,305,'helpful-c','review_helpful_review_unavailable')
        # The real group writer acquires the exact topology key the new writer shares.
        mutation="select helpful_test.actor(1);set local role authenticated;select public.admin_save_goods_group(helpful_test.id(501),1,'{\"name\":\"TEST 도움 그룹\",\"optionNames\":[\"색상\"],\"members\":[{\"goodId\":\"helpful-a\",\"values\":[\"빨강\"]}]}',helpful_test.id(503),helpful_test.id(1),helpful_test.id(101))"
        retry_race('group_detach',mutation,3,302,'helpful-a','review_helpful_review_unavailable')
        retry_race('provider_ban',"update auth.users set banned_until=now()+interval '1 hour' where id=helpful_test.id(5)",5,301,'helpful-a','review_helpful_account_unavailable')
        retry_race('session_revoke',"delete from auth.sessions where id=helpful_test.id(106)",6,301,'helpful-a','review_helpful_auth_required')
        # IP visibility is independent from product visibility.
        retry_race('ip_unpublish',"update public.ips set published_at=null where id='helpful-ip'",3,301,'helpful-a','review_helpful_review_unavailable')
        check(sql(cid,db,'select count(*) from private.review_helpful_votes where review_id in(select helpful_test.id(300+n) from generate_series(1,5)n)')=='0','race left an unauthorized vote')
        return dict(status='PASS',cases=results,finalVoteCount=0)
    finally:
        for p in children:
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:p.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    try:os.killpg(p.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    p.communicate(timeout=3)
