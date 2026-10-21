'use client';
import { Badge, Group, Pagination, ScrollArea, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage, formatDate } from '../lib/api';
import { useWorkspace } from '../stores/workspace';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/page-parts';
interface Usage {
  data: {
    id: string;
    type: string;
    quantity: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: string | null;
    createdAt: string;
  }[];
  total: number;
  summary: {
    quantity: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCost: string | null;
  };
}
export function UsagePage() {
  const workspace = useWorkspace((s) => s.id);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['usage', workspace, page],
    queryFn: () => api<Usage>(`/usage?page=${page}&pageSize=20`),
  });
  return (
    <>
      <PageHeader
        title="Usage overview"
        description="Understand the processing activity in your workspace."
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              { title: 'Processing operations', value: q.data?.summary.quantity },
              { title: 'Input tokens', value: q.data?.summary.inputTokens },
              { title: 'Output tokens', value: q.data?.summary.outputTokens },
              {
                title: 'Estimated AI cost',
                value: q.data?.summary.estimatedCost
                  ? `$${Number(q.data.summary.estimatedCost).toFixed(4)}`
                  : 'Unavailable',
              },
            ].map((s) => (
              <div className="ff-panel" key={s.title}>
                <Text size="xs" c="dimmed">
                  {s.title}
                </Text>
                <div
                  className="stat-value"
                  style={{ fontSize: typeof s.value === 'string' ? 23 : 31 }}
                >
                  {q.isLoading ? '—' : (s.value ?? 0)}
                </div>
                <Text size="10px" c="dimmed">
                  All time
                </Text>
              </div>
            ))}
          </div>
          <div className="ff-panel" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
            <Group p="lg" justify="space-between">
              <Text fw={600} size="sm">
                Processing activity
              </Text>
              <Badge variant="light" color="gray">
                Workspace usage
              </Badge>
            </Group>
            {q.isLoading ? (
              <LoadingState />
            ) : !q.data?.data.length ? (
              <EmptyState
                title="Nothing used yet"
                description="Usage records will appear when a background processing job uses your configured AI provider."
              />
            ) : (
              <>
                <ScrollArea>
                  <Table verticalSpacing="md" horizontalSpacing="lg" miw={600}>
                    <Table.Thead>
                      <Table.Tr>
                        {['Operation', 'Quantity', 'Input tokens', 'Output tokens', 'Created'].map(
                          (t) => (
                            <Table.Th key={t}>{t}</Table.Th>
                          ),
                        )}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {q.data.data.map((r) => (
                        <Table.Tr key={r.id}>
                          <Table.Td>
                            <Text size="xs">{r.type}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{r.quantity}</Text>
                          </Table.Td>
                          <Table.Td>{r.inputTokens}</Table.Td>
                          <Table.Td>{r.outputTokens}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {formatDate(r.createdAt)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                <Group justify="flex-end" p="lg">
                  <Pagination
                    total={Math.ceil(q.data.total / 20)}
                    value={page}
                    onChange={setPage}
                    size="sm"
                  />
                </Group>
              </>
            )}
          </div>
          <Text size="xs" c="dimmed" mt={18}>
            Cost estimates require an explicitly configured model price. Your provider’s billing
            remains authoritative.
          </Text>
        </>
      )}
    </>
  );
}
