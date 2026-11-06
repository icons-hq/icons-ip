import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { resolveGoodsPrice } from '@/lib/admin/goods-price-editor';
import { GoodChoiceGroup, GoodChoiceOption } from './GoodEditorParts';
import { GoodsPriceFields } from './GoodsPriceFields';
import { GoodsSalePeriodFields } from './GoodsSalePeriodFields';
import { GoodsPurchaseLimitFields } from './GoodsSalePolicyFields';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

/** `data-good-choice` 묶음마다 legend와 선택지 라벨들. */
function choiceGroups(html: string) {
  return [...html.matchAll(/<fieldset[^>]*data-good-choice=""[^>]*>([\s\S]*?)<\/fieldset>/g)].map(([, body]) => ({
    legend: body.match(/<legend([^>]*)>([^<]*)<\/legend>/),
    labels: [...body.matchAll(/<label([^>]*)>(<input[^>]*\/>)([^<]*)<\/label>/g)],
  }));
}

/*
 * 10/27 회의 R11: '설정함/설정안함' 버튼 가운데를 눌러도 선택되지 않았다(절대배치 legend가 버튼 위를 덮었다).
 * 템플릿 룩에서는 legend가 흐름 안에 있고, 라디오와 글자를 감싼 라벨 전체가 누르는 자리다.
 */
