'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import {
  Badge,
  Button,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useMantineTheme,
} from '@mantine/core';
import {
  IconFiles,
  IconScan,
  IconAddressBook,
  IconListCheck,
  IconArrowRight,
  IconUpload,
  IconFileSpreadsheet,
  IconActivity,
  IconCircleCheck,
  IconCircleX,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage, formatDate } from '../lib/api';
import { useAppearance } from '../stores/appearance';
import { useWorkspace } from '../stores/workspace';
import { EmptyState, ErrorState, PageHeader } from '../components/page-parts';
interface Dashboard {
  totalFiles: number;
  totalScans: number;
  totalContacts: number;
  processingJobs: number;
  successfulJobs: number;
  failedJobs: number;
  recentActivity: { id: string; action: string; createdAt: string }[];
  usage: unknown[];
}
function JobChart({
  completed,
  failed,
  processing,
}: {
  completed: number;
  failed: number;
  processing: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useMantineTheme();
  const reducedMotion = useAppearance((s) => s.preferences.reducedMotion);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void import('echarts').then((e) => {
      if (!ref.current) return;
      const chart = e.init(ref.current);
      chart.setOption({
        animation: !reducedMotion,
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['65%', '85%'],
            center: ['50%', '50%'],
            avoidLabelOverlap: false,
            label: { show: false },
            data: [
              { name: 'Completed', value: completed, itemStyle: { color: '#12b886' } },
              { name: 'Failed', value: failed, itemStyle: { color: '#fa5252' } },
              {
                name: 'Processing',
                value: processing,
                itemStyle: { color: theme.colors[theme.primaryColor]?.[6] },
              },
            ],
          },
        ],
      });
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(ref.current);
      dispose = () => {
        observer.disconnect();
        chart.dispose();
      };
    });
    return () => dispose?.();
  }, [completed, failed, processing, reducedMotion, theme]);
  return (
    <div
      ref={ref}
      style={{ height: 160, width: '100%' }}
      role="img"
      aria-label={`${completed} completed, ${failed} failed, ${processing} processing jobs`}
    />
  );
}
export function DashboardPage() {
  const workspace = useWorkspace((s) => s.id);
  const q = useQuery({
    queryKey: ['dashboard', workspace],
    queryFn: () => api<Dashboard>('/dashboard'),
  });
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Workspace overview"
        description="Your files, connections, and everything in between."
        action={
          <Button component={Link} href="/scanner" leftSection={<IconScan size={17} />}>
            Scan a business card
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} retry={() => void q.refetch()} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              { label: 'Total files', value: d?.totalFiles, icon: IconFiles, color: 'blue' },
              {
                label: 'Business card scans',
                value: d?.totalScans,
                icon: IconScan,
                color: 'violet',
              },
              {
                label: 'Saved contacts',
                value: d?.totalContacts,
                icon: IconAddressBook,
                color: 'teal',
              },
              {
                label: 'Processing jobs',
                value: d?.processingJobs,
                icon: IconListCheck,
                color: 'orange',
              },
            ].map((s) => (
              <div className="ff-panel" key={s.label}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" fw={550}>
                    {s.label}
                  </Text>
                  <ThemeIcon color={s.color} variant="light" size={32}>
                    <s.icon size={18} />
                  </ThemeIcon>
                </Group>
                {q.isLoading ? (
                  <Skeleton height={35} mt={16} />
                ) : (
                  <div className="stat-value">{s.value ?? 0}</div>
                )}
                <Text size="10px" c="dimmed">
                  In this workspace
                </Text>
              </div>
            ))}
          </div>
          <div className="dashboard-grid">
            <div className="ff-panel">
              <Group justify="space-between">
                <Title order={4}>Recent activity</Title>
                <Button
                  component={Link}
                  href="/jobs"
                  variant="subtle"
                  size="xs"
                  rightSection={<IconArrowRight size={13} />}
                >
                  View all
                </Button>
              </Group>
              {q.isLoading ? (
                <Skeleton height={150} mt={20} />
              ) : !d?.recentActivity.length ? (
                <EmptyState
                  icon={<IconActivity size={25} />}
                  title="Your workspace starts here"
                  description="Scan a card or save a contact. Your latest workspace activity will appear here."
                  action={
                    <Button variant="light" component={Link} href="/scanner" size="xs">
                      Scan your first card
                    </Button>
                  }
                />
              ) : (
                <Stack mt={20} gap={0}>
                  {d.recentActivity.map((a) => (
                    <Group
                      key={a.id}
                      justify="space-between"
                      py={13}
                      style={{ borderBottom: '1px solid var(--ff-border)' }}
                    >
                      <Group gap={10}>
                        <ThemeIcon color="gray" variant="light" size={30}>
                          <IconActivity size={16} />
                        </ThemeIcon>
                        <Text size="sm">{a.action.replaceAll('.', ' ').replaceAll('_', ' ')}</Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {formatDate(a.createdAt)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </div>
            <div className="ff-panel">
              <Title order={4} mb={5}>
                Make your next connection
              </Title>
              <Text size="xs" c="dimmed">
                A few useful places to start.
              </Text>
              {[
                {
                  href: '/scanner',
                  icon: IconUpload,
                  title: 'Scan a business card',
                  description: 'Turn a card into a contact.',
                },
                {
                  href: '/contacts',
                  icon: IconAddressBook,
                  title: 'Manage your contacts',
                  description: 'Find, review, and keep details up to date.',
                },
                {
                  href: '/exports',
                  icon: IconFileSpreadsheet,
                  title: 'Take your contacts with you',
                  description: 'Download an Excel workbook.',
                },
              ].map((a) => (
                <Link key={a.href} href={a.href} className="quick-action">
                  <ThemeIcon variant="light" size={38} color="gray">
                    <a.icon size={20} />
                  </ThemeIcon>
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={550}>
                      {a.title}
                    </Text>
                    <Text size="xs" c="dimmed" mt={3}>
                      {a.description}
                    </Text>
                  </div>
                  <IconArrowRight size={15} color="var(--ff-text-muted)" />
                </Link>
              ))}
            </div>
          </div>
          <div className="dashboard-grid">
            <div className="ff-panel">
              <Group justify="space-between" mb={18}>
                <div>
                  <Title order={4}>Processing health</Title>
                  <Text size="xs" c="dimmed" mt={5}>
                    Status of jobs in your workspace.
                  </Text>
                </div>
                <Badge variant="light" color="gray">
                  All time
                </Badge>
              </Group>
              {d && d.successfulJobs + d.failedJobs + d.processingJobs > 0 ? (
                <SimpleGrid cols={2}>
                  <JobChart
                    completed={d.successfulJobs}
                    failed={d.failedJobs}
                    processing={d.processingJobs}
                  />
                  <Stack justify="center">
                    <Group>
                      <IconCircleCheck size={17} color="var(--mantine-color-teal-6)" />
                      <Text size="sm">{d.successfulJobs} completed</Text>
                    </Group>
                    <Group>
                      <IconCircleX size={17} color="var(--mantine-color-red-6)" />
                      <Text size="sm">{d.failedJobs} failed</Text>
                    </Group>
                    <Group>
                      <IconListCheck size={17} color="var(--mantine-primary-color-filled)" />
                      <Text size="sm">{d.processingJobs} processing</Text>
                    </Group>
                  </Stack>
                </SimpleGrid>
              ) : (
                <Text size="sm" c="dimmed" py={30} ta="center">
                  Processing statistics will appear after your first job.
                </Text>
              )}
            </div>
            <div className="ff-panel">
              <Badge variant="light" color="teal" mb={14}>
                Always in your control
              </Badge>
              <Title order={4}>A little review goes a long way.</Title>
              <Text size="sm" c="dimmed" lh={1.9} mt={10}>
                AI can help read the details, but every contact deserves a second look. Review
                extracted information before saving it to your workspace.
              </Text>
              <Button
                component={Link}
                href="/scans"
                variant="subtle"
                px={0}
                mt={12}
                rightSection={<IconArrowRight size={15} />}
              >
                Review your scans
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
