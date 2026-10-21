import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getAuth } from '@fileforge/database';
import { WorkspaceShell } from '../../components/workspace-shell';
export const dynamic = 'force-dynamic';
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const incoming = await headers();
  if (!incoming.get('cookie')) redirect('/login');
  let session;
  try {
    session = await getAuth().api.getSession({ headers: incoming });
  } catch {
    return (
      <main style={{ maxWidth: 600, margin: '100px auto', padding: 24 }}>
        <h1>Workspace unavailable</h1>
        <p>
          The authentication service could not be reached. Check your database connection and server
          configuration, then reload.
        </p>
        <a href="/">Back to FileForge AI</a>
      </main>
    );
  }
  if (!session) redirect('/login');
  return (
    <WorkspaceShell user={{ name: session.user.name, email: session.user.email }}>
      {children}
    </WorkspaceShell>
  );
}
