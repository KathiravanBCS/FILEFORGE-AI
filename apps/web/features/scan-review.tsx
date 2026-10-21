'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Group, Progress, Stack, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCheck, IconRefresh, IconScan } from '@tabler/icons-react';
import type { ContactData } from '@fileforge/shared';
import { api, errorMessage, formatDate } from '../lib/api';
import { useWorkspace } from '../stores/workspace';
import { ContactEditor } from './contact-editor';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/page-parts';
interface Scan {
  id: string;
  createdAt: string;
  extractedData: ContactData | null;
  job: { id: string; status: string; progress: number; error: string | null };
  images: { position: number; file: { id: string; originalName: string } }[];
  contacts: { id: string; status: string }[];
}
function OriginalImage({ id, name }: { id: string; name: string }) {
  const workspace = useWorkspace((s) => s.id);
  const q = useQuery({
    queryKey: ['file-download', workspace, id],
    queryFn: () => api<{ url: string }>(`/files/${id}/download`),
    staleTime: 60_000,
    refetchInterval: 90_000,
  });
  return (
    <div>
      {q.data ? (
        <a href={q.data.url} target="_blank" rel="noopener noreferrer">
          <img
            src={q.data.url}
            alt={name}
            style={{
              width: '100%',
              maxHeight: 320,
              objectFit: 'contain',
              background: 'var(--ff-surface)',
              borderRadius: 8,
            }}
          />
        </a>
      ) : q.isError ? (
        <Text size="xs" c="red">
          Unable to load original image.
        </Text>
      ) : (
        <Text size="xs" c="dimmed">
          Loading original…
        </Text>
      )}
      <Text size="xs" c="dimmed" mt={8}>
        {name}
      </Text>
    </div>
  );
}
export function ScanReviewPage({ id }: { id: string }) {
  const workspace = useWorkspace((s) => s.id);
  const router = useRouter();
  const qc = useQueryClient();
  const [working, setWorking] = useState(false);
  const q = useQuery({
    queryKey: ['scan', workspace, id],
    queryFn: () => api<Scan>(`/scans/${id}`),
    refetchInterval: (query) =>
      ['queued', 'processing'].includes(query.state.data?.job.status || '') ? 2500 : false,
  });
  const s = q.data;
  async function action(type: 'retry' | 'cancel' | 'rescan') {
    setWorking(true);
    try {
      const result = await api<{ id: string }>(`/scans/${id}/${type}`, { method: 'POST' });
      if (type === 'rescan') {
        await qc.invalidateQueries({ queryKey: ['scans'] });
        await qc.invalidateQueries({ queryKey: ['jobs'] });
        await qc.invalidateQueries({ queryKey: ['dashboard'] });
        router.push(`/scans/${result.id}`);
      } else {
        await q.refetch();
      }
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Unable to update scan',
        message: errorMessage(e),
      });
    } finally {
      setWorking(false);
    }
  }
  async function save(data: ContactData, status: 'draft' | 'approved') {
    await api('/contacts', { method: 'POST', body: JSON.stringify({ scanId: id, data, status }) });
    await qc.invalidateQueries();
    notifications.show({
      title: status === 'approved' ? 'Contact approved' : 'Draft saved',
      message: 'The contact is saved in your workspace.',
      color: 'teal',
    });
    router.push('/contacts');
  }
  return (
    <>
      <Button
        component={Link}
        href="/scans"
        variant="subtle"
        size="xs"
        px={0}
        mb={16}
        leftSection={<IconArrowLeft size={15} />}
      >
        Back to scan history
      </Button>
      <PageHeader
        title="Review your scan"
        description="Check the details against your original card before saving."
        action={
          s && (
            <Badge
              variant="light"
              color={
                s.job.status === 'failed'
                  ? 'red'
                  : s.job.status === 'review'
                    ? 'orange'
                    : s.job.status === 'completed'
                      ? 'teal'
                      : 'blue'
              }
            >
              {s.job.status}
            </Badge>
          )
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} retry={() => void q.refetch()} />
      ) : s ? (
        <div className="scanner-grid">
          <div className="ff-panel">
            {['queued', 'processing'].includes(s.job.status) ? (
              <>
                <EmptyState
                  icon={<IconScan size={26} />}
                  title={
                    s.job.status === 'queued'
                      ? 'Your card is in the queue'
                      : 'Reading your business card'
                  }
                  description="The background worker will extract the contact details. You can leave this page and return from scan history."
                />
                <Progress value={s.job.progress || 0} animated mb={16} />
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {s.job.progress || 0}% complete
                  </Text>
                  <Button
                    variant="subtle"
                    color="red"
                    size="xs"
                    loading={working}
                    onClick={() => void action('cancel')}
                  >
                    Cancel scan
                  </Button>
                </Group>
              </>
            ) : s.job.status === 'failed' ? (
              <Stack>
                <Alert color="red" title="This scan couldn’t be completed">
                  {s.job.error || 'Processing failed. Check your provider configuration and retry.'}
                </Alert>
                <Button
                  onClick={() => void action('retry')}
                  loading={working}
                  leftSection={<IconRefresh size={16} />}
                >
                  Retry scan
                </Button>
              </Stack>
            ) : s.job.status === 'cancelled' ? (
              <EmptyState
                title="Scan cancelled"
                description="This card was not processed."
                action={
                  <Button onClick={() => void action('retry')} loading={working}>
                    Retry scan
                  </Button>
                }
              />
            ) : s.contacts.length > 0 ? (
              <EmptyState
                icon={<IconCheck size={24} />}
                title="Contact saved"
                description="The extracted details have been saved to your workspace. You can edit the contact from Contacts."
                action={
                  <Button component={Link} href="/contacts">
                    View contacts
                  </Button>
                }
              />
            ) : s.extractedData ? (
              <>
                <Group justify="space-between" mb={22}>
                  <Title order={4}>Extracted contact details</Title>
                  <Badge variant="light" color="orange">
                    Needs review
                  </Badge>
                </Group>
                <Alert color="blue" mb={22}>
                  AI extraction can be inaccurate. Check names, phone numbers, and email addresses
                  carefully.
                </Alert>
                <ContactEditor initialData={s.extractedData} onSave={save} />
              </>
            ) : (
              <EmptyState
                title="No extraction available"
                description="The scan has no reviewable output. Start a new scan using the original images."
                action={<Button onClick={() => void action('rescan')}>Rescan images</Button>}
              />
            )}
          </div>
          <Stack>
            <div className="ff-panel">
              <Group justify="space-between" mb={20}>
                <Title order={4}>Original business card</Title>
                <Text size="xs" c="dimmed">
                  {formatDate(s.createdAt)}
                </Text>
              </Group>
              <Stack>
                {s.images.map((image) => (
                  <OriginalImage
                    key={image.file.id}
                    id={image.file.id}
                    name={image.file.originalName}
                  />
                ))}
              </Stack>
            </div>
            {s.extractedData && (
              <Button
                variant="default"
                onClick={() => void action('rescan')}
                loading={working}
                leftSection={<IconRefresh size={16} />}
              >
                Rescan original images
              </Button>
            )}
          </Stack>
        </div>
      ) : null}
    </>
  );
}
