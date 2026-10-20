export const ERROR_CODES = [
  'ERR_UNAUTHORIZED_ROLE', 'ERR_IDENTITY_MISMATCH', 'ERR_PARTICIPANT_NOT_FOUND', 'ERR_KYC_NOT_APPROVED',
  'ERR_PARTICIPANT_FROZEN', 'ERR_DUPLICATE_INVOICE_ID', 'ERR_DUPLICATE_INVOICE_CONTENT', 'ERR_DUPLICATE_FILE',
  'ERR_FACE_NOT_UNIT_MULTIPLE', 'ERR_INVALID_TRANSITION', 'ERR_DISCOUNT_OUT_OF_RANGE', 'ERR_UNITS_UNAVAILABLE',
  'ERR_CAP_EXCEEDED', 'ERR_BELOW_MIN_FUNDING', 'ERR_NOT_YET_LATE', 'ERR_NOT_YET_DEFAULT', 'ERR_AMOUNT_MISMATCH',
  'ERR_INVALID_ARGUMENT', 'ERR_NOT_FOUND', 'ERR_DEMO_MODE_DISABLED', 'ERR_DUPLICATE_PARTICIPANT',
  // backend-only codes
  'ERR_AUTH', 'ERR_FORBIDDEN', 'ERR_VALIDATION', 'ERR_UPI_SIGNATURE', 'ERR_UPI_EXPIRED', 'ERR_UPI_STATE',
  'ERR_RESERVATION', 'ERR_LEDGER_UNAVAILABLE', 'ERR_INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface LedgerErrorPayload { code: ErrorCode; message: string; details?: Record<string, unknown> }

export class LedgerError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.details = details;
  }
  toJSON(): LedgerErrorPayload { return { code: this.code, message: this.message, details: this.details }; }
}

export function isLedgerError(e: unknown): e is LedgerError { return e instanceof LedgerError; }

/** Parse a chaincode error string containing `{"code":..}` back into a LedgerError (Fabric gateway wrapper). */
export function parseLedgerError(raw: string): LedgerError | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  try {
    const obj: unknown = JSON.parse(raw.slice(start));
    if (typeof obj === 'object' && obj !== null && 'code' in obj && 'message' in obj) {
      const o = obj as { code: string; message: string; details?: Record<string, unknown> };
      if ((ERROR_CODES as readonly string[]).includes(o.code)) {
        return new LedgerError(o.code as ErrorCode, o.message, o.details ?? {});
      }
    }
  } catch { /* not JSON */ }
  return null;
}

export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  ERR_UNAUTHORIZED_ROLE: 403, ERR_IDENTITY_MISMATCH: 403, ERR_PARTICIPANT_NOT_FOUND: 404, ERR_KYC_NOT_APPROVED: 403,
  ERR_PARTICIPANT_FROZEN: 403, ERR_DUPLICATE_INVOICE_ID: 409, ERR_DUPLICATE_INVOICE_CONTENT: 409, ERR_DUPLICATE_FILE: 409,
  ERR_FACE_NOT_UNIT_MULTIPLE: 422, ERR_INVALID_TRANSITION: 409, ERR_DISCOUNT_OUT_OF_RANGE: 422, ERR_UNITS_UNAVAILABLE: 409,
  ERR_CAP_EXCEEDED: 422, ERR_BELOW_MIN_FUNDING: 409, ERR_NOT_YET_LATE: 409, ERR_NOT_YET_DEFAULT: 409, ERR_AMOUNT_MISMATCH: 422,
  ERR_INVALID_ARGUMENT: 400, ERR_NOT_FOUND: 404, ERR_DEMO_MODE_DISABLED: 403, ERR_DUPLICATE_PARTICIPANT: 409,
  ERR_AUTH: 401, ERR_FORBIDDEN: 403, ERR_VALIDATION: 400, ERR_UPI_SIGNATURE: 401, ERR_UPI_EXPIRED: 410, ERR_UPI_STATE: 409,
  ERR_RESERVATION: 409, ERR_LEDGER_UNAVAILABLE: 503, ERR_INTERNAL: 500,
};

/** Which anomaly kind the backend records on-chain for a rejected attempt. */
export const ANOMALY_KIND_FOR_CODE: Partial<Record<ErrorCode, string>> = {
  ERR_DUPLICATE_INVOICE_ID: 'DUPLICATE_INVOICE_ID',
  ERR_DUPLICATE_INVOICE_CONTENT: 'DUPLICATE_CONTENT',
  ERR_DUPLICATE_FILE: 'DUPLICATE_FILE',
  ERR_KYC_NOT_APPROVED: 'KYC_VIOLATION',
  ERR_CAP_EXCEEDED: 'CAP_VIOLATION',
  ERR_PARTICIPANT_FROZEN: 'FROZEN_ACTOR_ATTEMPT',
  ERR_IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
};

/** Human-readable guard label for the regulator anomaly panel. */
export const GUARD_LABEL: Record<string, string> = {
  DUPLICATE_INVOICE_ID: 'Guard #1 - Identity (supplier|buyer|invoice number)',
  DUPLICATE_CONTENT: 'Guard #2 - Content fingerprint (excludes invoice number)',
  DUPLICATE_FILE: 'Guard #3 - File hash (SHA-256 of PDF bytes)',
  KYC_VIOLATION: 'Compliance - KYC not approved',
  CAP_VIOLATION: 'Compliance - per-investor cap',
  FROZEN_ACTOR_ATTEMPT: 'Compliance - frozen participant',
  IDENTITY_MISMATCH: 'Identity binding',
  DEFAULT: 'Credit event - default',
  OTHER: 'Other',
};
