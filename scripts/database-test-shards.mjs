import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CI DB 검증 매니페스트다. `validate-db` matrix의 샤드마다 새 러너가 `supabase db reset` 직후의
// 빈 DB를 받아 아래 순서대로 실행하므로 샤드 사이에는 상태가 없다. 각 샤드는 예전 단일
// validate의 실행 순서를 보존한 부분열이다. 테스트를 옮기거나 추가할 때도 같은 샤드에서
// 원래 앞서던 테스트 뒤에 두고, 실행 시간은 step summary의 초 단위 표를 보고 맞춘다.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const databaseContainer = 'supabase_db_icons-ip';
const kcFixture = 'supabase/tests/helpers/goods_kc_fixture.sql';

function sql(name, { admin = false, kc = false } = {}) {
  const file = `supabase/tests/${name}.sql`;
  const psql = `docker exec -i ${databaseContainer} psql -X -U ${admin ? 'supabase_admin' : 'postgres'} -d postgres -v ON_ERROR_STOP=1`;
  return { label: `${name}.sql`, command: kc ? `cat ${kcFixture} ${file} | ${psql}` : `${psql} < ${file}` };
}

// 동시성·격리 스크립트는 스코프 변수와 컨테이너가 CI 정체성과 맞을 때만 일회용 DB를 만든다.
function script(file, scopeVariable, scope = 'ci') {
  return {
    label: file,
    command: `${scopeVariable}=${scope} SUPABASE_DB_CONTAINER=${databaseContainer} bash supabase/tests/${file}`,
  };
}

function run(label, command, options = {}) {
  return { label, command, ...options };
}

const operators = [
  sql('operator_capability_coverage'),
  sql('operator_capability_guards'),
  sql('operator_manager_lifecycle'),
  sql('operator_email_invitations'),
  sql('operator_member_loyalty_projection'),
  sql('operator_manual_recovery_guards'),
  sql('admin_operator_directory'),
  sql('readable_order_numbers'),
  run(
    'readable_order_numbers_concurrency.py',
    `READABLE_ORDER_TEST_SCOPE=ci SUPABASE_DB_CONTAINER=${databaseContainer} PGDATABASE=postgres python3 supabase/tests/readable_order_numbers_concurrency.py`,
  ),
  sql('smartstore_shipment_workbook'),
  sql('admin_seller_cancel_intake'),
  sql('purchase_restriction_bulk_release'),
  sql('admin_order_item_console', { kc: true }),
  sql('admin_order_address_changes', { admin: true }),
  script('operator_capability_concurrency.sh', 'OPERATOR_CAPABILITY_TEST_SCOPE', '1'),
  script('operator_email_invitation_concurrency.sh', 'OPERATOR_INVITATION_TEST_SCOPE'),
  script('seller_cancel_intake_concurrency.sh', 'SELLER_CANCEL_TEST_SCOPE'),
  script('purchase_restriction_release_concurrency.sh', 'RESTRICTION_RELEASE_TEST_SCOPE'),
  sql('order_claim_withdrawal', { admin: true }),
  script('order_claim_withdrawal_concurrency.sh', 'CLAIM_WITHDRAWAL_TEST_SCOPE'),
  sql('order_claim_type_conversion', { admin: true }),
  script('order_claim_type_conversion_concurrency.sh', 'CLAIM_CONVERSION_TEST_SCOPE'),
  sql('order_claim_hold_operations', { admin: true }),
  script('order_claim_hold_operations_concurrency.sh', 'CLAIM_HOLD_TEST_SCOPE'),
  sql('order_claim_reason_changes', { admin: true }),
  script('order_claim_reason_changes_concurrency.sh', 'CLAIM_REASON_TEST_SCOPE'),
  script('order_address_concurrency.sh', 'ORDER_ADDRESS_TEST_SCOPE'),
  sql('goods_media', { admin: true, kc: true }),
  script('goods_media_concurrency.sh', 'GOODS_MEDIA_TEST_SCOPE'),
  sql('pg_settlement_ledger', { admin: true }),
  script('pg_settlement_ledger_concurrency.sh', 'PG_SETTLEMENT_TEST_SCOPE'),
  sql('goods_sale_period', { kc: true }),
  sql('goods_clone_attributes'),
  script('goods_sale_period_concurrency.sh', 'GOODS_SALE_PERIOD_TEST_SCOPE'),
];

