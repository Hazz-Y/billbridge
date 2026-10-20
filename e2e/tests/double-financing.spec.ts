/**
 * All three double-financing attacks are rejected by the ledger with a DISTINCT error, each recorded on-chain
 * as an anomaly the regulator can see. Also: re-dropping the same PDF in the MSME UI shows the full-width
 * "Blocked by the ledger" card (not a generic toast), and the compliance gates (KYC / cap / freeze) hold.
 */
import { expect, test } from '@playwright/test';
import { api, apiLogin, openDemoPanel, resetPlatform, switchRole, uiLogin, SAMPLE_PDF } from './helpers';

test.describe.configure({ mode: 'serial' });

test('three attacks → three guards → regulator anomaly panel', async ({ page }) => {
  await resetPlatform();

  // MSME tokenizes the demo invoice through the UI
  await uiLogin(page, { role: 'MSME' });
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
  await expect(page.getByRole('heading', { name: 'Review & confirm' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirm & tokenize' }).click();
  await expect(page.getByText('Invoice tokenized').first()).toBeVisible({ timeout: 20_000 });
  // the invoice drawer opens on creation; close it so the page is interactive again
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Replay the SAME PDF in the UI → full-width ledger block card (identity guard: nothing changed)
  await page.getByRole('tab', { name: 'Upload invoice' }).click();
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
  await expect(page.getByRole('heading', { name: 'Review & confirm' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirm & tokenize' }).click();
  const block = page.getByRole('alert').filter({ hasText: 'Blocked by the ledger: already tokenized' });
  await expect(block).toBeVisible({ timeout: 20_000 });
  await expect(block.getByText('ERR_DUPLICATE_INVOICE_ID')).toBeVisible();

  // Demo Panel attack buttons → three distinct guards
  const expected: Array<[string, string, RegExp]> = [
    ['Same file', 'ERR_DUPLICATE_FILE', /Guard #3/],
    ['New number', 'ERR_DUPLICATE_INVOICE_CONTENT', /Guard #2/],
    ['Changed amount', 'ERR_DUPLICATE_INVOICE_ID', /Guard #1/],
  ];
  await openDemoPanel(page);
  const panel = page.getByRole('dialog');
  for (const [label, code, guard] of expected) {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await expect(panel.getByText('Rejected ✓')).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(code, { exact: true })).toBeVisible();
    await expect(panel.getByText(guard)).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // Regulator: anomaly panel lists all three guards, each with an on-chain tx
  const reg = await apiLogin('regulator@demo.in');
  const anomalies = await api<{ items: Array<{ kind: string; txId?: string }> }>('GET', '/api/platform/anomalies?pageSize=100', undefined, reg.accessToken);
  const kinds = new Set(anomalies.json.items.map((a) => a.kind));
  expect([...kinds]).toEqual(expect.arrayContaining(['DUPLICATE_FILE', 'DUPLICATE_CONTENT', 'DUPLICATE_INVOICE_ID']));
  expect(anomalies.json.items.every((a) => typeof a.txId === 'string' && a.txId.length > 0)).toBe(true);

  await switchRole(page, 'REGULATOR');
  await expect(page).toHaveURL(/\/regulator/);
  await expect(page.getByText('Guard #3 - File hash (SHA-256 of PDF bytes)').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Guard #2 - Content fingerprint (excludes invoice number)').first()).toBeVisible();
  await expect(page.getByText('Guard #1 - Identity (supplier|buyer|invoice number)').first()).toBeVisible();
});

test('compliance-by-code: KYC pending, per-investor cap, freeze', async ({ page }) => {
  // reuse the listed seed invoice (marketplace) for gates
  const op = await apiLogin('operator@demo.in');
  const market = await api<{ items: Array<{ invoiceId: string; pricePerUnitPaise: number }> }>('GET', '/api/invoices?marketplace=true', undefined, op.accessToken);
  expect(market.json.items.length).toBeGreaterThan(0);
  const target = market.json.items[0]!;

  // KYC pending investor: UI shows banner + disabled Invest
  await uiLogin(page, { email: 'investor5@demo.in' });
  await expect(page.getByText(/KYC/i).first()).toBeVisible();
  await expect(page.locator('button[disabled]', { hasText: 'Invest' }).first()).toBeVisible();
  const pending = await apiLogin('investor5@demo.in');
  const r1 = await api<{ error: { code: string } }>('POST', `/api/invest/${target.invoiceId}/intent`, { units: 1 }, pending.accessToken);
  expect(r1.json.error.code).toBe('ERR_KYC_NOT_APPROVED');

  // tiny cap (₹50,000): 51 units exceeds
  const tiny = await apiLogin('investor4@demo.in');
  const r2 = await api<{ error: { code: string } }>('POST', `/api/invest/${target.invoiceId}/intent`, { units: 51 }, tiny.accessToken);
  expect(r2.json.error.code).toBe('ERR_CAP_EXCEEDED');

  // freeze investor2 → blocked everywhere, then unfreeze
  await api('POST', '/api/platform/freeze/investor2', { frozen: true, reason: 'AML review' }, op.accessToken);
  const inv2 = await apiLogin('investor2@demo.in');
  const r3 = await api<{ error: { code: string } }>('POST', `/api/invest/${target.invoiceId}/intent`, { units: 1 }, inv2.accessToken);
  expect(r3.json.error.code).toBe('ERR_PARTICIPANT_FROZEN');
  await api('POST', '/api/platform/freeze/investor2', { frozen: false }, op.accessToken);
  const r4 = await api<{ upiRef: string }>('POST', `/api/invest/${target.invoiceId}/intent`, { units: 1 }, inv2.accessToken);
  expect(r4.status).toBe(200);
});
