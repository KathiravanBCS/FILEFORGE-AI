'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconShieldLock, IconUserPlus } from '@tabler/icons-react';
import { api, errorMessage, formatDate } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { useWorkspace } from '../stores/workspace';
import { useAppearance } from '../stores/appearance';
import {
  PageHeader,
  SettingsNav,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../components/page-parts';
import type { Workspace } from '../components/workspace-shell';
interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}
function useActiveWorkspace() {
  const id = useWorkspace((s) => s.id);
  const q = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<{ data: Workspace[] }>('/workspaces'),
  });
  return q.data?.data.find((w) => w.id === id);
}
export function WorkspaceSettings() {
  const active = useActiveWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (active) {
      setName(active.name);
      setSlug(active.slug);
    }
  }, [active]);
  const canManage = active?.role === 'owner' || active?.role === 'admin';
  async function save() {
    setPending(true);
    try {
      await api(`/workspaces/${active?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, slug }),
      });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      notifications.show({
        title: 'Workspace updated',
        message: 'Your workspace details have been saved.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to save workspace',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="A home for your team’s files and connections."
      />
      <SettingsNav active="/settings/workspace" />
      <div className="ff-panel" style={{ maxWidth: 760 }}>
        <Title order={4} mb={8}>
          General
        </Title>
        <Text size="sm" c="dimmed" mb={26}>
          Update the details of your active workspace.
        </Text>
        {!canManage && (
          <Alert color="yellow" mb="lg">
            Only workspace owners and administrators can edit these settings.
          </Alert>
        )}
        <Stack>
          <TextInput
            label="Workspace name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={!canManage}
          />
          <TextInput
            label="Workspace handle"
            description="Lowercase letters, numbers, and hyphens."
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            disabled={!canManage}
          />
          <SimpleGrid cols={2} mt="sm">
            <div>
              <Text size="xs" c="dimmed">
                Workspace ID
              </Text>
              <Text size="xs" mt={6}>
                {active?.id || '—'}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Your role
              </Text>
              <Badge variant="light" mt={6}>
                {active?.role || '—'}
              </Badge>
            </div>
          </SimpleGrid>
          <Group justify="flex-end" mt="lg">
            <Button
              disabled={!canManage || name.length < 2 || slug.length < 2}
              loading={pending}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </div>
    </>
  );
}
export function MembersSettings() {
  const workspace = useWorkspace((s) => s.id);
  const active = useActiveWorkspace();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState('');
  const q = useQuery({
    queryKey: ['members', workspace],
    queryFn: () => api<{ data: Member[] }>('/members'),
  });
  const manage = active?.role === 'owner' || active?.role === 'admin';
  async function change(id: string, role: string) {
    setBusy(id);
    try {
      await api(`/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await qc.invalidateQueries({ queryKey: ['members'] });
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Unable to change role',
        message: errorMessage(e),
      });
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api(`/members/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      await qc.invalidateQueries({ queryKey: ['members'] });
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Unable to remove member',
        message: errorMessage(e),
      });
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeader
        title="Workspace members"
        description="The people who make this workspace work."
      />
      <SettingsNav active="/settings/members" />
      <div className="ff-panel">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} />
        ) : (
          <Table.ScrollContainer minWidth={620}>
            <Table verticalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Member</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Joined</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data?.data.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>
                      <Group gap={10}>
                        <Avatar size={32} color="blue" radius="xl">
                          {m.user.name[0]?.toUpperCase()}
                        </Avatar>
                        <div>
                          <Text size="sm" fw={550}>
                            {m.user.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {m.user.email}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {manage && m.role !== 'owner' ? (
                        <Select
                          aria-label={`Role for ${m.user.name}`}
                          size="xs"
                          w={120}
                          value={m.role}
                          disabled={busy === m.id}
                          onChange={(role) => {
                            if (role) void change(m.id, role);
                          }}
                          data={
                            active?.role === 'owner'
                              ? ['admin', 'member', 'viewer']
                              : ['member', 'viewer']
                          }
                        />
                      ) : (
                        <Badge variant="light" size="sm">
                          {m.role}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {formatDate(m.createdAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {manage && m.role !== 'owner' && (
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={() => setRemoving(m)}
                        >
                          Remove
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </div>
      <Text size="xs" c="dimmed" mt={18}>
        Viewers can read. Members can create and edit. Administrators manage members and workspace
        settings. Owners retain full control.
      </Text>
      <Modal
        opened={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove member?"
        centered
      >
        <Text size="sm">{removing?.user.name} will lose access to this workspace.</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button color="red" loading={Boolean(busy)} onClick={() => void remove()}>
            Remove member
          </Button>
        </Group>
      </Modal>
    </>
  );
}
export function InvitationsSettings() {
  const workspace = useWorkspace((s) => s.id);
  const active = useActiveWorkspace();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['invitations', workspace],
    queryFn: () => api<{ data: Invitation[] }>('/invitations'),
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string | null>('member');
  const [busy, setBusy] = useState(false);
  const [canEmail, setCanEmail] = useState(false);
  const [invitationId, setInvitationId] = useState('');
  const [accepted, setAccepted] = useState(false);
  const detail = useQuery({
    queryKey: ['invitation', invitationId],
    queryFn: () =>
      api<{ id: string; role: string; organization: { id: string; name: string } }>(
        `/invitations/${invitationId}`,
      ),
    enabled: Boolean(invitationId),
  });
  useEffect(() => {
    void fetch('/api/config')
      .then((r) => r.json())
      .then((c: { email: boolean }) => setCanEmail(c.email));
    setInvitationId(new URLSearchParams(window.location.search).get('invitationId') || '');
  }, []);
  const manage = active?.role === 'owner' || active?.role === 'admin';
  async function invite() {
    setBusy(true);
    try {
      await api('/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
      setEmail('');
      await qc.invalidateQueries({ queryKey: ['invitations'] });
      notifications.show({
        title: 'Invitation created',
        message: 'The email provider accepted the invitation email for delivery.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to invite member',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    try {
      await api(`/invitations/${id}/cancel`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['invitations'] });
    } catch (e) {
      notifications.show({
        title: 'Unable to cancel invitation',
        message: errorMessage(e),
        color: 'red',
      });
    }
  }
  async function accept() {
    setBusy(true);
    try {
      await api(`/invitations/${invitationId}/accept`, { method: 'POST' });
      setAccepted(true);
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      notifications.show({
        title: 'Invitation accepted',
        message: 'You can now select this workspace from the sidebar.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to accept invitation',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Invitations" description="Bring your team into the conversation." />
      <SettingsNav active="/settings/invitations" />
      {invitationId && (
        <div className="ff-panel" style={{ marginBottom: 24 }}>
          {detail.isError ? (
            <ErrorState message={errorMessage(detail.error)} />
          ) : detail.data ? (
            <Group justify="space-between">
              <div>
                <Title order={4}>
                  {accepted
                    ? 'You’ve joined the workspace'
                    : `You’re invited to ${detail.data.organization.name}`}
                </Title>
                <Text size="sm" c="dimmed" mt={6}>
                  Role: {detail.data.role}
                </Text>
              </div>
              <Button loading={busy} disabled={accepted} onClick={() => void accept()}>
                {accepted ? 'Accepted' : 'Accept invitation'}
              </Button>
            </Group>
          ) : (
            <LoadingState />
          )}
        </div>
      )}
      <div className="ff-panel">
        <Title order={4}>Invite a teammate</Title>
        <Text size="xs" c="dimmed" mt={7} mb={20}>
          Invite someone by email and choose their workspace role.
        </Text>
        {!canEmail && (
          <Alert color="yellow" mb={20}>
            Invitations are unavailable until Resend and a sender address are configured.
          </Alert>
        )}
        {!manage && (
          <Alert color="gray" mb={20}>
            Only owners and administrators can invite members.
          </Alert>
        )}
        <Group align="flex-end">
          <TextInput
            label="Email address"
            type="email"
            placeholder="colleague@company.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            style={{ flex: 1 }}
            disabled={!manage || !canEmail}
          />
          <Select
            label="Role"
            data={active?.role === 'owner' ? ['admin', 'member', 'viewer'] : ['member', 'viewer']}
            value={role}
            onChange={setRole}
            w={150}
            disabled={!manage || !canEmail}
          />
          <Button
            leftSection={<IconUserPlus size={16} />}
            disabled={!manage || !canEmail || !email.includes('@')}
            loading={busy}
            onClick={() => void invite()}
          >
            Send invitation
          </Button>
        </Group>
      </div>
      <div className="ff-panel" style={{ marginTop: 24 }}>
        <Title order={4} mb={18}>
          Sent invitations
        </Title>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} />
        ) : !q.data?.data.length ? (
          <EmptyState
            title="No invitations yet"
            description="Invitations you send to your teammates will appear here."
          />
        ) : (
          <Table.ScrollContainer minWidth={550}>
            <Table verticalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Expires</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.data.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      <Text size="xs">{i.email}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{i.role}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" size="xs">
                        {i.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {formatDate(i.expiresAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {i.status === 'pending' && manage && (
                        <Button
                          size="xs"
                          color="red"
                          variant="subtle"
                          onClick={() => void cancel(i.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </div>
    </>
  );
}
export function ProfileSettings() {
  const session = authClient.useSession();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const preferences = useAppearance((s) => s.preferences);
  const update = useAppearance((s) => s.update);
  useEffect(() => {
    if (session.data?.user.name) setName(session.data.user.name);
  }, [session.data]);
  async function save() {
    setPending(true);
    try {
      try {
        new Intl.DateTimeFormat('en', { timeZone: preferences.timeZone }).format();
      } catch {
        throw new Error('Enter a valid IANA time zone, such as Asia/Kolkata.');
      }
      const result = await authClient.updateUser({ name });
      if (result.error) throw new Error(result.error.message);
      await api('/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ language: preferences.language, timeZone: preferences.timeZone }),
      });
      await session.refetch();
      notifications.show({
        title: 'Profile updated',
        message: 'Your profile preferences are saved.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to update profile',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader title="Your profile" description="The details that make this workspace yours." />
      <SettingsNav active="/settings/profile" />
      <div className="ff-panel" style={{ maxWidth: 760 }}>
        <Group mb={28}>
          <Avatar size={64} color="blue" radius="xl">
            {name[0]?.toUpperCase()}
          </Avatar>
          <div>
            <Title order={4}>{name || 'Your profile'}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {session.data?.user.email}
            </Text>
          </div>
        </Group>
        <Stack>
          <TextInput
            label="Full name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="Email address"
            value={session.data?.user.email || ''}
            readOnly
            description="Your sign-in address."
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Language preference"
              value={preferences.language}
              data={[{ value: 'en', label: 'English' }]}
              description="Additional translations are planned."
              onChange={(value) => {
                if (value) update({ language: value });
              }}
            />
            <TextInput
              label="Time zone"
              value={preferences.timeZone}
              placeholder="Asia/Kolkata"
              description="IANA time zone name"
              onChange={(e) => update({ timeZone: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Group justify="flex-end" mt="md">
            <Button loading={pending} disabled={name.trim().length < 2} onClick={() => void save()}>
              Save profile
            </Button>
          </Group>
        </Stack>
      </div>
    </>
  );
}
export function SecuritySettings() {
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function password() {
    setError('');
    if (next.length < 12 || next !== confirm) {
      setError('Use at least 12 characters and make sure both new passwords match.');
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message);
      setCurrent('');
      setNext('');
      setConfirm('');
      await q.refetch();
      notifications.show({
        title: 'Password updated',
        message: 'Other sessions have been revoked.',
        color: 'teal',
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(token: string) {
    try {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(result.error.message);
      await q.refetch();
    } catch (e) {
      notifications.show({
        title: 'Unable to revoke session',
        message: errorMessage(e),
        color: 'red',
      });
    }
  }
  return (
    <>
      <PageHeader
        title="Account security"
        description="Keep your account and your workspace protected."
      />
      <SettingsNav active="/settings/security" />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <div className="ff-panel">
          <Group gap={9} mb={20}>
            <IconShieldLock size={21} />
            <Title order={4}>Change password</Title>
          </Group>
          <Stack>
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.currentTarget.value)}
            />
            <PasswordInput
              label="New password"
              description="Use at least 12 characters."
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.currentTarget.value)}
            />
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
            />
            {error && <Alert color="red">{error}</Alert>}
            <Button
              loading={busy}
              disabled={!current || !next || !confirm}
              onClick={() => void password()}
            >
              Update password
            </Button>
            <Text size="xs" c="dimmed">
              Changing your password signs out your other sessions.
            </Text>
          </Stack>
        </div>
        <div className="ff-panel">
          <Title order={4} mb={8}>
            Active sessions
          </Title>
          <Text size="xs" c="dimmed" mb={20}>
            Revoke sessions you no longer recognize.
          </Text>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState message={errorMessage(q.error)} />
          ) : (
            <Stack>
              {q.data?.map((s) => (
                <div
                  key={s.id}
                  style={{ borderBottom: '1px solid var(--ff-border)', paddingBottom: 16 }}
                >
                  <Text size="xs" fw={550} lineClamp={2}>
                    {s.userAgent || 'Unknown device'}
                  </Text>
                  <Group justify="space-between" mt={8}>
                    <Text size="10px" c="dimmed">
                      Expires {formatDate(new Date(s.expiresAt).toISOString())}
                    </Text>
                    <Button
                      size="xs"
                      color="red"
                      variant="subtle"
                      onClick={() => void revoke(s.token)}
                    >
                      Revoke
                    </Button>
                  </Group>
                </div>
              ))}
            </Stack>
          )}
          <Alert color="gray" mt={24}>
            MFA, passkeys, SSO, and SCIM are planned extension points and are not enabled in this
            release.
          </Alert>
        </div>
      </SimpleGrid>
    </>
  );
}
