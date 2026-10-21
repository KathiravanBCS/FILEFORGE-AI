'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTheme, MantineProvider, useMantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppearance } from '../stores/appearance';
function SchemeSync() {
  const preferences = useAppearance((s) => s.preferences);
  const hydrated = useAppearance((s) => s.hydrated);
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    if (hydrated) {
      setColorScheme(preferences.colorScheme);
      document.documentElement.dataset.density = preferences.density;
      document.documentElement.dataset.reducedMotion = String(preferences.reducedMotion);
    }
  }, [preferences, hydrated, setColorScheme]);
  return null;
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
      }),
  );
  const saved = useAppearance((s) => s.preferences);
  const hydrated = useAppearance((s) => s.hydrated);
  const preferences = hydrated ? saved : undefined;
  const theme = useMemo(
    () =>
      createTheme({
        primaryColor: preferences?.primaryColor || 'blue',
        defaultRadius: preferences?.radius || 'md',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        headings: { fontFamily: 'inherit', fontWeight: '650' },
        defaultGradient: { from: 'blue', to: 'cyan' },
        components: {
          Button: { defaultProps: { size: preferences?.density === 'compact' ? 'xs' : 'sm' } },
          TextInput: { defaultProps: { size: preferences?.density === 'compact' ? 'xs' : 'sm' } },
          Select: { defaultProps: { size: preferences?.density === 'compact' ? 'xs' : 'sm' } },
        },
      }),
    [preferences],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <SchemeSync />
        <Notifications position="top-right" />
        {children}
      </MantineProvider>
    </QueryClientProvider>
  );
}
