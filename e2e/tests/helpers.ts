import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_URL } from '../playwright.config';

export const PASSWORD = 'Demo@1234';
export const SAMPLE_PDF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples', 'invoice-aurora-001.pdf');

export async function api<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const r = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json: json as T };
}

export async function apiLogin(email: string): Promise<{ accessToken: string; user: { participantId: string } }> {
  const r = await api<{ accessToken: string; user: { participantId: string } }>('POST', '/api/auth/login', { email, password: PASSWORD });
  expect(r.status, `login ${email}`).toBe(200);
  return r.json;
}

export async function resetPlatform(): Promise<void> {
  const r = await api('POST', '/api/demo/reset');
  expect(r.status).toBe(200);
}

/** Log in through the UI using the demo-credential chip for a role, or an explicit email. */
export async function uiLogin(page: Page, opts: { role?: string; email?: string }): Promise<void> {
  await page.goto('/login');
  if (opts.email) {
    await page.getByLabel('Email').fill(opts.email);
    await page.getByLabel('Password').fill(PASSWORD);
  } else {
    await page.getByRole('button', { name: new RegExp(`^${opts.role}\\b`) }).first().click();
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

export async function uiLogout(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
}

export async function openDemoPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open demo panel' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

export async function switchRole(page: Page, role: string): Promise<void> {
  await openDemoPanel(page);
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${role}$`) }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
}

export function samplePdfBuffer(): Buffer { return readFileSync(SAMPLE_PDF); }