describe('편집기 하나 고르기(설정함/설정안함)', () => {
  it('legend는 흐름 안에 두고 라벨 전체가 라디오를 감싼다', () => {
    const html = renderToStaticMarkup(<GoodChoiceGroup legend="즉시할인">
      <GoodChoiceOption name="discountEnabled" value="true" checked onChange={() => {}}>설정함</GoodChoiceOption>
      <GoodChoiceOption name="discountEnabled" value="false" checked={false} onChange={() => {}}>설정안함</GoodChoiceOption>
    </GoodChoiceGroup>);
    const [group] = choiceGroups(html);
    expect(group.legend?.[2]).toBe('즉시할인');
    expect(group.legend?.[1]).not.toMatch(/\b(absolute|fixed|pointer-events-none)\b/);
    expect(group.labels.map(([, , input, text]) => [input.match(/value="([^"]+)"/)?.[1], text])).toEqual([['true', '설정함'], ['false', '설정안함']]);
    for (const [, attributes, input] of group.labels) {
      expect(input).toContain('type="radio"');
      expect(attributes).toContain('cursor-pointer');
      expect(attributes).not.toMatch(/\b(absolute|pointer-events-none)\b/);
    }
  });

  it('판매가·판매기간과 구매 제한의 설정함/설정안함 묶음 모두 같은 부품으로 그린다', () => {
    const draft = { regularPrice: '10000', discountEnabled: false, discountValue: '', discountUnit: 'won' as const };
    const price = renderToStaticMarkup(<GoodsPriceFields draft={draft} onDraftChange={() => {}} result={resolveGoodsPrice(draft)} errors={{}} showDiscountRate="true" />);
    const period = renderToStaticMarkup(<GoodsSalePeriodFields values={{ salePeriodEnabled: 'false' }} onChange={() => {}} />);
    const limits = renderToStaticMarkup(<GoodsPurchaseLimitFields values={{ orderQuantityLimitEnabled: 'true', memberPurchaseLimitEnabled: 'false' }} rows={[]} onRowsChange={() => {}} />);
    const groups = [...choiceGroups(price), ...choiceGroups(period), ...choiceGroups(limits)];
    expect(groups.map((group) => group.legend?.[2])).toEqual(['즉시할인', '판매기간 설정', '최소/최대 구매수량', '1인 최대 구매수량']);
    for (const group of groups) {
      expect(group.labels.map(([, , , text]) => text)).toEqual(['설정함', '설정안함']);
      expect(group.labels.every(([, , input]) => input.includes('type="radio"'))).toBe(true);
      /* 각 묶음은 정확히 한 선택지가 골라져 있다(네이티브 라디오 그대로 제출된다). */
      expect(group.labels.filter(([, , input]) => input.includes('checked=""'))).toHaveLength(1);
    }
  });
});

/** 트랙 B(상품 등록·수정 편집기)가 소유한 화면 파일(components/admin 기준). */
const EDITOR_FILES = [
  'ArtworkUploadField.tsx', 'BodyTemplateTools.tsx', 'CategoryAssignmentField.tsx', 'CountryNameFinder.tsx', 'ErpItemNameInput.tsx',
  'GoodBankTransferControl.tsx', 'GoodClonePanel.tsx', 'GoodCopySourcePicker.tsx', 'GoodEditor.tsx', 'GoodEditorParts.tsx',
  'GoodIdentifierFields.tsx', 'GoodNoticePicker.tsx', 'GoodPublishControls.tsx', 'GoodSaleRestrictionControl.tsx',
  'GoodShippingChargeGroupPanel.tsx', 'GoodSizeChartPanel.tsx', 'GoodUrlAddField.tsx', 'GoodVariantsPanel.tsx', 'GoodWorkspace.tsx',
  'GoodWorkspaceSections.tsx', 'GoodsAdditionalPanel.tsx', 'GoodsAfterSalesFields.tsx', 'GoodsAfterSalesPanel.tsx', 'GoodsAttributeEditor.tsx',
  'GoodsBenefitsPanel.tsx', 'GoodsCustomInputEditor.tsx', 'GoodsDescriptionTools.tsx', 'GoodsDraftLibraryDialog.tsx', 'GoodsFulfillmentFields.tsx',
  'GoodsFulfillmentPanel.tsx', 'GoodsImageGrid.tsx', 'GoodsInlineEdit.tsx', 'GoodsIpBulkDiscount.tsx', 'GoodsKcPanel.tsx', 'GoodsKcPresetFields.tsx',
  'GoodsOptionEditor.tsx', 'GoodsOptionImportDialog.tsx', 'GoodsOptionSaleModePanel.tsx', 'GoodsPhotoDecorationPreview.tsx', 'GoodsPhotoEditor.tsx',
  'GoodsPhotoLayers.tsx', 'GoodsPhotoLogo.tsx', 'GoodsPhotoStickers.tsx', 'GoodsPreordersPanel.tsx', 'GoodsPriceFields.tsx',
  'GoodsPricePeriodsPanel.tsx', 'GoodsProductionPanel.tsx', 'GoodsPurchaseCostsPanel.tsx', 'GoodsSalePeriodFields.tsx', 'GoodsSalePolicyFields.tsx',
  'GoodsSizeChartFields.tsx', 'GoodsSubscriptionPolicyPanel.tsx', 'GoodsTransactionTermsPanel.tsx', 'ShippingChargeGroupField.tsx',
  'VariantStockAdjustmentForm.tsx', 'screens/GoodScreen.tsx', 'screens/GoodsAfterSalesTemplatesScreen.tsx', 'sections/GoodSection.tsx',
  'useGoodsKcTemplate.tsx',
];

/*
 * kit Button(Base UI)은 type을 주지 않으면 type="button"으로 그린다. 편집기 파일의 kit Button은 모두 type을 밝혀,
 * 제출 버튼이 조용히 제출하지 않는 버튼이 되지 않게 한다.
 */
describe('편집기 kit Button의 type', () => {
  it('kit Button 여는 태그마다 type을 밝힌다', () => {
    const missing: string[] = [];
    for (const file of EDITOR_FILES) {
      const source = readFileSync(join(process.cwd(), 'components/admin', file), 'utf8');
      if (!source.includes("@/components/admin/kit/ui/button'")) continue;
      for (const match of source.matchAll(/<Button(?=[\s/>])/g)) {
        let index = match.index! + match[0].length, depth = 0;
        for (; index < source.length; index += 1) {
          const char = source[index];
          if (char === '{') depth += 1;
          else if (char === '}') depth -= 1;
          else if (char === '>' && depth === 0) break;
        }
        const tag = source.slice(match.index, index + 1);
        if (!/\btype=/.test(tag)) missing.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
