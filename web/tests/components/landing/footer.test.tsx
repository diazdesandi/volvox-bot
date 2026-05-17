import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInviteBot, mockOpenCookiePreferences, mockUseBotInvite } = vi.hoisted(() => ({
  mockInviteBot: vi.fn(),
  mockOpenCookiePreferences: vi.fn(),
  mockUseBotInvite: vi.fn(),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const createComponent = (tag: string) =>
    React.forwardRef(({ animate: _animate, initial: _initial, transition: _transition, whileHover: _whileHover, whileInView: _whileInView, whileTap: _whileTap, viewport: _viewport, ...props }: any, ref: any) =>
      React.createElement(tag, { ...props, ref }, props.children)
    );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: createComponent('div'),
      h1: createComponent('h1'),
      h2: createComponent('h2'),
      li: createComponent('li'),
      p: createComponent('p'),
      span: createComponent('span'),
      section: createComponent('section'),
    },
    useInView: () => true,
    useScroll: () => ({ scrollY: 0, scrollYProgress: 0 }),
    useSpring: (value: unknown) => value,
    useTransform: (_value: unknown, _input: unknown, output: unknown[]) => output[0],
    useReducedMotion: () => false,
  };
});

// Mock GSAP — Footer uses useGSAP/ScrollTrigger
vi.mock('gsap', () => ({
  gsap: { registerPlugin: vi.fn(), fromTo: vi.fn(), to: vi.fn() },
  default: { registerPlugin: vi.fn(), fromTo: vi.fn(), to: vi.fn() },
}));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }));

vi.mock('@/hooks/use-bot-invite', () => ({
  useBotInvite: mockUseBotInvite,
}));

vi.mock('@/lib/cookie-consent', () => ({
  openCookiePreferences: mockOpenCookiePreferences,
}));

// next/image mock
vi.mock('next/image', () => ({
  default: ({ alt, fill: _fill, ...props }: any) => <img alt={alt} {...props} />,
}));

import { Footer } from '@/components/landing/Footer';

describe('Footer', () => {
  beforeEach(() => {
    mockInviteBot.mockReset();
    mockUseBotInvite.mockReset();
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: true,
    });
    mockOpenCookiePreferences.mockClear();
  });

  it('should render the main CTA heading', () => {
    render(<Footer />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('should start the dashboard-returning invite flow when available', async () => {
    const user = userEvent.setup();
    render(<Footer />);

    await user.click(screen.getByRole('button', { name: /Initialize Bot/i }));

    expect(mockInviteBot).toHaveBeenCalledOnce();
  });

  it('should render locked state when no invite URL', () => {
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: false,
    });
    render(<Footer />);
    expect(screen.getByText('[Locked]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Initialize Bot/i })).not.toBeInTheDocument();
  });

  it('should render footer navigation links', () => {
    render(<Footer />);
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Support Node')).toBeInTheDocument();
  });

  it('should render the brand tagline and logo', () => {
    render(<Footer />);
    expect(screen.getByText(/synthesis of artificial intelligence/i)).toBeInTheDocument();
    expect(screen.getByAltText('Volvox.Bot')).toBeInTheDocument();
  });

  it('should reopen cookie preferences from the legal links', async () => {
    const user = userEvent.setup();

    render(<Footer />);

    const cookiePreferencesButton = screen.getByRole('button', { name: /cookie preferences/i });

    expect(cookiePreferencesButton).toHaveClass('text-[14px]', 'text-foreground/60');
    expect(cookiePreferencesButton.querySelector('svg')).toBeInTheDocument();

    await user.click(cookiePreferencesButton);

    expect(mockOpenCookiePreferences).toHaveBeenCalledOnce();
  });
});
