import type { Metadata } from 'next';
import { ConnectedWelcomeServerPicker } from '@/components/dashboard/welcome-server-picker';
import { createPageMetadata } from '@/lib/page-titles';

export const metadata: Metadata = createPageMetadata(
  'Server Picker',
  'Choose a Discord server to manage or invite Volvox.Bot into.',
);

export default function DashboardWelcomePage() {
  return <ConnectedWelcomeServerPicker />;
}
