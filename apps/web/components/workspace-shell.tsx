'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconLayoutDashboard,
  IconScan,
  IconAddressBook,
  IconHistory,
  IconFiles,
  IconListCheck,
  IconFileExport,
  IconSettings,
  IconChartBar,
  IconChevronDown,
  IconPlus,
  IconLogout,
  IconPalette,
  IconArrowUpRight,
  IconCheck,
} from '@tabler/icons-react';
import { Logo } from './logo';
import { api, errorMessage } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { useWorkspace } from '../stores/workspace';
import { useAppearance } from '../stores/appearance';
import type { UserPreferencesData } from '@fileforge/shared';
import { notifications } from '@mantine/notifications';
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}
const links = [
  {
    section: 'WORKSPACE',
    items: [
      ['/dashboard', 'Overview', IconLayoutDashboard],
      ['/scanner', 'Business card scanner', IconScan],
      ['/contacts', 'Contacts', IconAddressBook],
      ['/scans', 'Scan history', IconHistory],
    ],
  },
  {
    section: 'LIBRARY',
    items: [
      ['/files', 'Files', IconFiles],
      ['/jobs', 'Processing jobs', IconListCheck],
      ['/exports', 'Exports', IconFileExport],
    ],
  },
  {
    section: 'MANAGE',
    items: [
      ['/usage', 'Usage overview', IconChartBar],
      ['/settings/workspace', 'Settings', IconSettings],
    ],
  },
] as const;
export function WorkspaceShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; email: string };
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspace((s) => s.id);
  const setWorkspace = useWorkspace((s) => s.setId);
  const updateAppearance = useAppearance((s) => s.update);
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<{ data: Workspace[] }>('/workspaces'),
  });
  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api<UserPreferencesData>('/preferences'),
  });
  useEffect(() => {
    if (preferences.data) updateAppearance(preferences.data);
  }, [preferences.data, updateAppearance]);
  useEffect(() => {
    if (workspaces.data?.data.length && !workspaces.data.data.some((w) => w.id === workspaceId))
      setWorkspace(workspaces.data.data[0]!.id);
  }, [workspaces.data, workspaceId, setWorkspace]);
  useEffect(() => {
    close();
  }, [pathname, close]);
  const active = workspaces.data?.data.find((w) => w.id === workspaceId);
  const initials = user.name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const switchWorkspace = (id: string | null) => {
    if (id) {
      setWorkspace(id);
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'workspaces' && q.queryKey[0] !== 'preferences',
      });
    }
  };
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error(result.error.message || 'The session could not be revoked. Try again.');
      }
      queryClient.clear();
      router.push('/login');
      router.refresh();
    } catch (error) {
      notifications.show({
        title: 'Unable to sign out',
        message: errorMessage(error),
        color: 'red',
      });
    } finally {
      setSigningOut(false);
    }
  }
  async function create() {
    setCreating(true);
    try {
      const result = await api<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, slug }),
      });
      setWorkspace(result.id);
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setCreateOpen(false);
      setName('');
      setSlug('');
      notifications.show({
        title: 'Workspace created',
        message: 'Your workspace is ready.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to create workspace',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setCreating(false);
    }
  }
  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 246, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding={0}
    >
      <AppShell.Header px="xl">
        <Group h="100%" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
            />
            <div className="nav-extra">
              <Text size="sm" fw={550}>
                {pathname.startsWith('/settings')
                  ? 'Workspace settings'
                  : links.map((g) => g.items.find((x) => x[0] === pathname)?.[1]).find(Boolean) ||
                    'FileForge workspace'}
              </Text>
            </div>
          </Group>
          <Group gap="sm">
            <Badge color="gray" variant="light" size="sm" visibleFrom="sm">
              {active?.role || 'Workspace'}
            </Badge>
            <Tooltip label="Appearance settings">
              <ActionIcon
                component={Link}
                href="/settings/appearance"
                variant="subtle"
                color="gray"
                aria-label="Appearance settings"
              >
                <IconPalette size={20} />
              </ActionIcon>
            </Tooltip>
            <Divider orientation="vertical" h={24} />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  px={4}
                  rightSection={<IconChevronDown size={13} />}
                  leftSection={
                    <Avatar size={30} radius="xl" color="blue">
                      {initials}
                    </Avatar>
                  }
                >
                  <Text size="xs" fw={550} maw={110} truncate>
                    {user.name}
                  </Text>
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{user.email}</Menu.Label>
                <Menu.Item
                  component={Link}
                  href="/settings/profile"
                  leftSection={<IconSettings size={15} />}
                >
                  Account settings
                </Menu.Item>
                <Menu.Item
                  component={Link}
                  href="/settings/appearance"
                  leftSection={<IconPalette size={15} />}
                >
                  Appearance
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconLogout size={15} />}
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <div style={{ padding: '6px 8px 25px' }}>
          <Logo href="/dashboard" />
        </div>
        <Select
          aria-label="Active workspace"
          value={workspaceId || null}
          data={workspaces.data?.data.map((w) => ({ value: w.id, label: w.name })) || []}
          onChange={switchWorkspace}
          placeholder={workspaces.isLoading ? 'Loading workspace…' : 'Select a workspace'}
          leftSection={
            <ThemeIcon size={23} variant="light" radius="sm">
              <Text size="xs" fw={700}>
                {active?.name[0]?.toUpperCase() || 'W'}
              </Text>
            </ThemeIcon>
          }
          rightSection={<IconChevronDown size={14} />}
        />
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconPlus size={13} />}
          justify="start"
          mt={6}
          onClick={() => setCreateOpen(true)}
        >
          Create workspace
        </Button>
        <AppShell.Section grow component={ScrollArea} offsetScrollbars mt={8}>
          {links.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map(([href, label, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${pathname === href || (href === '/settings/workspace' && pathname.startsWith('/settings')) ? 'active' : ''}`}
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  <Icon size={19} stroke={1.65} />
                  <span>{label}</span>
                  {href === '/scanner' && (
                    <Badge size="xs" variant="light" ml="auto">
                      AI
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </AppShell.Section>
        <div className="sidebar-footer">
          <Group gap={10} wrap="nowrap">
            <ThemeIcon color="gray" variant="light">
              <IconShieldInfo />
            </ThemeIcon>
            <div>
              <Text size="xs" fw={600}>
                A private workspace
              </Text>
              <Text size="10px" c="dimmed" mt={3}>
                Your files. Your connections.
              </Text>
            </div>
          </Group>
          <Button
            component={Link}
            href="/privacy"
            variant="subtle"
            size="xs"
            color="gray"
            fullWidth
            mt="sm"
            rightSection={<IconArrowUpRight size={13} />}
          >
            Privacy & data
          </Button>
        </div>
      </AppShell.Navbar>
      <AppShell.Main className="ff-main">
        <div className="page-container">
          {workspaces.isError ? (
            <div className="ff-panel">
              <Text c="red">Unable to load workspaces: {errorMessage(workspaces.error)}</Text>
              <Button onClick={() => void workspaces.refetch()} mt="md">
                Retry
              </Button>
            </div>
          ) : workspaces.data?.data.length === 0 ? (
            <div className="ff-panel">
              <Text fw={600}>Create your first workspace</Text>
              <Text size="sm" c="dimmed" mt="sm">
                A workspace keeps your contacts and files together.
              </Text>
              <Button mt="md" onClick={() => setCreateOpen(true)}>
                Create workspace
              </Button>
            </div>
          ) : workspaceId ? (
            children
          ) : (
            <Text c="dimmed">Preparing your workspace…</Text>
          )}
        </div>
      </AppShell.Main>
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a workspace"
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Keep a team or project’s contacts and files together.
          </Text>
          <TextInput
            label="Workspace name"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setSlug(
                e.currentTarget.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
              );
            }}
            required
          />
          <TextInput
            label="Workspace handle"
            description="Lowercase letters, numbers, and hyphens."
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            required
          />
          <Button
            onClick={() => void create()}
            loading={creating}
            disabled={name.trim().length < 2 || slug.length < 2}
          >
            Create workspace
          </Button>
        </Stack>
      </Modal>
    </AppShell>
  );
}
function IconShieldInfo() {
  return <IconCheck size={19} />;
}
