/** Node-only hashing helpers (server side). Not re-exported from the package root to keep browser bundles clean. */
import { createHash } from 'node:crypto';
import { invoiceContentString, invoiceIdentityString, type CanonicalLineItem } from './canonical.js';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function computeInvoiceId(supplierGstin: string, buyerGstin: string, invoiceNumber: string): string {
  return sha256Hex(invoiceIdentityString(supplierGstin, buyerGstin, invoiceNumber));
}

export function computeContentHash(
  supplierGstin: string, buyerGstin: string, issueDate: string, faceValuePaise: number, lineItems: CanonicalLineItem[],
): string {
  return sha256Hex(invoiceContentString(supplierGstin, buyerGstin, issueDate, faceValuePaise, lineItems));
}
