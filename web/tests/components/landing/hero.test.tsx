import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInviteBot, mockUseBotInvite } = vi.hoisted(() => ({
  mockInviteBot: vi.fn(),
  mockUseBotInvite: vi.fn(),
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

vi.mock('@/hooks/use-bot-invite', () => ({
  useBotInvite: mockUseBotInvite,
}));

import { Hero } from '@/components/landing/Hero';

describe('Hero', () => {
  beforeEach(() => {
    mockInviteBot.mockReset();
    mockUseBotInvite.mockReset();
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: true,
    });
  });

  it('renders the VOLVOX hero brand', () => {
    render(<Hero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('VOLVOX');
    expect(screen.getByText('BOT')).toBeInTheDocument();
  });

  it('starts the dashboard-returning invite flow when Add to Server is clicked', async () => {
    const user = userEvent.setup();
    render(<Hero />);

    await user.click(screen.getByRole('button', { name: /Add to Server/i }));

    expect(mockInviteBot).toHaveBeenCalledOnce();
  });

  it('hides the invite CTA when no invite URL is configured', () => {
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: false,
    });
    render(<Hero />);

    expect(screen.queryByRole('button', { name: /Add to Server/i })).not.toBeInTheDocument();
  });
});
