import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { ResourcePage } from './resources';
const fixture = vi.hoisted(() => ({
  records: [] as { id: string; originalName: string; status?: string; createdAt: string }[],
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { data: fixture.records, total: fixture.records.length, page: 1, pageSize: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('../stores/workspace', () => ({
  useWorkspace: (select: (state: { id: string }) => string) => select({ id: 'workspace' }),
}));
vi.mock('../lib/api', () => ({
  api: vi.fn(),
  errorMessage: () => 'Request failed',
  formatDate: () => 'Jan 1, 2026',
}));
beforeEach(() => {
  fixture.records = [];
});
function fileRow(status?: string) {
  fixture.records = [
    {
      id: 'file-one',
      originalName: 'business-card.png',
      status,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const html = renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(ResourcePage, { kind: 'files' })),
  );
  const row = html
    .match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)
    ?.find((value) => value.includes('business-card.png'));
  expect(row).toBeDefined();
  return row!;
}
describe('Files table download readiness', () => {
  it.each([
    ['pending', 'Upload incomplete'],
    ['validating', 'Checking upload'],
    ['rejected', 'Upload rejected'],
    ['failed', 'Upload failed'],
    ['expired', 'Upload expired'],
    ['unexpected-state', 'Unavailable'],
    [undefined, 'Unavailable'],
  ])('does not offer a download for an unverified or unavailable file (%s)', (status, label) => {
    const row = fileRow(status);
    expect(row).toContain(label);
    expect(row).toMatch(/<button\b[^>]*\bdisabled=""/);
    expect(row).toContain('aria-describedby="file-availability-file-one"');
  });
  it('offers download only when the API reports the image uploaded and verified', () => {
    const row = fileRow('uploaded');
    expect(row).toContain('Uploaded');
    expect(row).toContain('Download');
    expect(row).not.toMatch(/<button\b[^>]*\bdisabled/);
  });
});
