import { expect, test } from '@playwright/test';

test('landing explains scan, review and export with working registration navigation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('business card');
  await expect(page.getByText('ILLUSTRATIVE EXAMPLE')).toBeVisible();
  await page.getByRole('link', { name: 'Create your workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel('Full name')).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});

test('registration validates weak passwords before sending authentication requests', async ({
  page,
}) => {
  let attempted = false;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/sign-up')) attempted = true;
  });
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Test Person');
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByLabel(/^Password/).fill('short');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 12 characters.', { exact: true })).toBeVisible();
  expect(attempted).toBe(false);
});

test('email features show configuration blocker and cannot pretend to send email', async ({
  page,
  request,
}) => {
  await page.goto('/forgot-password');
  await expect(page.getByText('Email delivery isn’t configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled();
  const response = await request.post('/api/auth/request-password-reset', {
    data: { email: 'test@example.com' },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ message: expect.stringContaining('unavailable') });
});

test('private routes require authentication and legal documents are marked for review', async ({
  page,
}) => {
  await page.goto('/contacts');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByText(/legal review/i).first()).toBeVisible();
});
