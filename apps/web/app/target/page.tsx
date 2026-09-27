import type { Metadata } from 'next';
import { TargetView } from '@/components/target/TargetView';

export const metadata: Metadata = { title: 'Live target' };

export default function TargetPage() {
  return <TargetView />;
}
