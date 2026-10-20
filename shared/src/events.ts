import { z } from 'zod';

/**
 * ONE envelope event per transaction (Fabric overwrites earlier SetEvent calls).
 * Sub-events are typed; payloads are JSON objects.
 */
export const EVENT_TYPES = [
  'PARTICIPANT_REGISTERED', 'KYC_UPDATED', 'PARTICIPANT_FROZEN', 'PARTICIPANT_UNFROZEN',
  'INVOICE_CREATED', 'INVOICE_ACCEPTED', 'INVOICE_LISTED', 'INVOICE_CANCELLED', 'INVOICE_STATUS_CHANGED',
  'INVESTMENT_MADE', 'SUPPLIER_PAID', 'REPAYMENT_RECORDED', 'DISTRIBUTION_PAID', 'SCORE_UPDATED',
  'INVOICE_LATE', 'INVOICE_DEFAULTED', 'ANOMALY_RECORDED', 'CLOCK_ADVANCED', 'BUYER_HISTORY_SEEDED',
] as const;
export type LedgerEventType = (typeof EVENT_TYPES)[number];

export const SubEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  payload: z.record(z.unknown()),
});
export type SubEvent = z.infer<typeof SubEventSchema>;

export const EnvelopeEventSchema = z.object({
  fn: z.string(),
  txId: z.string(),
  blockNumber: z.number().int(),
  timestamp: z.string(),
  actorId: z.string(),
  actorRole: z.string(),
  invoiceId: z.string().optional(),
  events: z.array(SubEventSchema),
});
export type EnvelopeEvent = z.infer<typeof EnvelopeEventSchema>;

/** SSE wire format: `id: <blockNumber>:<txId>` and `data: EnvelopeEvent` */
export const SseEventSchema = EnvelopeEventSchema.extend({ seq: z.number().int() });
export type SseEvent = z.infer<typeof SseEventSchema>;