const catalog = [
  sql('goods_draft_optional_revision', { admin: true }),
  sql('review_best', { admin: true, kc: true }),
  sql('home_review_best_priority', { admin: true, kc: true }),
  sql('home_review_helpful_priority', { admin: true, kc: true }),
  sql('category_display_compositions', { admin: true, kc: true }),
  sql('category_display_tree', { admin: true, kc: true }),
  sql('category_display_menu', { admin: true, kc: true }),
  script('category_display_concurrency.sh', 'CATEGORY_DISPLAY_TEST_SCOPE'),
  sql('admin_body_templates', { admin: true }),
  script('admin_body_templates_concurrency.sh', 'BODY_TEMPLATE_TEST_SCOPE'),
  script('review_best_concurrency.sh', 'REVIEW_BEST_TEST_SCOPE'),
  sql('shipment_delay_notice_filter', { admin: true }),
  sql('admin_review_sorting', { admin: true }),
  run(
    'review_helpful_regression.py',
    `python3 -B supabase/tests/review_helpful_regression.py --container ${databaseContainer} --scope ci --output-dir output/review-helpful-regression`,
  ),
  sql('admin_review_export', { admin: true, kc: true }),
  sql('review_rating_history', { admin: true, kc: true }),
  sql('goods_benefit_content', { admin: true, kc: true }),
  script('goods_benefit_content_concurrency.sh', 'GOODS_BENEFITS_TEST_SCOPE'),
  sql('catalog_category_templates', { admin: true }),
  script('catalog_category_templates_concurrency.sh', 'CATEGORY_TEMPLATES_TEST_SCOPE'),
  sql('goods_after_sales_content', { admin: true, kc: true }),
  script('goods_after_sales_content_concurrency.sh', 'GOODS_AFTER_SALES_TEST_SCOPE'),
  sql('goods_size_charts', { admin: true, kc: true }),
  script('goods_size_charts_concurrency.sh', 'GOODS_SIZE_CHART_TEST_SCOPE'),
  // 예전 story/marketing 단계의 후반부(리뷰 이벤트·매장 분석·관리자 리포트)다.
  sql('review_events', { admin: true, kc: true }),
  sql('review_event_exports', { admin: true, kc: true }),
  script('review_events_concurrency.sh', 'REVIEW_EVENTS_TEST_SCOPE'),
  sql('store_analytics', { admin: true, kc: true }),
  script('store_analytics_concurrency.sh', 'STORE_ANALYTICS_TEST_SCOPE'),
  sql('store_analytics_notice_events'),
  sql('admin_customer_purchase_report', { admin: true }),
  sql('admin_sales_goods_page'),
  sql('admin_sales_hourly_report'),
  sql('admin_benefit_issuances'),
  sql('admin_encrypted_export_audit', { admin: true }),
  sql('goods_custom_input_workbook', { admin: true }),
];

