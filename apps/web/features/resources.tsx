'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Group, Pagination, Progress, ScrollArea, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import {
  IconDownload,
  IconRefresh,
  IconScan,
  IconArrowRight,
  IconFiles,
  IconListCheck,
  IconFileExport,
  IconHistory,
} from '@tabler/icons-react';
import { api, errorMessage, formatDate } from '../lib/api';
import { useWorkspace } from '../stores/workspace';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/page-parts';
interface Resource {
  id: string;
  createdAt: string;
  originalName?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  status?: string;
  type?: string;
  progress?: number;
  error?: string | null;
  count?: number;
  expiresAt?: string;
  job?: { status: string; progress: number; error?: string };
  images?: { file: { originalName: string } }[];
  contacts?: { fullName: string | null }[];
}
const configs = {
  scans: {
    title: 'Scan history',
    description: 'Every card, from upload to reviewed contact.',
    empty: 'Your scan history starts with one card.',
    detail: 'Upload your first business card to see its progress and extracted details here.',
    icon: IconHistory,
  },
  files: {
    title: 'Files',
    description: 'The original images and documents in your private workspace.',
    empty: 'A place for your files.',
    detail: 'Uploaded business card images and generated documents will appear here.',
    icon: IconFiles,
  },
  jobs: {
    title: 'Processing jobs',
    description: 'Follow the progress of work happening in the background.',
    empty: 'No processing jobs yet.',
    detail: 'Scan a business card or export contacts to create your first job.',
    icon: IconListCheck,
  },
  exports: {
    title: 'Exports',
    description: 'Your contacts, neatly packaged and ready to go.',
    empty: 'Your workbooks will be waiting here.',
    detail: 'Select contacts and export them to create a formatted Excel workbook.',
    icon: IconFileExport,
  },
};
export function ResourcePage({ kind }: { kind: keyof typeof configs }) {
  const workspace = useWorkspace((s) => s.id);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const config = configs[kind];
  const q = useQuery({
    queryKey: [kind, workspace, page],
    queryFn: () =>
      api<{ data: Resource[]; total: number; page: number; pageSize: number }>(
        `/${kind}?page=${page}&pageSize=20`,
      ),
    refetchInterval: (query) =>
      query.state.data?.data.some((x) =>
        ['processing', 'queued'].includes(x.job?.status || x.status || ''),
      )
        ? 4000
        : false,
  });
  async function download(id: string) {
    setBusy(id);
    try {
      const { url } = await api<{ url: string }>(`/${kind}/${id}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      notifications.show({ color: 'red', title: 'Download unavailable', message: errorMessage(e) });
    } finally {
      setBusy('');
    }
  }
  async function retry(id: string) {
    setBusy(id);
    try {
      await api(`/exports/${id}/retry`, { method: 'POST' });
      await q.refetch();
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Unable to retry export',
        message: errorMessage(e),
      });
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        action={
          kind === 'exports' ? (
            <Button component={Link} href="/contacts" leftSection={<IconFileExport size={16} />}>
              Export contacts
            </Button>
          ) : (
            <Button component={Link} href="/scanner" leftSection={<IconScan size={16} />}>
              Scan a card
            </Button>
          )
        }
      />
      <div className="ff-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <Group p="lg" justify="space-between">
          <Text size="sm" fw={600}>
            {kind === 'scans'
              ? 'All scans'
              : kind === 'files'
                ? 'All files'
                : kind === 'jobs'
                  ? 'All jobs'
                  : 'All exports'}
          </Text>
          <Group>
            <Text size="xs" c="dimmed">
              {q.data?.total ?? 0} records
            </Text>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={() => void q.refetch()}
            >
              Refresh
            </Button>
          </Group>
        </Group>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <div style={{ padding: 20 }}>
            <ErrorState message={errorMessage(q.error)} retry={() => void q.refetch()} />
          </div>
        ) : !q.data?.data.length ? (
          <EmptyState
            icon={<config.icon size={26} />}
            title={config.empty}
            description={config.detail}
            action={
              <Button
                component={Link}
                href={kind === 'exports' ? '/contacts' : '/scanner'}
                variant="light"
              >
                {kind === 'exports' ? 'View contacts' : 'Scan your first card'}
              </Button>
            }
          />
        ) : (
          <>
            <ScrollArea>
              <Table highlightOnHover verticalSpacing="md" horizontalSpacing="lg" miw={700}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{kind === 'jobs' ? 'Job' : 'Name'}</Table.Th>
                    <Table.Th>Status</Table.Th>
                    {kind === 'files' ? (
                      <Table.Th>Size</Table.Th>
                    ) : kind === 'jobs' ? (
                      <Table.Th>Progress</Table.Th>
                    ) : kind === 'exports' ? (
                      <Table.Th>Contacts</Table.Th>
                    ) : (
                      <Table.Th>Contact</Table.Th>
                    )}
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {q.data.data.map((record) => {
                    const status = record.job?.status || record.status || 'stored';
                    return (
                      <Table.Tr key={record.id}>
                        <Table.Td>
                          <Group gap={9}>
                            <config.icon size={17} color="var(--ff-text-muted)" />
                            <Text size="xs" fw={550}>
                              {record.originalName ||
                                record.fileName ||
                                record.images?.[0]?.file.originalName ||
                                `${record.type || 'Scan'} · ${record.id.slice(0, 8)}`}
                            </Text>
                          </Group>
                          {(record.error || record.job?.error) && (
                            <Text size="10px" c="red" mt={5} maw={300}>
                              {record.error || record.job?.error}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            size="xs"
                            color={
                              ['failed'].includes(status)
                                ? 'red'
                                : ['completed', 'stored'].includes(status)
                                  ? 'teal'
                                  : status === 'review'
                                    ? 'orange'
                                    : 'blue'
                            }
                          >
                            {status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          {kind === 'files' ? (
                            <Text size="xs" c="dimmed">
                              {record.size ? `${(record.size / 1024 / 1024).toFixed(2)} MB` : '—'}
                            </Text>
                          ) : kind === 'jobs' ? (
                            <Group gap={9}>
                              <Progress value={record.progress || 0} w={75} />
                              <Text size="xs" c="dimmed">
                                {record.progress || 0}%
                              </Text>
                            </Group>
                          ) : kind === 'exports' ? (
                            <Text size="xs">{record.count ?? '—'}</Text>
                          ) : (
                            <Text size="xs">
                              {record.contacts?.[0]?.fullName || 'Not saved yet'}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {formatDate(record.createdAt)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {kind === 'scans' ? (
                            <Button
                              component={Link}
                              href={`/scans/${record.id}`}
                              variant="subtle"
                              size="xs"
                              rightSection={<IconArrowRight size={14} />}
                            >
                              {status === 'review' ? 'Review' : 'View'}
                            </Button>
                          ) : kind === 'exports' && status === 'failed' ? (
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconRefresh size={14} />}
                              loading={busy === record.id}
                              onClick={() => void retry(record.id)}
                            >
                              Retry
                            </Button>
                          ) : kind === 'files' || kind === 'exports' ? (
                            <Button
                              variant="subtle"
                              size="xs"
                              leftSection={<IconDownload size={14} />}
                              disabled={kind === 'exports' && status !== 'completed'}
                              loading={busy === record.id}
                              onClick={() => void download(record.id)}
                            >
                              Download
                            </Button>
                          ) : (
                            <Text size="xs" c="dimmed">
                              {record.type === 'scan' ? 'View scan history' : '—'}
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group justify="space-between" p="lg">
              <Text size="xs" c="dimmed">
                Page {page} of {Math.max(1, Math.ceil(q.data.total / 20))}
              </Text>
              <Pagination
                size="sm"
                total={Math.max(1, Math.ceil(q.data.total / 20))}
                value={page}
                onChange={setPage}
              />
            </Group>
          </>
        )}
      </div>
      {kind === 'exports' && (
        <Text size="xs" c="dimmed" mt={18}>
          Downloads use short-lived private links. Generated workbooks follow the configured
          retention policy.
        </Text>
      )}
    </>
  );
}
