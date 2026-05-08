import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  JetBrains_Mono: () => ({ variable: 'font-mono' }),
  Manrope: () => ({ variable: 'font-sans' }),
}));

vi.mock('@/components/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => children,
}));

import RootLayout from '@/app/layout';

describe('RootLayout', () => {
  it('renders a dark document shell before theme hydration', () => {
    const layout = RootLayout({ children: <main>content</main> });

    expect(layout.props.className).toBe('dark');
    expect(layout.props.style).toEqual({
      backgroundColor: '#10110e',
      colorScheme: 'dark',
    });
  });
});
