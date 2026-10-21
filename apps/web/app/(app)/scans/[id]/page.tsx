import { ScanReviewPage } from '../../../../features/scan-review';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScanReviewPage id={id} />;
}
