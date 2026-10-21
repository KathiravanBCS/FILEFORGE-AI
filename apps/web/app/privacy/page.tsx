import Link from 'next/link';
import { Logo } from '../../components/logo';
export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: '60px auto', padding: 24, lineHeight: 1.8 }}>
      <Logo />
      <h1>Privacy Policy</h1>
      <p>
        <strong>Draft — requires legal review before production use.</strong>
      </p>
      <p>
        This page is a legal placeholder and does not constitute a finalized policy or agreement.
        The service owner must replace it with reviewed terms covering data processing, retention,
        subprocessors, user rights, and applicable jurisdictions.
      </p>
      <p>
        FileForge AI processes uploaded business card images through configured cloud providers.
        Contact and file records are associated with authenticated workspaces.
      </p>
      <p>Contact the service owner for privacy, account deletion, and legal requests.</p>
      <Link href="/">Return to FileForge AI</Link>
    </main>
  );
}
