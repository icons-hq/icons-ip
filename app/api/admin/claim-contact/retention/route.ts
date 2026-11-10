import { maintainClaimContactRetention } from '@/lib/claim-contact/retention.server';
import { createClaimContactPostHandler, unsupportedClaimContactMethod } from '@/lib/claim-contact/route.server';

export const runtime = 'nodejs';
export const POST = createClaimContactPostHandler(maintainClaimContactRetention);
export const GET = unsupportedClaimContactMethod;
export const HEAD = unsupportedClaimContactMethod;
export const PUT = unsupportedClaimContactMethod;
export const PATCH = unsupportedClaimContactMethod;
export const DELETE = unsupportedClaimContactMethod;
export const OPTIONS = unsupportedClaimContactMethod;
