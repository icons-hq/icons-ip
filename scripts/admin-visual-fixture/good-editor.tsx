import { useActionState, useState } from 'react';
import { GoodEditor } from '../../components/admin/GoodEditor';
import type { AdminCatalogActionState } from '../../app/admin/actions';
import type { Ip } from '../../lib/data';

const ip: Ip = { id: 'fixture-ip', title: '합성 IP', sub: '', v: { key: 'character', label: '캐릭터', color: '#ddd' },
  glyph: 'IP', bg: '#eee', fans: 0, goods: 0, cards: 0, featured: false, tagline: '', synopsis: '' };

/** Real edit/recovery UI with a local action; no Auth, Storage or DB writes. */
export function GoodEditorFixture() {
  const [result, setResult] = useState('failure');
  const [submitted, setSubmitted] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<AdminCatalogActionState, FormData>(async (previous, form) => {
    const values = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    setSubmitted(values);
    const attempt = (previous.attempt ?? 0) + 1;
    return result === 'success' ? { message: '합성 저장 성공', attempt } : { errors: { form: '합성 저장 실패' }, values, attempt };
  }, {});
  return <section className="col" style={{ gap: 16 }}>
    <h2>상품 편집 통합 fixture</h2>
    <label>합성 저장 결과 <select value={result} onChange={event => setResult(event.target.value)}>
      <option value="failure">실패</option><option value="success">성공</option>
    </select></label>
    <output id="fixture-good-submission" hidden>{JSON.stringify(submitted)}</output>
    <GoodEditor accountId="fixture-operator" action={action} pending={pending} state={state} selected={null} initialIpId={ip.id}
      catalogIps={[ip]} ipOptions={[{ id: ip.id, title: ip.title, archivedAt: null }]} variants={[]}
      origins={[]} categories={[]} shippingNoticeOptions={[]} regionSummaries={[]} />
  </section>;
}
