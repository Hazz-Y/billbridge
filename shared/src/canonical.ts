/**
 * Canonical strings for the double-financing guards (spec 4.6). These MUST match chaincode/billbridge/canonical.go
 * byte-for-byte. We use a pipe-delimited canonical string (not JSON) so Go and TS agree without JSON-escaping quirks.
 *
 * invoiceId   = sha256( supplierGstin | buyerGstin | invoiceNumber )          (normalized: trim + upper-case)
 * contentHash = sha256( supplierGstin | buyerGstin | issueDate | faceValuePaise | items )
 *   items     = lineItems normalized (description: trim, lower-case, collapse whitespace), sorted by
 *               description then totalPaise, each "desc~qty~unitPricePaise~totalPaise", joined with ";"
 *   (invoice number is deliberately EXCLUDED so re-issuing under a new number is still caught)
 */
export interface CanonicalLineItem { description: string; quantity: number; unitPricePaise: number; totalPaise: number }

export function normalizeId(s: string): string { return s.trim().toUpperCase(); }
export function normalizeDescription(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' '); }

export function invoiceIdentityString(supplierGstin: string, buyerGstin: string, invoiceNumber: string): string {
  return `${normalizeId(supplierGstin)}|${normalizeId(buyerGstin)}|${normalizeId(invoiceNumber)}`;
}

export function invoiceContentString(
  supplierGstin: string, buyerGstin: string, issueDate: string, faceValuePaise: number, lineItems: CanonicalLineItem[],
): string {
  const items = lineItems
    .map((li) => ({ d: normalizeDescription(li.description), q: li.quantity, u: li.unitPricePaise, t: li.totalPaise }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t))
    .map((li) => `${li.d}~${li.q}~${li.u}~${li.t}`)
    .join(';');
  return `${normalizeId(supplierGstin)}|${normalizeId(buyerGstin)}|${issueDate.slice(0, 10)}|${faceValuePaise}|${items}`;
}
