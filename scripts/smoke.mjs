// Full §9 demo flow through the live HTTP API (used by `make smoke` and as the integration gate).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, c, loadEnv } from './lib.mjs';

const env = loadEnv();
const API = env.BACKEND_URL;
const PW = 'Demo@1234';
let failures = 0;
const ok = (cond, msg, extra = '') => { console.log(`${cond ? c.green('✓') : c.red('✖')} ${msg}${extra ? c.dim(` ${extra}`) : ''}`); if (!cond) failures++; };

async function call(method, path, { token, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body && !form) headers['content-type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (raw) return { status: r.status, text, json };
  return { status: r.status, json };
}
async function login(email) { const r = await call('POST', '/api/auth/login', { body: { email, password: PW } }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; }

console.log(c.bold('\n▶ BillBridge smoke: §9 demo flow via API\n'));
await call('POST', '/api/demo/reset');
const health = (await call('GET', '/health')).json;
ok(health?.ok, 'health', `ledger=${health?.ledger?.mode} block=${health?.ledger?.blockHeight}`);

const msme = await login('msme1@demo.in');
const buyer = await login('buyer1@demo.in');
const op = await login('operator@demo.in');
const invA = await login('investor1@demo.in');
const invB = await login('investor2@demo.in');
const tiny = await login('investor4@demo.in');
const pending = await login('investor5@demo.in');
const reg = await login('regulator@demo.in');

// score before
let score = (await call('GET', '/api/platform/scores/buyer1', { token: reg.accessToken })).json;
ok(score?.score?.score === 63, 'Aurora score before = 63', `got ${score?.score?.score}`);

// upload real PDF
const pdf = readFileSync(join(ROOT, 'samples', 'invoice-aurora-001.pdf'));
const form = new FormData();
form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'invoice-aurora-001.pdf');
const up = await call('POST', '/api/invoices/upload', { token: msme.accessToken, form });
ok(up.status === 200, 'upload + extraction', `source=${up.json?.extraction?.source} conf=${up.json?.extraction?.confidence} buyer=${up.json?.buyerName}`);
const x = up.json.extraction;
ok(x.totalAmountPaise === 40_000_000, 'extracted total = ₹4,00,000', String(x.totalAmountPaise));
ok(x.invoiceNumber === 'INV-2025-001', 'extracted invoice number', x.invoiceNumber);
ok(up.json.buyerId === 'buyer1', 'buyer resolved from GSTIN');

const createBody = { fileId: up.json.fileId, buyerId: up.json.buyerId, supplierGstin: x.supplierGstin, buyerGstin: x.buyerGstin, invoiceNumber: x.invoiceNumber, issueDate: x.invoiceDate.slice(0, 10), dueDate: x.dueDate.slice(0, 10), faceValuePaise: x.totalAmountPaise, taxAmountPaise: x.taxAmountPaise, lineItems: x.lineItems };
const created = await call('POST', '/api/invoices', { token: msme.accessToken, body: createBody });
ok(created.status === 200 || created.status === 201, 'CreateInvoice', `${created.status} tx=${created.json?.tx?.txId?.slice(0, 10)} units=${created.json?.invoice?.totalUnits}`);
const id = created.json.invoice.invoiceId;

// regulator: private data hidden
const regView = (await call('GET', `/api/invoices/${id}`, { token: reg.accessToken })).json;
ok(regView?.privateDetails === null && regView?.privateAccess === 'DENIED_ORG', 'regulator sees no private details', regView?.privateAccess);
const buyerView = (await call('GET', `/api/invoices/${id}`, { token: buyer.accessToken })).json;
ok(buyerView?.privateDetails?.invoiceNumber === 'INV-2025-001', 'buyer sees private details');

// attacks (3 distinct guards) BEFORE accept so the identity remains the live target
for (const [variant, code] of [['SAME_FILE', 'ERR_DUPLICATE_FILE'], ['NEW_NUMBER', 'ERR_DUPLICATE_INVOICE_CONTENT'], ['CHANGED_AMOUNT', 'ERR_DUPLICATE_INVOICE_ID']]) {
  const a = await call('POST', '/api/demo/attack/duplicate', { body: { variant } });
  ok(a.json?.rejected && a.json?.errorCode === code, `attack ${variant} rejected by ${code}`, `${a.json?.errorCode} anomalyTx=${a.json?.anomalyTxId?.slice(0, 8)}`);
}
const anomalies = (await call('GET', '/api/platform/anomalies?pageSize=100', { token: reg.accessToken })).json;
const kinds = new Set((anomalies?.items ?? []).map((i) => i.kind));
ok(kinds.has('DUPLICATE_FILE') && kinds.has('DUPLICATE_CONTENT') && kinds.has('DUPLICATE_INVOICE_ID'), 'regulator anomaly panel has all three guards', [...kinds].join(','));

// accept, list
const acc = await call('POST', `/api/invoices/${id}/accept`, { token: buyer.accessToken });
ok(acc.json?.invoice?.status === 'BUYER_ACCEPTED', 'buyer accepts');
const listed = await call('POST', `/api/invoices/${id}/list`, { token: op.accessToken, body: { discountBps: 800, minFundingUnits: 100 } });
ok(listed.json?.invoice?.status === 'LISTED', 'operator lists at 8% p.a.', `tenor=${listed.json?.invoice?.tenorDays} price=${listed.json?.invoice?.pricePerUnitPaise} yield=${listed.json?.invoice?.annualizedYieldBps}bps`);
ok(listed.json?.invoice?.pricePerUnitPaise === 98532 && listed.json?.invoice?.annualizedYieldBps === 811, 'pricing = 98,532 / 811 bps');

// compliance gates
const pend = await call('POST', `/api/invest/${id}/intent`, { token: pending.accessToken, body: { units: 1 } });
ok(pend.status === 403 && pend.json?.error?.code === 'ERR_KYC_NOT_APPROVED', 'KYC-pending investor blocked', pend.json?.error?.code);
const cap = await call('POST', `/api/invest/${id}/intent`, { token: tiny.accessToken, body: { units: 51 } });
ok(cap.status >= 400 && cap.json?.error?.code === 'ERR_CAP_EXCEEDED', 'tiny-cap investor blocked at 51 units', cap.json?.error?.code);
await call('POST', '/api/platform/freeze/investor2', { token: op.accessToken, body: { frozen: true, reason: 'AML review' } });
const frozen = await call('POST', `/api/invest/${id}/intent`, { token: invB.accessToken, body: { units: 1 } });
ok(frozen.status === 403 && frozen.json?.error?.code === 'ERR_PARTICIPANT_FROZEN', 'frozen investor blocked', frozen.json?.error?.code);
await call('POST', '/api/platform/freeze/investor2', { token: op.accessToken, body: { frozen: false } });

// invest A 250 via UPI intent + simulated signed webhook
async function invest(user, units) {
  const intent = await call('POST', `/api/invest/${id}/intent`, { token: user.accessToken, body: { units } });
  if (intent.status !== 200) throw new Error(`intent ${JSON.stringify(intent.json)}`);
  ok(intent.json.deeplink.startsWith('upi://pay?pa=') && intent.json.qrDataUrl.startsWith('data:image/png'), `UPI intent ${units} units`, `${intent.json.upiRef} ₹${intent.json.amountPaise / 100}`);
  const pay = await call('POST', '/api/demo/simulate-payment', { body: { upiRef: intent.json.upiRef } });
  ok(pay.json?.status === 'SUCCESS' && pay.json?.ledgerTxId, `webhook → ledger Invest`, `tx=${pay.json?.ledgerTxId?.slice(0, 10)}`);
  return intent.json.upiRef;
}
const t0 = Date.now();
await invest(invA, 250);
await invest(invB, 150);
let inv = (await call('GET', `/api/invoices/${id}`, { token: op.accessToken })).json;
ok(inv.invoice.unitsSold === 400 && ['FULLY_FUNDED', 'SUPPLIER_PAID'].includes(inv.invoice.status), 'fully funded', inv.invoice.status);
if (inv.invoice.status !== 'SUPPLIER_PAID') {
  const po = await call('POST', `/api/settlement/${id}/supplier-payout`, { token: op.accessToken });
  ok(po.status === 200, 'supplier payout');
  inv = (await call('GET', `/api/invoices/${id}`, { token: op.accessToken })).json;
}
ok(inv.invoice.status === 'SUPPLIER_PAID', 'status SUPPLIER_PAID (auto payout)');
const payout = inv.payments.find((p) => p.kind === 'SUPPLIER_PAYOUT');
ok(payout?.amountPaise === 39_412_800, 'supplier received ₹3,94,128', String(payout?.amountPaise));
ok(typeof inv.supplierPayoutElapsedSeconds === 'number', 'elapsed-time card data', `${inv.supplierPayoutElapsedSeconds}s (wall ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// portfolio
const pf = (await call('GET', '/api/invest/portfolio', { token: invA.accessToken })).json;
const pos = pf?.positions?.find((p) => p.invoiceId === id);
ok(pos?.units === 250 && pos?.expectedReturnPaise === 250 * 1468, 'investor A portfolio: 250 units, expected return ₹3,670', String(pos?.expectedReturnPaise));

// time travel + repayment
const tt = await call('POST', '/api/demo/time-travel', { body: { toInvoiceId: id, plusDays: 1 } });
ok(tt.status === 200, 'time travel to due date + 1', tt.json?.simulatedNow);
const ri = await call('POST', `/api/settlement/${id}/repayment-intent`, { token: buyer.accessToken });
ok(ri.json?.amountPaise === 40_000_000, 'repayment UPI intent for face value', ri.json?.upiRef);
const rp = await call('POST', '/api/demo/simulate-payment', { body: { upiRef: ri.json.upiRef } });
ok(rp.json?.status === 'SUCCESS', 'repayment webhook → waterfall', `tx=${rp.json?.ledgerTxId?.slice(0, 10)}`);
inv = (await call('GET', `/api/invoices/${id}`, { token: op.accessToken })).json;
ok(inv.invoice.status === 'SETTLED', 'SETTLED');
const dist = inv.payments.filter((p) => p.kind === 'INVESTOR_DISTRIBUTION').map((p) => `${p.toId}:${p.amountPaise}`).sort();
ok(dist.join(',') === 'investor1:25000000,investor2:15000000', 'distributions 2.5L / 1.5L', dist.join(','));
score = (await call('GET', '/api/platform/scores/buyer1', { token: reg.accessToken })).json;
ok(score?.score?.score === 67, 'Aurora score after = 67', `got ${score?.score?.score}, history=${score?.history?.length}`);
const hist = (await call('GET', `/api/invoices/${id}/history`, { token: reg.accessToken })).json;
ok((hist?.items?.length ?? 0) >= 7, 'provenance timeline', `${hist?.items?.length} entries`);

// reconciliation + mismatch
let rec = (await call('GET', '/api/platform/reconciliation', { token: op.accessToken })).json;
ok(rec?.summary?.flagged === 0, 'reconciliation all green', JSON.stringify(rec?.summary));
await call('POST', '/api/demo/inject-mismatch');
rec = (await call('GET', '/api/platform/reconciliation', { token: op.accessToken })).json;
ok(rec?.summary?.flagged >= 1, 'injected mismatch flagged', JSON.stringify(rec?.summary));

// SSE + audit events + csv
const ev = (await call('GET', '/api/platform/audit/events?pageSize=5', { token: reg.accessToken })).json;
ok((ev?.items?.length ?? 0) > 0, 'audit events mirror');
const csv = await call('GET', `/api/platform/audit/events?format=csv&pageSize=5&token=${reg.accessToken}`, { raw: true });
ok(csv.status === 200 && csv.text.includes('txId'), 'csv export with token query');
const sse = await fetch(`${API}/api/platform/audit/stream?token=${reg.accessToken}&lastEventId=0`, { signal: AbortSignal.timeout(4000) }).then(async (r) => {
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (let i = 0; i < 20 && !buf.includes('event: ledger'); i++) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); }
  reader.cancel().catch(() => {}); return buf;
}).catch((e) => String(e));
ok(sse.includes('event: ledger'), 'SSE stream replays', sse.slice(0, 40).replace(/\n/g, ' '));

// swagger + network + reset timing
ok((await call('GET', '/docs/json', { raw: true })).status === 200 || (await call('GET', '/docs', { raw: true })).status === 200, 'swagger');
const net = (await call('GET', '/api/platform/network')).json;
ok(net?.recent?.length > 0 && net?.ledgerMode === 'mock', 'network explorer', `block #${net?.blockHeight}`);
const r0 = Date.now();
const rs = await call('POST', '/api/demo/reset');
ok(rs.status === 200 && Date.now() - r0 < 30000, 'reset < 30 s', `${((Date.now() - r0) / 1000).toFixed(1)}s`);

console.log(failures ? c.red(`\n${failures} check(s) failed`) : c.green('\nall checks passed'));
process.exit(failures ? 1 : 0);
