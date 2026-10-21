'use client';

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Pagination,
  Skeleton,
  Stack,
  Table,
  Text,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowsSort,
  IconChevronDown,
  IconChevronUp,
  IconColumns3,
  IconInbox,
} from '@tabler/icons-react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';

export interface DataTableProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  error?: string;
  onPageChange: (page: number) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Server-driven table: filtering, sorting, and pagination belong to the API.
 * Row selection is controlled and retains selected IDs from other pages.
 */
export function DataTable<T extends { id: string }>({
  data,
  columns,
  total,
  page,
  pageSize,
  loading = false,
  error,
  onPageChange,
  sorting,
  onSortingChange,
  selectedIds,
  onSelectionChange,
  emptyTitle = 'Nothing here yet',
  emptyDescription = 'Your records will appear here when they are available.',
}: DataTableProps<T>) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const theme = useMantineTheme();
  const selectedSet = new Set(selectedIds);
  const currentIds = data.map((row) => row.id);
  const selectedOnPage = currentIds.filter((id) => selectedSet.has(id));
  const pageSelected = currentIds.length > 0 && selectedOnPage.length === currentIds.length;
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    state: { sorting, columnVisibility, pagination: { pageIndex: page - 1, pageSize } },
    onSortingChange: (updater) =>
      onSortingChange(typeof updater === 'function' ? updater(sorting) : updater),
    onColumnVisibilityChange: setColumnVisibility,
  });
  const visibleColumns = table.getVisibleLeafColumns();
  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds);
    currentIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onSelectionChange([...next]);
  };
  const toggleRow = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange([...next]);
  };

  return (
    <Stack gap="sm" aria-busy={loading}>
      <Group justify="space-between" gap="sm">
        <Text size="sm" c="dimmed" role="status" aria-live="polite">
          {selectedIds.length > 0
            ? `${selectedIds.length} selected`
            : `${total.toLocaleString()} records`}
        </Text>
        <Menu shadow="sm" position="bottom-end" closeOnItemClick={false}>
          <Menu.Target>
            <Button variant="default" size="xs" leftSection={<IconColumns3 size={15} />}>
              Columns
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Visible columns</Menu.Label>
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <Menu.Item
                  key={column.id}
                  onClick={() => column.toggleVisibility()}
                  role="menuitemcheckbox"
                  aria-checked={column.getIsVisible()}
                >
                  <Checkbox
                    checked={column.getIsVisible()}
                    onChange={() => column.toggleVisibility()}
                    label={
                      typeof column.columnDef.header === 'string'
                        ? column.columnDef.header
                        : column.id
                    }
                    style={{ pointerEvents: 'none' }}
                    tabIndex={-1}
                  />
                </Menu.Item>
              ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {error ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title="Could not load records"
          role="alert"
        >
          {error}
        </Alert>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table
            verticalSpacing="sm"
            horizontalSpacing="md"
            highlightOnHover
            withRowBorders
            aria-label="Records"
          >
            <Table.Thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <Table.Tr key={headerGroup.id}>
                  <Table.Th w={44}>
                    <Checkbox
                      aria-label="Select all records on this page"
                      checked={pageSelected}
                      indeterminate={selectedOnPage.length > 0 && !pageSelected}
                      disabled={loading || data.length === 0}
                      onChange={(event) => toggleAll(event.currentTarget.checked)}
                    />
                  </Table.Th>
                  {headerGroup.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      {!header.isPlaceholder &&
                        (header.column.getCanSort() ? (
                          <UnstyledButton
                            onClick={header.column.getToggleSortingHandler()}
                            disabled={loading}
                            style={{
                              fontWeight: 600,
                              fontSize: theme.fontSizes.sm,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 7,
                            }}
                            aria-label={`Sort by ${typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.column.id}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getIsSorted() === 'asc' ? (
                              <IconChevronUp size={14} />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <IconChevronDown size={14} />
                            ) : (
                              <IconArrowsSort size={14} style={{ opacity: 0.45 }} />
                            )}
                          </UnstyledButton>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        ))}
                    </Table.Th>
                  ))}
                </Table.Tr>
              ))}
            </Table.Thead>
            <Table.Tbody>
              {loading
                ? Array.from({ length: Math.min(pageSize, 5) }, (_, row) => (
                    <Table.Tr key={`loading-${row}`}>
                      <Table.Td>
                        <Skeleton height={18} width={18} />
                      </Table.Td>
                      {visibleColumns.map((column) => (
                        <Table.Td key={column.id}>
                          <Skeleton height={14} width="80%" />
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <Table.Tr
                      key={row.id}
                      data-selected={selectedSet.has(row.id) || undefined}
                      bg={
                        selectedSet.has(row.id) ? 'var(--mantine-primary-color-light)' : undefined
                      }
                    >
                      <Table.Td>
                        <Checkbox
                          aria-label={`Select record ${row.id}`}
                          checked={selectedSet.has(row.id)}
                          onChange={(event) => toggleRow(row.id, event.currentTarget.checked)}
                        />
                      </Table.Td>
                      {row.getVisibleCells().map((cell) => (
                        <Table.Td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
              {!loading && data.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={visibleColumns.length + 1}>
                    <Stack align="center" gap="xs" py={56}>
                      <Box c="dimmed">
                        <IconInbox size={34} stroke={1.4} />
                      </Box>
                      <Text fw={600}>{emptyTitle}</Text>
                      <Text size="sm" c="dimmed" ta="center" maw={380}>
                        {emptyDescription}
                      </Text>
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group justify="space-between" wrap="wrap" py="xs">
        <Text size="xs" c="dimmed">
          {total > 0
            ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()}`
            : 'No records'}
        </Text>
        <Pagination
          total={Math.max(1, Math.ceil(total / pageSize))}
          value={page}
          onChange={onPageChange}
          size="sm"
          withEdges
          disabled={loading}
          aria-label="Records pagination"
        />
      </Group>
    </Stack>
  );
}
