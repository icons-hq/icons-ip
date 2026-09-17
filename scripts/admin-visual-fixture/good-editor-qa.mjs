import assert from 'node:assert/strict';

/** Exercises the same public editor interface operators use, with a synthetic save action. */
export async function verifyGoodEditor(page, origin, output) {
  const checks = [];
  const acceptDialog = dialog => dialog.accept();
  page.on('dialog', acceptDialog);
  async function check(name, verify) { await verify(); checks.push(name); }
  try {
 await page.goto(`${origin}/?view=editor`);await page.waitForSelector('.admin-good-workspace__form');
 await check('identity and initial clean state',async()=>{assert.equal(await page.title(),'ICONS Admin visual fixture');await page.getByText('새 초안 · 아직 저장 전',{exact:true}).waitFor();});
 await page.locator('input[name="name"]').fill('편집 복구 검증 상품');
 await page.locator('input[name="price"]').fill('1000');
 await page.locator('input[name="compareAtPrice"]').fill('2000');
 await page.getByRole('spinbutton',{name:'기본 옵션 추가금액',exact:true}).fill('500');
 await page.getByRole('spinbutton',{name:'기본 옵션 할당 재고',exact:true}).fill('4');
 await page.getByRole('textbox',{name:'기본 옵션명',exact:true}).fill('수정 기본 옵션');
 await page.getByText('공개 화면 미리보기',{exact:true}).click();
 await check('option, preview and dirty state agree',async()=>{
  await page.waitForFunction(()=>JSON.parse(document.querySelector('input[name="variants"]').value)[0].name==='수정 기본 옵션');
  assert.match(await page.locator('.wc-product-card').innerText(),/1,500/);
  assert.match(await page.locator('.wc-product-card').innerText(),/2,000/);
  await page.getByText('미저장 변경 있음',{exact:true}).waitFor();
 });
 await page.getByRole('button',{name:'최근 저장된 상품에서 복사'}).click();
 await check('notice copy follows the same observation',async()=>{assert.equal(await page.locator('input[name="noticeMaker"]').inputValue(),'합성 제조사');});
 await page.getByText('여러 옵션으로 전환 · 옵션 축 설정 · 최대 100개 조합',{exact:true}).click();
 await page.locator('input[name="optionAxisName0"]').fill('색상');
 await page.locator('input[name="optionAxisValues0"]').fill('빨강, 파랑');
 await page.getByRole('button',{name:'조합 생성',exact:true}).click();
 await page.getByRole('textbox',{name:'옵션 2 이름',exact:true}).fill('파랑 수정');
 await page.getByRole('spinbutton',{name:'옵션 2 추가금액',exact:true}).fill('700');
 await page.getByRole('spinbutton',{name:'옵션 2 초기 할당 재고',exact:true}).fill('6');
 await check('generated options commit without delayed mirroring',async()=>{
  await page.waitForFunction(()=>JSON.parse(document.querySelector('input[name="variants"]').value)[1]?.extraPrice===700);
  assert.match(await page.locator('.wc-product-card').innerText(),/1,700/);
 });
 // The real widget processes a local image; its upload adapter returns a synthetic verified path.
 await page.getByLabel('대표 이미지', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png',
   buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64') });
 await page.waitForFunction(() => document.querySelector('input[name="imagePath"]').value.includes('22222222'));
 const snapshot=await page.locator('input[name="variants"]').inputValue();
 await page.getByRole('button',{name:'초안으로 저장',exact:true}).click();
 await check('failed submission preserves latest options and uploads',async()=>{
  await page.locator('.admin-good-workspace__save [role=alert]').filter({hasText:'합성 저장 실패'}).waitFor();
  assert.equal(await page.locator('input[name="variants"]').inputValue(),snapshot);
  assert.equal(await page.locator('input[name="name"]').inputValue(),'편집 복구 검증 상품');
  assert.equal(await page.locator('#fixture-good-submission').textContent().then(text=>JSON.parse(text).variants),snapshot);
  assert.match(await page.locator('#fixture-good-submission').textContent().then(text=>JSON.parse(text).imagePath),/22222222/);
 });
 await page.locator('#good-section-variants').scrollIntoViewIfNeeded();
 await page.locator('.fixture-route-switcher').evaluate(node => { node.style.display = 'none'; });
 await page.screenshot({path:`${output}/editor-desktop-options-failure.png`});
 await page.reload();await page.getByRole('button',{name:'복구',exact:true}).click();
 await check('reload and explicit recovery preserve the complete edit session',async()=>{
  assert.equal(await page.locator('input[name="variants"]').inputValue(),snapshot);
  assert.equal(await page.locator('input[name="noticeMaker"]').inputValue(),'합성 제조사');
  assert.equal(await page.locator('input[name="variantBaseline"]').inputValue(),'[]');
  assert.match(await page.locator('input[name="imagePath"]').inputValue(),/22222222/);
  await page.getByText('미저장 변경 있음',{exact:true}).waitFor();
 });
 await page.setViewportSize({width:390,height:844});
 await page.locator('#good-section-variants').scrollIntoViewIfNeeded();
 await page.locator('.fixture-route-switcher').evaluate(node => { node.style.display = 'none'; });
 await page.screenshot({path:`${output}/editor-mobile-options-recovered.png`});
 await check('mobile has no document overflow or framework overlay',async()=>{
  assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
 });
 await page.getByLabel('합성 저장 결과').selectOption('success');
 await page.getByRole('button',{name:'초안으로 저장',exact:true}).click();
 await check('successful submission clears browser recovery',async()=>{
  await page.getByText('합성 저장 성공',{exact:true}).waitFor();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('icons:admin:local-draft:')));
 });
    return { name: 'goods-editor-edit-failure-recovery-success', url: page.url(), checks, findings: [] };
  } finally {
    page.off('dialog', acceptDialog);
  }
}
