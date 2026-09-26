import type { Metadata } from 'next';
import { HealView } from '@/components/heal/HealView';

export const metadata: Metadata = { title: 'Self-healing' };

export default function HealingPage() {
  return <HealView />;
}
