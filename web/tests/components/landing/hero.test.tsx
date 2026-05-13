import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetBotInviteUrl } = vi.hoisted(() => ({
  mockGetBotInviteUrl: vi.fn(),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const createComponent = (tag: string) =>
    React.forwardRef(({ animate: _animate, initial: _initial, transition: _transition, whileHover: _whileHover, whileInView: _whileInView, viewport: _viewport, ...props }: any, ref: any) =>
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

vi.mock('gsap', () => ({
  gsap: {
    registerPlugin: vi.fn(),
    timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis() })),
    to: vi.fn(),
  },
  default: {
    registerPlugin: vi.fn(),
    timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis() })),
    to: vi.fn(),
  },
}));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }));

vi.mock('@/lib/discord', () => ({
  getBotInviteUrl: () => mockGetBotInviteUrl(),
}));

import { Hero } from '@/components/landing/Hero';

const inviteUrl = 'https://discord.com/api/oauth2/authorize?client_id=test&scope=bot';

describe('Hero', () => {
  beforeEach(() => {
    mockGetBotInviteUrl.mockReturnValue(inviteUrl);
  });

  it('renders the VOLVOX hero brand', () => {
    render(<Hero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('VOLVOX');
    expect(screen.getByText('BOT')).toBeInTheDocument();
  });

  it('renders a direct invite link when URL is configured', () => {
    render(<Hero />);

    const link = screen.getByRole('link', { name: /Add to Server/i });
    expect(link).toHaveAttribute('href', inviteUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides the invite CTA when no invite URL is configured', () => {
    mockGetBotInviteUrl.mockReturnValue(null);
    render(<Hero />);

    expect(screen.queryByRole('link', { name: /Add to Server/i })).not.toBeInTheDocument();
  });
});
