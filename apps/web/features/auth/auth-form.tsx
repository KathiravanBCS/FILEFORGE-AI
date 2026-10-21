'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrandGoogle,
  IconBrandWindows,
  IconInfoCircle,
  IconCheck,
  IconLock,
} from '@tabler/icons-react';
import { z } from 'zod';
import { authClient } from '../../lib/auth-client';
import { Logo } from '../../components/logo';
import { errorMessage } from '../../lib/api';
const credentials = z.object({
  email: z.email(),
  password: z.string().min(12, 'Use at least 12 characters.'),
  name: z.string(),
});
const copy = {
  login: { title: 'Welcome back.', description: 'Sign in to your FileForge workspace.' },
  register: {
    title: 'Make room for connections.',
    description: 'Create your account and organize your first card.',
  },
  forgot: {
    title: 'Forgot your password?',
    description: 'We’ll help you get back into your workspace.',
  },
  reset: {
    title: 'Choose a new password.',
    description: 'Use a strong password you haven’t used before.',
  },
  verify: {
    title: 'Verify your email.',
    description: 'Keep your account secure by confirming your email.',
  },
};
type Mode = keyof typeof copy;
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [cap, setCap] = useState<{
    email: boolean;
    google: boolean;
    microsoft: boolean;
    registrationAvailable: boolean;
    verificationRequired: boolean;
  }>({
    email: false,
    google: false,
    microsoft: false,
    registrationAvailable: false,
    verificationRequired: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [token, setToken] = useState('');
  const form = useForm({
    initialValues: { name: '', email: '', password: '', confirmPassword: '', agreed: false },
    validate: {
      name: (v) => (mode === 'register' && v.trim().length < 2 ? 'Enter your name.' : null),
      email: (v) =>
        mode !== 'reset' && !z.email().safeParse(v).success ? 'Enter a valid email address.' : null,
      password: (v) =>
        (mode === 'register' || mode === 'reset') && v.length < 12
          ? 'Use at least 12 characters.'
          : mode === 'login' && !v
            ? 'Enter your password.'
            : null,
      confirmPassword: (v, values) =>
        mode === 'reset' && v !== values.password ? 'Passwords do not match.' : null,
      agreed: (v) => (mode === 'register' && !v ? 'Please review and accept the terms.' : null),
    },
  });
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCap)
      .catch(() => {});
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);
  async function submit(values: typeof form.values) {
    setPending(true);
    setError('');
    setSuccess('');
    try {
      let result;
      if (mode === 'login')
        result = await authClient.signIn.email({ email: values.email, password: values.password });
      else if (mode === 'register') {
        const valid = credentials.safeParse(values);
        if (!valid.success) {
          setError(valid.error.issues[0]?.message || 'Check your details.');
          return;
        }
        result = await authClient.signUp.email({
          email: values.email,
          password: values.password,
          name: values.name,
          callbackURL: '/dashboard',
        });
      } else if (mode === 'forgot')
        result = await authClient.requestPasswordReset({
          email: values.email,
          redirectTo: '/reset-password',
        });
      else if (mode === 'reset') {
        if (!token) throw new Error('This reset link is missing its token. Request a new link.');
        result = await authClient.resetPassword({ newPassword: values.password, token });
      } else
        result = await authClient.sendVerificationEmail({
          email: values.email,
          callbackURL: '/dashboard',
        });
      if (result.error)
        throw new Error(result.error.message || 'Please check your details and try again.');
      if (mode === 'register' && cap.verificationRequired) {
        setSuccess(
          'Your account has been created. Check your inbox to verify your email before signing in.',
        );
      } else if (mode === 'login' || mode === 'register') {
        router.push('/dashboard');
        router.refresh();
      } else if (mode === 'forgot')
        setSuccess(
          'If an account exists for this address, a reset email has been requested. Check your inbox.',
        );
      else if (mode === 'reset') setSuccess('Your password has been updated. You can now sign in.');
      else setSuccess('A verification email has been requested. Check your inbox.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  const emailFlow = mode === 'forgot' || mode === 'verify';
  return (
    <div className="auth-wrap">
      <aside className="auth-story">
        <Logo />
        <div>
          <Text className="eyebrow">FROM FIRST HELLO TO WHAT’S NEXT</Text>
          <h1>
            Good connections
            <br />
            deserve a place
            <br />
            to grow.
          </h1>
          <Text c="dimmed" lh={1.9} maw={370}>
            Bring your business cards together. Keep the details that matter. Get back to the work
            you love.
          </Text>
          <Group gap="xs" mt={35}>
            <IconLock size={16} />
            <Text size="xs" c="dimmed">
              Private files. Secure workspaces.
            </Text>
          </Group>
        </div>
        <Text size="xs" c="dimmed">
          FileForge AI · Thoughtfully organized.
        </Text>
      </aside>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <Anchor component={Link} href="/" size="xs" c="dimmed">
            <Group gap={6}>
              <IconArrowLeft size={14} />
              Back to FileForge
            </Group>
          </Anchor>
          <Title order={1} mt={35} style={{ fontSize: 31, letterSpacing: '-1px' }}>
            {copy[mode].title}
          </Title>
          <Text c="dimmed" size="sm" mt={9} mb={28}>
            {copy[mode].description}
          </Text>
          {(cap.google || cap.microsoft) && (mode === 'login' || mode === 'register') && (
            <>
              <Group grow mb="lg">
                {cap.google && (
                  <Button
                    variant="default"
                    leftSection={<IconBrandGoogle size={17} />}
                    onClick={() =>
                      void authClient.signIn.social({
                        provider: 'google',
                        callbackURL: '/dashboard',
                      })
                    }
                  >
                    Google
                  </Button>
                )}
                {cap.microsoft && (
                  <Button
                    variant="default"
                    leftSection={<IconBrandWindows size={17} />}
                    onClick={() =>
                      void authClient.signIn.social({
                        provider: 'microsoft',
                        callbackURL: '/dashboard',
                      })
                    }
                  >
                    Microsoft
                  </Button>
                )}
              </Group>
              <Divider label="or continue with email" labelPosition="center" mb="lg" />
            </>
          )}
          {mode === 'register' && !cap.registrationAvailable && (
            <Alert
              icon={<IconInfoCircle size={18} />}
              title="Registration requires email verification"
              color="yellow"
              mb="lg"
            >
              Production registration is unavailable until the administrator configures
              transactional email.
            </Alert>
          )}
          {emailFlow && !cap.email && (
            <Alert
              icon={<IconInfoCircle size={18} />}
              title="Email delivery isn’t configured"
              color="yellow"
              mb="lg"
            >
              Verification and password reset emails are unavailable until the workspace
              administrator configures Resend.
            </Alert>
          )}
          {error && (
            <Alert color="red" mb="lg" title="Unable to continue">
              {error}
            </Alert>
          )}
          {success ? (
            <Stack>
              <Alert icon={<IconCheck size={18} />} color="teal">
                {success}
              </Alert>
              <Button component={Link} href="/login" variant="light">
                Back to sign in
              </Button>
            </Stack>
          ) : (
            <form onSubmit={form.onSubmit((v) => void submit(v))}>
              <Stack gap="md">
                {mode === 'register' && (
                  <TextInput
                    label="Full name"
                    placeholder="Your full name"
                    autoComplete="name"
                    required
                    {...form.getInputProps('name')}
                  />
                )}
                {mode !== 'reset' && (
                  <TextInput
                    type="email"
                    label="Email address"
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                    {...form.getInputProps('email')}
                  />
                )}
                {(mode === 'login' || mode === 'register' || mode === 'reset') && (
                  <PasswordInput
                    label={mode === 'reset' ? 'New password' : 'Password'}
                    placeholder={
                      mode === 'login' ? 'Enter your password' : 'At least 12 characters'
                    }
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    {...form.getInputProps('password')}
                  />
                )}
                {mode === 'reset' && (
                  <PasswordInput
                    label="Confirm password"
                    autoComplete="new-password"
                    required
                    {...form.getInputProps('confirmPassword')}
                  />
                )}
                {mode === 'login' && (
                  <Group justify="flex-end">
                    <Anchor component={Link} href="/forgot-password" size="xs">
                      Forgot password?
                    </Anchor>
                  </Group>
                )}
                {mode === 'register' && (
                  <Checkbox
                    size="xs"
                    label={
                      <>
                        I agree to the{' '}
                        <Anchor component={Link} href="/terms" size="xs">
                          Terms
                        </Anchor>{' '}
                        and{' '}
                        <Anchor component={Link} href="/privacy" size="xs">
                          Privacy Policy
                        </Anchor>
                        .
                      </>
                    }
                    {...form.getInputProps('agreed', { type: 'checkbox' })}
                  />
                )}
                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  mt={6}
                  loading={pending}
                  disabled={
                    (emailFlow && !cap.email) || (mode === 'register' && !cap.registrationAvailable)
                  }
                  rightSection={<IconArrowRight size={16} />}
                >
                  {mode === 'login'
                    ? 'Sign in'
                    : mode === 'register'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset link'
                        : mode === 'reset'
                          ? 'Update password'
                          : 'Send verification email'}
                </Button>
              </Stack>
            </form>
          )}
          {mode === 'login' && (
            <Text size="sm" c="dimmed" ta="center" mt={24}>
              New to FileForge?{' '}
              <Anchor component={Link} href="/register" size="sm">
                Create an account
              </Anchor>
            </Text>
          )}
          {mode === 'register' && (
            <Text size="sm" c="dimmed" ta="center" mt={24}>
              Already have an account?{' '}
              <Anchor component={Link} href="/login" size="sm">
                Sign in
              </Anchor>
            </Text>
          )}
          <Text size="xs" c="dimmed" ta="center" mt={38}>
            Your next connection starts here.
          </Text>
        </div>
      </section>
    </div>
  );
}
