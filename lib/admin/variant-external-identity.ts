export const GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS = {
  erpCode: 120,
  erpName: 200,
  barcode: 120,
} as const;

export type GoodsVariantExternalIdentity = {
  erpCode: string | null;
  erpName: string | null;
  barcode: string | null;
  updatedAt?: string | null;
};

export type GoodsVariantExternalIdentityInput = {
  erpCode?: unknown;
  erpName?: unknown;
  barcode?: unknown;
};

export type GoodsVariantExternalIdentityResult =
  | { ok: true; value: GoodsVariantExternalIdentity }
  | { ok: false; error: 'invalid' };

function normalizeText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('invalid');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error('invalid');
  return normalized || null;
}

/**
 * Normalize staff-entered ERP fields without coercing numeric-looking strings.
 * In particular, barcode `000123` remains `000123` and blank input becomes
 * NULL for the private RPC.
 */
export function normalizeGoodsVariantExternalIdentity(
  input: GoodsVariantExternalIdentityInput,
): GoodsVariantExternalIdentityResult {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid' };
    return {
      ok: true,
      value: {
        erpCode: normalizeText(input.erpCode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpCode),
        erpName: normalizeText(input.erpName, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpName),
        barcode: normalizeText(input.barcode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.barcode),
      },
    };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function readGoodsVariantExternalIdentityForm(formData: FormData): GoodsVariantExternalIdentityResult {
  return normalizeGoodsVariantExternalIdentity({
    erpCode: formData.get('erpCode'),
    erpName: formData.get('erpName'),
    barcode: formData.get('barcode'),
  });
}

export function isGoodsVariantExternalIdentity(value: unknown): value is GoodsVariantExternalIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.erpCode === null || typeof candidate.erpCode === 'string')
    && (candidate.erpName === null || typeof candidate.erpName === 'string')
    && (candidate.barcode === null || typeof candidate.barcode === 'string');
}
