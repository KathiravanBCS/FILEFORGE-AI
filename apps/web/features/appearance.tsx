'use client';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  useMantineTheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconDeviceDesktop,
  IconMoon,
  IconPalette,
  IconRefresh,
  IconSun,
  IconLayoutDashboard,
  IconScan,
  IconAddressBook,
} from '@tabler/icons-react';
import { accentColors, type UserPreferencesData } from '@fileforge/shared';
import { useAppearance } from '../stores/appearance';
import { api, errorMessage } from '../lib/api';
import { PageHeader, SettingsNav } from '../components/page-parts';
export function AppearancePage() {
  const preferences = useAppearance((s) => s.preferences);
  const update = useAppearance((s) => s.update);
  const reset = useAppearance((s) => s.reset);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const theme = useMantineTheme();
  function change(value: Partial<UserPreferencesData>) {
    update(value);
    setDirty(true);
  }
  async function save() {
    setSaving(true);
    try {
      await api('/preferences', { method: 'PATCH', body: JSON.stringify(preferences) });
      setDirty(false);
      notifications.show({
        title: 'Appearance saved',
        message: 'Your preferences will follow you across devices.',
        color: 'teal',
      });
    } catch (e) {
      notifications.show({
        title: 'Unable to save appearance',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Make it feel like you"
        description="A workspace that looks and works the way you like."
        action={
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => void save()}
            loading={saving}
            disabled={!dirty}
          >
            Save preferences
          </Button>
        }
      />
      <SettingsNav active="/settings/appearance" />
      <div className="preference-grid">
        <div className="ff-panel">
          <Title order={4} mb={24}>
            Appearance
          </Title>
          <div className="setting-row">
            <Text size="sm" fw={600} mb={5}>
              Color scheme
            </Text>
            <Text size="xs" c="dimmed" mb={16}>
              Choose a look, or follow your device’s settings.
            </Text>
            <SegmentedControl
              fullWidth
              value={preferences.colorScheme}
              onChange={(value) =>
                change({ colorScheme: value as UserPreferencesData['colorScheme'] })
              }
              data={[
                {
                  value: 'light',
                  label: (
                    <Group gap={7} justify="center">
                      <IconSun size={16} />
                      Light
                    </Group>
                  ),
                },
                {
                  value: 'dark',
                  label: (
                    <Group gap={7} justify="center">
                      <IconMoon size={16} />
                      Dark
                    </Group>
                  ),
                },
                {
                  value: 'auto',
                  label: (
                    <Group gap={7} justify="center">
                      <IconDeviceDesktop size={16} />
                      System
                    </Group>
                  ),
                },
              ]}
            />
          </div>
          <div className="setting-row">
            <Text size="sm" fw={600} mb={5}>
              Accent color
            </Text>
            <Text size="xs" c="dimmed" mb={17}>
              A little color, throughout your workspace.
            </Text>
            <Group gap={14}>
              {accentColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch ${preferences.primaryColor === color ? 'selected' : ''}`}
                  aria-label={`${color} accent`}
                  aria-pressed={preferences.primaryColor === color}
                  onClick={() => change({ primaryColor: color })}
                  style={{ background: theme.colors[color]?.[6], color: theme.colors[color]?.[6] }}
                >
                  {preferences.primaryColor === color && (
                    <IconCheck size={17} color="white" stroke={2.5} />
                  )}
                </button>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt={13} tt="capitalize">
              {preferences.primaryColor}
            </Text>
          </div>
          <div className="setting-row">
            <Text size="sm" fw={600} mb={5}>
              Interface density
            </Text>
            <Text size="xs" c="dimmed" mb={15}>
              A bit more breathing room, or more on your screen.
            </Text>
            <SegmentedControl
              fullWidth
              data={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              value={preferences.density}
              onChange={(value) => change({ density: value as UserPreferencesData['density'] })}
            />
          </div>
          <div className="setting-row">
            <Text size="sm" fw={600} mb={5}>
              Corner style
            </Text>
            <Text size="xs" c="dimmed" mb={15}>
              Set the shape of buttons, inputs, and cards.
            </Text>
            <SegmentedControl
              fullWidth
              data={[
                { value: 'sm', label: 'Subtle' },
                { value: 'md', label: 'Rounded' },
                { value: 'lg', label: 'Soft' },
              ]}
              value={preferences.radius}
              onChange={(value) => change({ radius: value as UserPreferencesData['radius'] })}
            />
          </div>
          <div className="setting-row">
            <Switch
              label="Reduce motion"
              description="Minimize transitions and animations."
              checked={preferences.reducedMotion}
              onChange={(e) => change({ reducedMotion: e.currentTarget.checked })}
            />
          </div>
          <div className="setting-row">
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={600}>
                  Start fresh
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  Restore the default appearance.
                </Text>
              </div>
              <Button
                variant="default"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={() => {
                  reset();
                  setDirty(true);
                }}
              >
                Reset defaults
              </Button>
            </Group>
          </div>
        </div>
        <Stack>
          <div className="ff-panel" style={{ position: 'sticky', top: 90 }}>
            <Group justify="space-between" mb={18}>
              <Group gap={8}>
                <IconPalette size={17} />
                <Text size="sm" fw={600}>
                  Live preview
                </Text>
              </Group>
              <Badge variant="light" color="gray" size="xs">
                Updates instantly
              </Badge>
            </Group>
            <div
              style={{
                border: '1px solid var(--ff-border)',
                borderRadius: 'var(--mantine-radius-default)',
                overflow: 'hidden',
              }}
            >
              <Group
                justify="space-between"
                p="md"
                style={{ borderBottom: '1px solid var(--ff-border)' }}
              >
                <Group gap={7}>
                  <ThemeIcon size={24} variant="filled">
                    <IconScan size={14} />
                  </ThemeIcon>
                  <Text size="xs" fw={650}>
                    Your workspace
                  </Text>
                </Group>
                <Badge size="xs" variant="light">
                  Personal
                </Badge>
              </Group>
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr' }}>
                <Stack
                  align="center"
                  gap={15}
                  py={18}
                  style={{
                    background: 'var(--ff-surface)',
                    borderRight: '1px solid var(--ff-border)',
                  }}
                >
                  <ThemeIcon variant="light" size={28}>
                    <IconLayoutDashboard size={16} />
                  </ThemeIcon>
                  <IconScan size={17} color="var(--ff-text-muted)" />
                  <IconAddressBook size={17} color="var(--ff-text-muted)" />
                </Stack>
                <Stack p="lg" gap={preferences.density === 'compact' ? 10 : 18}>
                  <div>
                    <Text size="sm" fw={650}>
                      A new connection
                    </Text>
                    <Text size="10px" c="dimmed" mt={4}>
                      Your workspace, your way.
                    </Text>
                  </div>
                  <Group gap={7}>
                    <Badge size="xs" variant="light">
                      Ready for review
                    </Badge>
                    <Badge size="xs" color="gray" variant="light">
                      Business card
                    </Badge>
                  </Group>
                  <TextInput
                    label="Contact name"
                    placeholder="Alex Morgan"
                    readOnly
                    size={preferences.density === 'compact' ? 'xs' : 'sm'}
                  />
                  <Group>
                    <Button
                      size={preferences.density === 'compact' ? 'xs' : 'sm'}
                      leftSection={<IconCheck size={13} />}
                    >
                      Save contact
                    </Button>
                    <Button
                      variant="default"
                      size={preferences.density === 'compact' ? 'xs' : 'sm'}
                    >
                      Cancel
                    </Button>
                  </Group>
                  <Table withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          <Text size="10px">Name</Text>
                        </Table.Th>
                        <Table.Th>
                          <Text size="10px">Status</Text>
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>
                          <Text size="10px">Sample contact</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color="teal">
                            Approved
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </Stack>
              </div>
            </div>
            <Text size="10px" c="dimmed" mt={15}>
              Illustrative preview. No contact is created.
            </Text>
          </div>
          <Alert variant="light" color="gray" title="Made for every device">
            Your saved account preferences take priority over local preferences. Anonymous
            preferences stay on this browser. System mode follows your device. Workspace themes are
            reserved for a future release.
          </Alert>
        </Stack>
      </div>
    </>
  );
}
