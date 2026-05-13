import type { Metadata } from 'next';
import { DashboardHome } from '@/components/dashboard/dashboard-home';
import { createPageMetadata } from '@/lib/page-titles';

export const metadata: Metadata = createPageMetadata(
  'Overview',
  'Monitor bot analytics and dashboard health at a glance.',
);

export default function DashboardPage() {
  return <DashboardHome />;
}
