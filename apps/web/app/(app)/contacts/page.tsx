import { Suspense } from 'react';
import { ContactsPage } from '../../../features/contacts';
export default function Page() {
  return (
    <Suspense fallback={<p>Loading contacts…</p>}>
      <ContactsPage />
    </Suspense>
  );
}
