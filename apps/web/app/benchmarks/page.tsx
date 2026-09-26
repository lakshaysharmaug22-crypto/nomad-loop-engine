import type { Metadata } from 'next';
import { BenchView } from '@/components/bench/BenchView';

export const metadata: Metadata = { title: 'Benchmarks' };

export default function BenchmarksPage() {
  return <BenchView />;
}
