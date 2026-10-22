import { expect, test, type Page } from '@playwright/test';

const verificationOutcome =
  'If this address belongs to an unverified account, a verification email has been requested.';
const providerRejection =
  'The email provider rejected this message. Contact your administrator to check sender authorization and recipient restrictions.';
const email = 'existing.account@example.com';
interface VerificationReply {
  status: number;
  body: object;
  headers?: Record<string, string>;
}
async function mockAuth(
  page: Page,
  options: {
    emailEnabled?: boolean;
    verification?: (attempt: number) => Promise<VerificationReply> | VerificationReply;
  } = {},
) {
  const requests: { email: string; callbackURL: string }[] = [];
  let registrations = 0;
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        email: options.emailEnabled !== false,
        google: false,
        microsoft: false,
        registrationAvailable: true,
        verificationRequired: true,
      },
    }),
  );
  // Every auth request in these tests terminates at the browser boundary, never a real provider.
  await page.route('**/api/auth/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/sign-up/email') {
      registrations += 1;
      await route.fulfill({
        json: {
          token: null,
          user: {
            id: 'synthetic-existing-user',
            email,
            name: 'Test Person',
            emailVerified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      });
    } else if (pathname === '/api/auth/sign-in/email') {
      await route.fulfill({
        status: 403,
        json: { code: 'EMAIL_NOT_VERIFIED', message: 'Email is not verified.' },
      });
    } else if (pathname === '/api/auth/send-verification-email') {
      requests.push(route.request().postDataJSON() as { email: string; callbackURL: string });
      const result = (await options.verification?.(requests.length)) ?? {
        status: 200,
        body: { status: true },
      };
      await route.fulfill({ status: result.status, json: result.body, headers: result.headers });
    } else if (pathname === '/api/auth/get-session') {
      await route.fulfill({ json: null });
    } else {
      await route.fulfill({
        status: 500,
        json: { message: 'Unexpected authentication request in regression test.' },
      });
    }
  });
  return { requests, registrations: () => registrations };
}

test('repeated signup offers explicit resend without claiming a new account or another email', async ({
  page,
}) => {
  const auth = await mockAuth(page);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Test Person');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill('Test password for browser only 123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByText(
      'To continue, sign in or request a verification email using the address you entered.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Your account has been created|email (was|has been) (sent|delivered)/i),
  ).toHaveCount(0);
  expect(auth.registrations()).toBe(1);
  expect(auth.requests).toHaveLength(0);
  await page.getByRole('link', { name: 'Resend verification email', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByLabel('Email address')).toHaveValue('');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByText(verificationOutcome)).toBeVisible();
  expect(auth.requests).toEqual([{ email, callbackURL: '/dashboard' }]);
});

for (const status of [503, 403]) {
  test(`login recovery surfaces delivery rejection without a success state (HTTP ${status})`, async ({
    page,
  }) => {
    const auth = await mockAuth(page, {
      verification: () => ({
        status,
        body: { code: 'SERVICE_UNAVAILABLE', message: providerRejection },
      }),
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill('Test password for browser only 123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email is not verified.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Resend verification email', exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
    await expect(
      page.getByText('Unable to request verification email', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(providerRejection, { exact: true })).toBeVisible();
    await expect(page.getByText(verificationOutcome)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Send verification email', exact: true }),
    ).toBeEnabled();
    expect(auth.requests).toEqual([{ email, callbackURL: '/dashboard' }]);
  });
}

test('an explicit verification failure can be retried after the delivery configuration is corrected', async ({
  page,
}) => {
  const auth = await mockAuth(page, {
    verification: (attempt) =>
      attempt === 1
        ? { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: providerRejection } }
        : { status: 200, body: { status: true } },
  });
  await page.goto('/verify-email');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByText(providerRejection, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByText(verificationOutcome)).toBeVisible();
  await expect(page.getByText(providerRejection, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Resend verification email', exact: true }),
  ).toBeEnabled();
  expect(auth.requests).toHaveLength(2);
});

test('pending resend prevents duplicate submissions and keeps delivery claims conditional', async ({
  page,
}) => {
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const auth = await mockAuth(page, {
    verification: async () => {
      await pending;
      return { status: 200, body: { status: true } };
    },
  });
  await page.goto('/verify-email');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  const busy = page.getByRole('button', { name: 'Requesting verification email…', exact: true });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await page.getByLabel('Email address').press('Enter');
  expect(auth.requests).toHaveLength(1);
  finish?.();
  await expect(page.getByText(verificationOutcome)).toBeVisible();
  await expect(page.getByText(/email (was|has been) delivered/i)).toHaveCount(0);
});

test('backend resend cooldown remains an error and never schedules another request automatically', async ({
  page,
}) => {
  const message = 'Too many verification requests. Try again in 60 seconds.';
  const auth = await mockAuth(page, {
    verification: () => ({
      status: 429,
      body: { code: 'TOO_MANY_REQUESTS', message },
      headers: { 'X-Retry-After': '60' },
    }),
  });
  await page.goto('/verify-email');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText(verificationOutcome)).toHaveCount(0);
  expect(auth.requests).toHaveLength(1);
});

test('unconfigured email hides recovery navigation and blocks direct verification requests', async ({
  page,
}) => {
  const auth = await mockAuth(page, { emailEnabled: false });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Resend verification email', exact: true }),
  ).toHaveCount(0);
  await page.goto('/verify-email');
  await expect(page.getByText('Email delivery isn’t configured', { exact: true })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await expect(
    page.getByRole('button', { name: 'Send verification email', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Email address').press('Enter');
  expect(auth.requests).toHaveLength(0);
});