const storefront = [
  sql('goods_import_guidance', { admin: true }),
  run(
    'goods_import_guidance_concurrency.py',
    `python3 supabase/tests/goods_import_guidance_concurrency.py --container ${databaseContainer} --output-dir output/goods-import-guidance-concurrency`,
  ),
  sql('store_profile_image', { admin: true }),
  sql('goods_announcement_period_popup', { admin: true, kc: true }),
  script('goods_announcement_period_popup_concurrency.sh', 'GOODS_ANNOUNCEMENT_POPUP_TEST_SCOPE'),
  sql('cs_single_reply_cas', { admin: true }),
  sql('cs_reply_read_transaction_mode', { admin: true }),
  script('cs_single_reply_concurrency.sh', 'CS_SINGLE_REPLY_TEST_SCOPE'),
  run(
    'inquiry_satisfaction_regression.py',
    `python3 -B supabase/tests/inquiry_satisfaction_regression.py --container ${databaseContainer} --scope ci --output-dir output/inquiry-satisfaction-regression`,
  ),
  sql('admin_sales_read_contract_gaps', { admin: true }),
  script('admin_sales_read_contract_gaps_concurrency.sh', 'SALES_READ_GAP_TEST_SCOPE'),
  sql('admin_claim_detail_search', { admin: true }),
  sql('home_promotion_banner_settings', { admin: true }),
  script('home_promotion_banner_concurrency.sh', 'HOME_PROMOTION_BANNER_TEST_SCOPE'),
  sql('home_banner_style_archive', { admin: true }),
  script('home_banner_style_archive_concurrency.sh', 'HOME_BANNER_ARCHIVE_TEST_SCOPE'),
  sql('home_free_product_collections', { admin: true, kc: true }),
  script('home_free_product_collections_concurrency.sh', 'HOME_FREE_PRODUCTS_TEST_SCOPE'),
  sql('customer_marketing_consents'),
  sql('auto_order_confirmation'),
  script('auto_order_confirmation_concurrency.sh', 'AUTO_ORDER_CONFIRM_TEST_SCOPE'),
  sql('staging_test_delivery'),
  sql('commerce_number_labels'),
  sql('bank_transfer_order_number_code'),
  sql('order_item_allocation_inputs'),
  sql('cart_retained_until_payment', { admin: true, kc: true }),
  sql('home_collection_banners', { admin: true }),
  sql('ip_hall_banners', { admin: true }),
  // 예전 story/marketing 단계의 전반부(쇼핑 스토리·마케팅·상품 상세 연출)다.
  sql('shopping_stories', { kc: true }),
  sql('shopping_story_goods_picker', { kc: true }),
  sql('goods_relation_visual_compositions', { kc: true }),
  sql('goods_other_compositions', { admin: true, kc: true }),
  sql('story_navigation_and_home_layout'),
  sql('marketing_links', { kc: true }),
  script('shopping_stories_concurrency.sh', 'SHOPPING_STORIES_TEST_SCOPE'),
  script('marketing_links_concurrency.sh', 'MARKETING_LINKS_TEST_SCOPE'),
  sql('marketing_in_app_campaigns', { kc: true }),
  script('marketing_in_app_campaigns_concurrency.sh', 'MARKETING_MESSAGES_TEST_SCOPE'),
  sql('customer_target_segments'),
  script('customer_target_segments_concurrency.sh', 'CUSTOMER_SEGMENTS_TEST_SCOPE'),
  sql('store_presentation_settings', { kc: true }),
  script('store_presentation_concurrency.sh', 'STORE_PRESENTATION_TEST_SCOPE'),
  sql('product_detail_presentation', { admin: true, kc: true }),
  sql('product_detail_experiences', { admin: true, kc: true }),
  script('product_detail_experiences_concurrency.sh', 'PRODUCT_DETAIL_EXPERIENCES_TEST_SCOPE'),
  script('product_detail_presentation_concurrency.sh', 'PRODUCT_DETAIL_PRESENTATION_TEST_SCOPE'),
  script('goods_relation_visual_concurrency.sh', 'GOODS_RELATION_VISUAL_TEST_SCOPE'),
];

const commerce = [
  // full-admin 러너는 운영자 권한이 아직 설정되지 않은(configured=false) DB에서만 돈다.
  run(
    'run-full-admin-sql-tests.py',
    `python3 scripts/run-full-admin-sql-tests.py --scope ci --container ${databaseContainer} --output-dir output/full-admin-sql`,
  ),
  script('goods_transaction_isolated.sh', 'GOODS_TRANSACTION_TEST_SCOPE'),
  script('gift_orders_isolated.sh', 'GIFT_ORDER_TEST_SCOPE'),
  script('goods_subscriptions_isolated.sh', 'SUBSCRIPTION_TEST_SCOPE'),
];

const legacy = [
  run(
    'run-database-smoke-tests.sh',
    `OPERATOR_LEGACY_FIXTURE_TEST_SCOPE=1 node scripts/with-legacy-operator-fixtures.mjs --project icons-ip --container ${databaseContainer} -- bash scripts/run-database-smoke-tests.sh`,
  ),
  // legacy fixture가 제거된 뒤의 운영자 경계는 앞 검사가 실패해도 확인한다.
  { ...sql('release_main_admin_contracts'), always: true },
  { ...sql('operator_capability_coverage'), always: true },
  { ...sql('operator_capability_guards'), always: true },
];

