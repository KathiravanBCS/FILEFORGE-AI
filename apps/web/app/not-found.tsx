import Link from 'next/link';
import { Logo } from '../components/logo';
export default function NotFound() {
  return (
    <main style={{ maxWidth: 580, margin: '100px auto', padding: 24, lineHeight: 1.8 }}>
      <Logo />
      <h1>We couldn’t find that page.</h1>
      <p>The page may have moved, or this link may be incomplete.</p>
      <Link href="/dashboard">Return to your workspace</Link>
    </main>
  );
}
