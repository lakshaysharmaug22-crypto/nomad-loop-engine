import { BugView } from '@/components/bug/BugView';

export default function BugPage({ params }: { params: { id: string; bugId: string } }) {
  return <BugView runId={decodeURIComponent(params.id)} bugId={decodeURIComponent(params.bugId)} />;
}
