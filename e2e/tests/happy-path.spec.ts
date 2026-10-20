/**
 * §9 happy path, UI-driven for every judge-visible moment:
 * MSME uploads the real PDF → tokenizes → buyer accepts → operator lists at 8% → investor funds 250 units via UPI
 * (simulated signed webhook) → second investor completes funding → supplier auto-paid → time travel → buyer repays
 * via UPI → waterfall → Aurora's score moves 63 → 67.
 */
import { expect, test } from '@playwright/test';
import { api, apiLogin, resetPlatform, switchRole, uiLogin, uiLogout, SAMPLE_PDF } from './helpers';

test.describe.configure({ mode: 'serial' });

test('upload → tokenize → accept → list → invest ×2 → payout → repay → settle (score 63 → 67)', async ({ page }) => {
  await resetPlatform();

  // ── Landing shows the ledger badge + sandbox banner ──
  await page.goto('/');
  await expect(page.getByText(/SANDBOX/).first()).toBeVisible();
  await expect(page.getByText(/Ledger: (Mock|Fabric|Drunix)/i).first()).toBeVisible();

  // ── Buyer score before ──
  const reg = await apiLogin('regulator@demo.in');
  const before = await api<{ score: { score: number } }>('GET', '/api/platform/scores/buyer1', undefined, reg.accessToken);
  expect(before.json.score.score).toBe(63);

  // ── MSME uploads and tokenizes ──
  await uiLogin(page, { role: 'MSME' });
  await expect(page).toHaveURL(/\/msme/);
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
  await expect(page.getByRole('heading', { name: 'Review & confirm' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#invoiceNumber')).toHaveValue('INV-2025-001');
  await expect(page.getByText('Aurora Motors Ltd').first()).toBeVisible();
  await expect(page.getByText('matches face value')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm & tokenize' }).click();
  await expect(page.getByText('Invoice tokenized').first()).toBeVisible({ timeout: 20_000 });
  // the invoice drawer opens on creation; close it so the page is interactive again
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('DRAFT').first()).toBeVisible();

  const state = await api<{ lastCreatedInvoiceId: string }>('GET', '/api/demo/state');
  const invoiceId = state.json.lastCreatedInvoiceId;
  expect(invoiceId).toMatch(/^[0-9a-f]{64}$/);

  // ── Buyer accepts (role switch via Demo Panel, no re-login) ──
  await switchRole(page, 'BUYER');
  await expect(page).toHaveURL(/\/buyer/);
  // invoice cards render as one big button whose accessible name includes the counterparty + actions
  const pendingCard = page.getByRole('button', { name: /From Sharma Precision.*Accept/ }).first();
  await pendingCard.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByText(/accepted/i).first()).toBeVisible({ timeout: 15_000 });

  // ── Operator lists at 8% p.a. ──
  await switchRole(page, 'OPERATOR');
  await expect(page).toHaveURL(/\/operator/);
  const listingCard = page.getByRole('button', { name: /Sharma Precision.*Aurora Motors.*Price & list/ }).first();
  await listingCard.getByRole('button', { name: 'Price & list', exact: true }).click();
  await page.locator('#bps-range').fill('800');
  await expect(page.getByText('₹985.32').first()).toBeVisible();
  await expect(page.getByText('8.11%').first()).toBeVisible();
  await page.getByRole('button', { name: 'List on marketplace' }).click();
  await expect(page.getByText(/listed/i).first()).toBeVisible({ timeout: 15_000 });

  // ── Investor A funds 250 units via UPI ──
  await switchRole(page, 'INVESTOR');
  await expect(page).toHaveURL(/\/investor/);
  // marketplace cards are plain containers: take the deepest div holding the buyer name and an Invest button
  const marketCard = page.locator('div').filter({ hasText: 'Sharma Precision Components' }).filter({ hasText: 'buyer Aurora Motors Ltd' }).filter({ has: page.getByRole('button', { name: 'Invest', exact: true }) }).last();
  await expect(marketCard.getByText('8.11%')).toBeVisible();
  await marketCard.getByRole('button', { name: 'Invest', exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  const unitsInput = dialog.locator('input[type="number"]').first();
  await unitsInput.fill('250');
  await expect(dialog.getByText('₹2,46,330').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Create UPI request' }).click();
  await expect(dialog.locator('img, canvas, svg').first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Open UPI app/ })).toHaveAttribute('href', /^upi:\/\/pay\?pa=/);
  await dialog.getByRole('button', { name: 'Simulate payment' }).click();
  await expect(dialog.getByText('Payment confirmed and recorded on the ledger')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // ── Investor B completes funding (150 units) ──
  await uiLogout(page);
  await uiLogin(page, { email: 'investor2@demo.in' });
  const card2 = page.locator('div').filter({ hasText: 'Sharma Precision Components' }).filter({ hasText: 'buyer Aurora Motors Ltd' }).filter({ has: page.getByRole('button', { name: 'Invest', exact: true }) }).last();
  await card2.getByRole('button', { name: 'Invest', exact: true }).last().click();
  await page.getByRole('dialog').locator('input[type="number"]').first().fill('150');
  await page.getByRole('dialog').getByRole('button', { name: 'Create UPI request' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate payment' }).click();
  await expect(page.getByRole('dialog').getByText('Payment confirmed and recorded on the ledger')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // supplier auto-paid on full funding
  const op = await apiLogin('operator@demo.in');
  await expect.poll(async () => (await api<{ invoice: { status: string } }>('GET', `/api/invoices/${invoiceId}`, undefined, op.accessToken)).json.invoice.status, { timeout: 20_000 }).toBe('SUPPLIER_PAID');

  // ── MSME sees the payout card ──
  await switchRole(page, 'MSME');
  await page.getByRole('tab', { name: /My invoices/ }).click();
  await page.getByRole('button', { name: /To Aurora Motors Ltd.*Supplier paid/i }).first().click();
  await expect(page.getByRole('dialog').getByText(/Paid in/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ── Time travel to due date + 1, buyer repays via UPI ──
  const tt = await api<{ simulatedNow: string }>('POST', '/api/demo/time-travel', { toInvoiceId: invoiceId, plusDays: 1 });
  expect(tt.status).toBe(200);
  await switchRole(page, 'BUYER');
  await page.getByRole('tab', { name: 'Repayments due' }).click();
  const dueCard = page.getByRole('button', { name: /Sharma Precision.*Pay via UPI/ }).first();
  await dueCard.getByRole('button', { name: 'Pay via UPI', exact: true }).click();
  const repay = page.getByRole('dialog');
  await expect(repay.getByText('₹4,00,000').first()).toBeVisible();
  await repay.getByRole('button', { name: 'Simulate payment' }).click();
  await expect(repay.getByText('Payment confirmed and recorded on the ledger')).toBeVisible({ timeout: 30_000 });
  await expect(repay.getByText('Distribution summary')).toBeVisible();
  await page.keyboard.press('Escape');

  // ── Settled + score moved 63 → 67 ──
  const after = await api<{ score: { score: number; settledOnTime: number } }>('GET', '/api/platform/scores/buyer1', undefined, reg.accessToken);
  expect(after.json.score.score).toBe(67);
  expect(after.json.score.settledOnTime).toBe(6);
  await expect(page.getByText('67').first()).toBeVisible({ timeout: 15_000 });
  const detail = await api<{ invoice: { status: string }; payments: Array<{ kind: string; toId: string; amountPaise: number }> }>('GET', `/api/invoices/${invoiceId}`, undefined, op.accessToken);
  expect(detail.json.invoice.status).toBe('SETTLED');
  const dist = detail.json.payments.filter((p) => p.kind === 'INVESTOR_DISTRIBUTION').map((p) => `${p.toId}:${p.amountPaise}`).sort();
  expect(dist).toEqual(['investor1:25000000', 'investor2:15000000']);

  // ── Regulator sees provenance but no private details ──
  await switchRole(page, 'REGULATOR');
  await expect(page).toHaveURL(/\/regulator/);
  await expect(page.getByText(/RecordRepayment/).first()).toBeVisible({ timeout: 15_000 });
});
