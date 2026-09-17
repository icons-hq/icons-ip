import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminShell } from '../../components/admin/AdminShell';
import { GoodEditorFixture } from './good-editor';
import { GoodsOptionEditor } from '../../components/admin/GoodsOptionEditor';
import { AdminSelect } from '../../components/admin/console/AdminSelect';
import { ConsoleFilterPanel } from '../../components/admin/console/ConsoleFilterPanel';
import { GoodsListScreen } from '../../components/admin/screens/GoodsListScreen';
import { normalizeGoodsListFilters, type AdminGoodsListData } from '../../lib/admin/goods-list';
import type { GoodsOptionRow } from '../../lib/admin/goods-option-editor';
import { FIXTURE_GOODS, FIXTURE_IPS, FIXTURE_OPTION_ROWS } from './fixtures';
import './fixture.css';
import '../../app/globals.css';
import '../../app/styles/wc-foundation.css';
import '../../app/styles/wc-admin-surfaces.css';
import '../../app/styles/wc-admin.css';
import '../../app/styles/wc-catalog.css';
import '../../app/styles/admin-goods-worklist.css';
import '../../app/styles/wc-admin-option-artwork.css';
import '../../app/styles/admin-ux-521.css';
import '../../app/styles/admin-faq.css';
import '../../app/styles/admin-goods-notice-presets.css';
import '../../app/styles/admin-order-detail.css';
import '../../app/styles/admin-customer-detail.css';
import '../../app/styles/admin-store-settings.css';

type FixtureView = 'goods' | 'filter-date' | 'options' | 'editor' | 'shell';

const ADMIN = { id: 'fixture-staff', email: 'fixture.staff@local.test', role: 'staff' };

function currentView(): FixtureView {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('view');
  if (value === 'filter-date' || value === 'options' || value === 'editor' || value === 'shell') return value;
  if (window.location.pathname.startsWith('/admin/sales/orders')) return 'filter-date';
  if (window.location.pathname.startsWith('/admin/catalog/goods')) return 'goods';
  return 'goods';
}

function goodsData(): AdminGoodsListData {
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
  const filters = normalizeGoodsListFilters(params);
  const query = filters.query.toLocaleLowerCase('ko-KR');
  const goods = query
    ? FIXTURE_GOODS.filter((good) => `${good.name} ${good.code} ${good.id}`.toLocaleLowerCase('ko-KR').includes(query))
    : FIXTURE_GOODS;
  return { filters, goods, total: goods.length, ips: FIXTURE_IPS };
}

function RouteSwitcher({ active }: { active: FixtureView }) {
  return (
    <nav aria-label="Fixture route selector" className="fixture-route-switcher">
      <span className="fixture-route-switcher__label">component fixture</span>
      {(['goods', 'filter-date', 'options', 'editor', 'shell'] as FixtureView[]).map((view) => (
        <a className={view === active ? 'is-active' : undefined} href={`/?view=${view}`} key={view}>
          {view}
        </a>
      ))}
    </nav>
  );
}

function FixtureFrame({ view, children }: { view: FixtureView; children: React.ReactNode }) {
  return (
    <>
      <RouteSwitcher active={view} />
      <AdminShell admin={ADMIN}>
        {children}
      </AdminShell>
    </>
  );
}

function GoodsFixture() {
  return <GoodsListScreen data={goodsData()} />;
}

