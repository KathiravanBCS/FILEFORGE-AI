'use client';
import type { ReactNode } from 'react';
import { Alert, Button, Group, Loader, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconInbox } from '@tabler/icons-react';
import Link from 'next/link';
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon || <IconInbox size={26} />}</div>
      <Title order={4} mb={8}>
        {title}
      </Title>
      <Text size="sm" c="dimmed" maw={390} mx="auto" lh={1.7}>
        {description}
      </Text>
      {action && (
        <Group justify="center" mt={22}>
          {action}
        </Group>
      )}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Alert color="red" title="Unable to load this view" icon={<IconAlertCircle size={18} />}>
      {message}
      {retry && (
        <Button variant="subtle" color="red" size="xs" onClick={retry} mt="sm">
          Try again
        </Button>
      )}
    </Alert>
  );
}
export function LoadingState() {
  return (
    <Group justify="center" p={50}>
      <Loader size="sm" />
      <Text size="sm" c="dimmed">
        Loading your workspace…
      </Text>
    </Group>
  );
}
export const settingsLinks = [
  ['/settings/workspace', 'Workspace'],
  ['/settings/members', 'Members'],
  ['/settings/invitations', 'Invitations'],
  ['/settings/profile', 'Profile'],
  ['/settings/security', 'Security'],
  ['/settings/appearance', 'Appearance'],
] as const;
export function SettingsNav({ active }: { active: string }) {
  return (
    <nav className="setting-nav" aria-label="Settings navigation">
      {settingsLinks.map(([href, label]) => (
        <Link key={href} href={href} className={active === href ? 'active' : ''}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
