'use client';
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Select,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconDots,
  IconDownload,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { DataTable } from '@fileforge/ui';
import type { ContactData, PaginatedResult } from '@fileforge/shared';
import { api, errorMessage, formatDate } from '../lib/api';
import { useWorkspace } from '../stores/workspace';
import { PageHeader } from '../components/page-parts';
import { ContactEditor } from './contact-editor';
interface Contact extends ContactData {
  id: string;
  status: 'draft' | 'approved';
  createdAt: string;
}
export function ContactsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const workspace = useWorkspace((s) => s.id);
  const qc = useQueryClient();
  const [search, setSearch] = useState(params.get('search') || '');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [company, setCompany] = useState(params.get('company') || '');
  const [jobTitle, setJobTitle] = useState(params.get('jobTitle') || '');
  const [debouncedCompany] = useDebouncedValue(company, 300);
  const [debouncedJobTitle] = useDebouncedValue(jobTitle, 300);
  const [status, setStatus] = useState<string | null>(params.get('status'));
  const [page, setPage] = useState(Number(params.get('page')) || 1);
  const [sorting, setSorting] = useState<SortingState>([
    { id: params.get('sort') || 'createdAt', desc: params.get('direction') !== 'asc' },
  ]);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState('');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '20',
    search: debouncedSearch,
    sort: sorting[0]?.id || 'createdAt',
    direction: sorting[0]?.desc ? 'desc' : 'asc',
  });
  if (status) query.set('status', status);
  if (debouncedCompany) query.set('company', debouncedCompany);
  if (debouncedJobTitle) query.set('jobTitle', debouncedJobTitle);
  const queryString = query.toString();
  useEffect(() => {
    router.replace(`/contacts?${queryString}`, { scroll: false });
  }, [queryString, router]);
  useEffect(() => {
    setSelected([]);
    setPage(1);
  }, [workspace]);
  const q = useQuery({
    queryKey: ['contacts', workspace, queryString],
    queryFn: () => api<PaginatedResult<Contact>>(`/contacts?${queryString}`),
  });
  async function save(data: ContactData, contactStatus: 'draft' | 'approved') {
    await api(editing ? `/contacts/${editing.id}` : '/contacts', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify({ data, status: contactStatus }),
    });
    setEditing(undefined);
    await qc.invalidateQueries({ queryKey: ['contacts'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
    notifications.show({
      title: 'Contact saved',
      message: 'Your contact details have been updated.',
      color: 'teal',
    });
  }
  async function remove() {
    setPending(true);
    setOperationError('');
    try {
      await api('/contacts/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selected }),
      });
      setSelected([]);
      setDeleting(false);
      await qc.invalidateQueries();
    } catch (e) {
      setOperationError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  async function exportContacts() {
    setPending(true);
    try {
      await api('/exports', {
        method: 'POST',
        body: JSON.stringify(
          selected.length
            ? { ids: selected }
            : {
                search: debouncedSearch,
                ...(status ? { status } : {}),
                ...(debouncedCompany ? { company: debouncedCompany } : {}),
                ...(debouncedJobTitle ? { jobTitle: debouncedJobTitle } : {}),
              },
        ),
      });
      notifications.show({
        title: 'Export queued',
        message: 'Track the workbook in Exports. Download it when processing is complete.',
        color: 'blue',
      });
      router.push('/exports');
    } catch (e) {
      notifications.show({
        title: 'Unable to export contacts',
        message: errorMessage(e),
        color: 'red',
      });
    } finally {
      setPending(false);
    }
  }
  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'Name',
        cell: ({ row }) => (
          <Group gap={10} wrap="nowrap">
            <div
              style={{
                width: 30,
                height: 30,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--mantine-primary-color-light)',
                color: 'var(--mantine-primary-color-filled)',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 650,
              }}
            >
              {row.original.fullName
                ?.split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase() || '—'}
            </div>
            <button
              type="button"
              onClick={() => setEditing(row.original)}
              style={{
                border: 0,
                background: 'none',
                color: 'inherit',
                padding: 0,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 550,
                textAlign: 'left',
              }}
            >
              {row.original.fullName || 'Unnamed contact'}
            </button>
          </Group>
        ),
      },
      {
        accessorKey: 'company',
        header: 'Company',
        cell: ({ getValue }) => <Text size="xs">{String(getValue() || '—')}</Text>,
      },
      {
        accessorKey: 'jobTitle',
        header: 'Job title',
        cell: ({ getValue }) => (
          <Text size="xs" c="dimmed">
            {String(getValue() || '—')}
          </Text>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        enableSorting: false,
        accessorFn: (c) => c.emails[0]?.email || '—',
        cell: ({ getValue }) => <Text size="xs">{String(getValue())}</Text>,
      },
      {
        id: 'phone',
        header: 'Phone',
        enableSorting: false,
        accessorFn: (c) => c.phones[0]?.number || '—',
        cell: ({ getValue }) => (
          <Text size="xs" c="dimmed">
            {String(getValue())}
          </Text>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge size="xs" variant="light" color={getValue() === 'approved' ? 'teal' : 'orange'}>
            {String(getValue())}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ getValue }) => (
          <Text size="xs" c="dimmed">
            {formatDate(String(getValue()))}
          </Text>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon
                aria-label={`Actions for ${row.original.fullName || 'contact'}`}
                variant="subtle"
                color="gray"
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconEdit size={15} />}
                onClick={() => setEditing(row.original)}
              >
                Edit contact
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={15} />}
                onClick={() => {
                  setSelected([row.original.id]);
                  setDeleting(true);
                }}
              >
                Delete contact
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Keep your connections organized, up to date, and ready for what’s next."
        action={
          <Group>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              loading={pending}
              onClick={() => void exportContacts()}
              disabled={!q.data?.total}
            >
              Export {selected.length ? 'selected' : 'contacts'}
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
              Add contact
            </Button>
          </Group>
        }
      />
      <div className="ff-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <Group p="lg" justify="space-between">
          <Group>
            <TextInput
              placeholder="Search names, companies, emails…"
              aria-label="Search contacts"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setPage(1);
              }}
              w={300}
              maw="100%"
            />
            <Select
              aria-label="Filter contacts by status"
              placeholder="All statuses"
              clearable
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              data={[
                { value: 'approved', label: 'Approved' },
                { value: 'draft', label: 'Draft' },
              ]}
              w={150}
            />
          </Group>
          <Text size="xs" c="dimmed">
            {q.data?.total ?? 0} contacts
          </Text>
        </Group>
        <Group px="lg" pb="lg" gap="sm">
          <TextInput
            label="Company filter"
            placeholder="Any company"
            size="xs"
            value={company}
            onChange={(event) => {
              setCompany(event.currentTarget.value);
              setPage(1);
            }}
            w={210}
            maw="100%"
          />
          <TextInput
            label="Job title filter"
            placeholder="Any job title"
            size="xs"
            value={jobTitle}
            onChange={(event) => {
              setJobTitle(event.currentTarget.value);
              setPage(1);
            }}
            w={210}
            maw="100%"
          />
          {(company || jobTitle || status || search) && (
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              mt="lg"
              onClick={() => {
                setCompany('');
                setJobTitle('');
                setStatus(null);
                setSearch('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </Group>
        {selected.length > 0 && (
          <Group px="lg" pb="md">
            <Badge variant="light">{selected.length} selected</Badge>
            <Button
              color="red"
              variant="subtle"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => setDeleting(true)}
            >
              Delete selected
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconX size={14} />}
              onClick={() => setSelected([])}
            >
              Clear selection
            </Button>
          </Group>
        )}
        <DataTable
          data={q.data?.data || []}
          columns={columns}
          total={q.data?.total || 0}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          sorting={sorting}
          onSortingChange={(value) => {
            setSorting(value);
            setPage(1);
          }}
          selectedIds={selected}
          onSelectionChange={setSelected}
          loading={q.isLoading}
          error={q.isError ? errorMessage(q.error) : undefined}
          emptyTitle={search || status ? 'No matching contacts' : 'Your connections belong here'}
          emptyDescription={
            search || status || company || jobTitle
              ? 'Try another search or clear your filters.'
              : 'Scan your first business card or add a contact to get started.'
          }
        />
      </div>
      <Modal
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? 'Edit contact' : 'Add a contact'}
        size="xl"
        centered
      >
        <ContactEditor
          key={editing?.id || 'new'}
          initialData={editing || undefined}
          onSave={save}
          onCancel={() => setEditing(undefined)}
        />
      </Modal>
      <Modal
        opened={deleting}
        onClose={() => setDeleting(false)}
        title="Delete selected contacts?"
        centered
      >
        <Text size="sm" c="dimmed">
          {selected.length} {selected.length === 1 ? 'contact' : 'contacts'} will be removed from
          this workspace. This action cannot be undone.
        </Text>
        {operationError && (
          <Alert color="red" mt="md">
            {operationError}
          </Alert>
        )}
        <Group justify="flex-end" mt="xl">
          <Button variant="default" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button color="red" loading={pending} onClick={() => void remove()}>
            Delete {selected.length === 1 ? 'contact' : 'contacts'}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