export const databaseTestShards = [
  { id: 'operators', title: '운영자 권한·주문 클레임·정산', entries: operators },
  { id: 'catalog', title: '카탈로그·리뷰·매장 분석', entries: catalog },
  { id: 'storefront', title: '고객 응대·홈 전시·쇼핑 스토리', entries: storefront },
  { id: 'commerce', title: '관리자 계약·굿즈 거래·선물·정기결제', entries: commerce },
  { id: 'legacy', title: 'legacy 운영자 fixture 회귀', entries: legacy },
];

export function findShard(id) {
  return databaseTestShards.find((shard) => shard.id === id);
}

let activeChild;

// GitHub Actions의 기본 bash step과 같은 `-eo pipefail`로 실행한다.
function runCommand(command) {
  return new Promise((resolve, reject) => {
    activeChild = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', command], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    activeChild.on('error', reject);
    activeChild.on('exit', (code, signal) => {
      activeChild = undefined;
      resolve(code ?? (signal ? 128 : 1));
    });
  });
}

const statusLabels = { passed: '통과', failed: '실패', skipped: '건너뜀' };

export function formatSummary(shard, results) {
  const total = results.reduce((sum, result) => sum + result.seconds, 0);
  const counts = Object.fromEntries(
    Object.keys(statusLabels).map((status) => [status, results.filter((result) => result.status === status).length]),
  );
  return [
    `### DB 샤드 \`${shard.id}\` — ${shard.title}`,
    '',
    '| # | 검사 | 결과 | 초 |',
    '|---:|---|---|---:|',
    ...results.map((result, index) => (
      `| ${index + 1} | \`${result.label}\` | ${statusLabels[result.status]} | ${result.seconds.toFixed(1)} |`
    )),
    '',
    `합계 ${total.toFixed(1)}초 · 통과 ${counts.passed} · 실패 ${counts.failed} · 건너뜀 ${counts.skipped}`,
    '',
  ].join('\n');
}

// 첫 실패 뒤의 검사는 건너뛰고(`always` 제외) 샤드를 실패로 끝낸다.
export async function runShard(shard, { execute = runCommand, log = console.log } = {}) {
  const results = [];
  let failed = false;
  for (const [index, entry] of shard.entries.entries()) {
    if (failed && !entry.always) {
      results.push({ label: entry.label, status: 'skipped', seconds: 0 });
      continue;
    }
    log(`::group::[${shard.id} ${index + 1}/${shard.entries.length}] ${entry.label}`);
    log(`$ ${entry.command}`);
    const started = performance.now();
    const code = await execute(entry.command);
    const seconds = (performance.now() - started) / 1000;
    log('::endgroup::');
    if (code === 0) {
      log(`[database-tests] passed ${seconds.toFixed(1)}s ${entry.label}`);
      results.push({ label: entry.label, status: 'passed', seconds });
    } else {
      failed = true;
      log(`::error title=Database test failed::${entry.label} exited with ${code} after ${seconds.toFixed(1)}s`);
      results.push({ label: entry.label, status: 'failed', seconds });
    }
  }
  return { ok: !failed, results };
}

async function main(args) {
  const [option, id] = args;
  if (option === '--list' && id === undefined) {
    for (const shard of databaseTestShards) console.log(shard.id);
    return 0;
  }
  const shard = findShard(id);
  if (!['--print', '--shard'].includes(option) || !shard || args.length !== 2) {
    console.error(`Usage: --list | --print <shard> | --shard <shard> (shards: ${databaseTestShards.map((item) => item.id).join(', ')})`);
    return 2;
  }
  if (option === '--print') {
    for (const entry of shard.entries) console.log(entry.command);
    return 0;
  }
  // 명령은 CI 러너의 일회용 Supabase 컨테이너를 고정 이름으로 가리킨다. 로컬 개발 DB를 건드리지 않도록 막는다.
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    console.error('Refusing to run CI database shards outside GitHub Actions; use --print to inspect the commands.');
    return 2;
  }

  const forward = (signal) => activeChild?.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const { ok, results } = await runShard(shard);
  const summary = formatSummary(shard, results);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
