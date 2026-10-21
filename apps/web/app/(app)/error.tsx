'use client';
import { ErrorState } from '../../components/page-parts';
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      message="This workspace view could not be loaded. Try again, or check the service connection."
      retry={reset}
    />
  );
}
