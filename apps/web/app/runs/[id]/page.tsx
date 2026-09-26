import { RunView } from '@/components/run/RunView';

export default function RunPage({ params }: { params: { id: string } }) {
  return <RunView id={decodeURIComponent(params.id)} />;
}