function DateFilterFixture() {
  const [submitted, setSubmitted] = useState('');
  const [controlledValue, setControlledValue] = useState('short');
  const showSelectProbe = new URLSearchParams(window.location.search).get('selectProbe') === '1';
  return (
    <section className="wc-admin-kit fixture-filter-screen">
      <header className="wc-admin-kit wc-admin-kit__page-header">
        <div>
          <h2 className="wc-admin-kit__heading">주문 통합검색 filter fixture</h2>
          <p className="wc-admin-kit__description">긴 한국어 상태·검색 유형과 날짜 범위를 실제 ConsoleFilterPanel로 확인합니다.</p>
        </div>
      </header>
      <ConsoleFilterPanel
        action="/admin/sales/orders"
        dateRange={{ from: '2026-09-01', to: '2026-09-14', label: '조회기간' }}
        idPrefix="fixture-date-filter"
        search={{
          fields: [
            { value: 'buyer', label: '구매자 이름·이메일·주문번호·수취인·휴대전화·배송지·거래확정 상태 전체 검색' },
            { value: 'order', label: '주문번호' },
          ],
          fieldValue: new URLSearchParams(window.location.search).get('searchField') ?? 'buyer',
          label: '주문 검색어',
          name: 'q',
          placeholder: '긴 한국어 검색어를 입력하세요',
          value: new URLSearchParams(window.location.search).get('q') ?? '',
        }}
        statusFilter={{
          label: '처리 상태',
          name: 'status',
          options: [
            { value: 'all', label: '전체 상태' },
            { value: 'shipping', label: '배송 완료 후 거래확정 대기 상태' },
            { value: 'pending', label: '결제 대기·입금 확인 필요' },
          ],
          value: 'all',
        }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="fixture-origin">출고지</label>
          <select defaultValue="all" id="fixture-origin" name="originId">
            <option value="all">전체 출고지·택배사 연동 상태</option>
            <option value="gimpo">김포 물류센터·장문 이름 검수</option>
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="fixture-stock">배송 방식</label>
          <select defaultValue="all" id="fixture-stock" name="method">
            <option value="all">전체 배송 방식</option>
            <option value="parcel">택배·운송장 등록 대상</option>
            <option value="pickup">퀵·방문수령·주문 상세 확인</option>
          </select>
        </div>
      </ConsoleFilterPanel>
      {submitted ? <p className="fixture-feedback" role="status">GET 보존 확인: {submitted}</p> : null}
      <button className="fixture-readonly-action" onClick={() => setSubmitted(window.location.search)} type="button">
        현재 GET 상태 읽기
      </button>
      {showSelectProbe ? (
        <section aria-label="AdminSelect controlled and form reset probe" className="fixture-select-probe">
          <h3>AdminSelect probe</h3>
          <AdminSelect
            aria-label="controlled AdminSelect probe"
            id="fixture-controlled-select"
            name="controlledProbe"
            onChange={(event) => setControlledValue(event.target.value)}
            value={controlledValue}
          >
            <option value="short">짧은 선택값</option>
            <option value="long">외부 controlled prop으로 바뀌는 매우 긴 선택값 전체 표시 검수</option>
          </AdminSelect>
          <button className="fixture-readonly-action" id="fixture-controlled-toggle" onClick={() => setControlledValue((value) => value === 'short' ? 'long' : 'short')} type="button">
            controlled 선택값 전환
          </button>
          <form id="fixture-native-reset-form">
            <AdminSelect aria-label="native form reset probe" defaultValue="short" id="fixture-reset-select" name="resetProbe">
              <option value="short">짧은 기본 선택값</option>
              <option value="long">form.reset으로 돌아갈 매우 긴 선택값</option>
            </AdminSelect>
            <button className="fixture-readonly-action" type="reset">form.reset</button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

function OptionsFixture() {
  const [rows, setRows] = useState<GoodsOptionRow[]>(FIXTURE_OPTION_ROWS);
  const [savedRows, setSavedRows] = useState<GoodsOptionRow[]>(FIXTURE_OPTION_ROWS);
  return (
    <section className="wc-admin-kit fixture-options-screen">
      <header className="wc-admin-kit wc-admin-kit__page-header">
        <div>
          <h2 className="wc-admin-kit__heading">상품 옵션 편집 fixture</h2>
          <p className="wc-admin-kit__description">실제 GoodsOptionEditor. 조합 생성과 행 상태 변경은 브라우저 로컬 상태만 바꿉니다.</p>
        </div>
      </header>
      <GoodsOptionEditor
        axisValues={{
          optionAxisName0: '색상',
          optionAxisName1: '사이즈',
          optionAxisValues0: '크림화이트, 딥네이비, 세이지그린',
          optionAxisValues1: 'S, M, L',
        }}
        baseline={['fixture-option-baseline']}
        basePrice={26000}
        codePrefix="LONG-KR-OPTION"
        rows={rows}
        onRowsChange={setRows}
      />
      <div className="fixture-options-footer">
        <button className="fixture-readonly-action" onClick={() => setSavedRows(rows)} type="button">로컬 행 스냅샷</button>
        <span role="status">현재 {rows.length}행 · 스냅샷 {savedRows.length}행 · 저장 action 없음</span>
      </div>
    </section>
  );
}

function ShellFixture() {
  return (
    <section className="wc-admin-kit fixture-shell-screen">
      <header className="wc-admin-kit wc-admin-kit__page-header">
        <div>
          <h2 className="wc-admin-kit__heading">AdminShell interaction fixture</h2>
          <p className="wc-admin-kit__description">사이드바 접기와 account menu만 검수하며 인증·로그아웃·서버 action은 호출하지 않습니다.</p>
        </div>
      </header>
      <div className="wc-admin-kit wc-admin-kit__card">
        <strong>셸 상태 확인</strong>
        <p>데스크톱에서 사이드바 접기를 누른 뒤 `.collapsed`와 아이콘-only 내비게이션을 확인하세요.</p>
      </div>
    </section>
  );
}

function App() {
  const view = currentView();
  useEffect(() => {
    const blockExternal = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api')) {
        return Promise.reject(new Error('admin visual fixture blocks external/API requests'));
      }
      return blockExternal(input, init);
    };
    return () => { window.fetch = blockExternal; };
  }, []);
  const content = view === 'goods'
    ? <GoodsFixture />
    : view === 'filter-date'
      ? <DateFilterFixture />
      : view === 'options'
        ? <OptionsFixture />
        : view === 'editor' ? <GoodEditorFixture /> : <ShellFixture />;
  return <FixtureFrame view={view}>{content}</FixtureFrame>;
}

createRoot(document.getElementById('fixture-root')!).render(<App />);
