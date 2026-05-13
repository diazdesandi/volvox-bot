import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetBotInviteUrl, mockUseInView, mockUseReducedMotion } = vi.hoisted(() => ({
  mockGetBotInviteUrl: vi.fn(),
  mockUseInView: vi.fn(),
  mockUseReducedMotion: vi.fn(),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const createComponent = (tag: string) =>
    React.forwardRef(
      (
        {
          animate: _animate,
          initial: _initial,
          layout: _layout,
          transition: _transition,
          viewport: _viewport,
          whileHover: _whileHover,
          whileInView: _whileInView,
          ...props
        }: any,
        ref: any,
      ) => React.createElement(tag, { ...props, ref }, props.children),
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
    useInView: (...args: unknown[]) => mockUseInView(...args),
    useScroll: () => ({ scrollY: 0, scrollYProgress: 0 }),
    useSpring: (value: unknown) => value,
    useTransform: (_value: unknown, _input: unknown, output: unknown[]) => output[0],
    useReducedMotion: () => mockUseReducedMotion(),
  };
});

vi.mock('@/lib/discord', () => ({
  getBotInviteUrl: () => mockGetBotInviteUrl(),
}));

import { Pricing } from '@/components/landing/Pricing';

const inviteUrl = 'https://discord.com/api/oauth2/authorize?client_id=test&scope=bot';

describe('Pricing', () => {
  beforeEach(() => {
    mockUseInView.mockReturnValue(true);
    mockUseReducedMotion.mockReturnValue(false);
    mockGetBotInviteUrl.mockReturnValue(inviteUrl);
  });

  it('should render 2 tiers with monthly pricing by default', () => {
    render(<Pricing />);
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Overclocked')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('$14.99')).toBeInTheDocument();
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
    expect(screen.queryByText('Contact Sales')).not.toBeInTheDocument();
  });

  it('should switch to annual billing', async () => {
    const user = userEvent.setup();
    render(<Pricing />);
    await user.click(screen.getByRole('button', { name: /toggle annual billing/i }));
    expect(screen.getByText('$115')).toBeInTheDocument();
  });

  it('should render the system access tiers label', () => {
    render(<Pricing />);
    expect(screen.getByText('SYSTEM ACCESS TIERS')).toBeInTheDocument();
  });

  it('should link both tier actions to the direct bot invite URL', () => {
    render(<Pricing />);
    const links = screen.getAllByRole('link', { name: /INITIALIZE|DEPLOY/i });
    expect(links).toHaveLength(2);

    for (const link of links) {
      expect(link).toHaveAttribute('href', inviteUrl);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('should disable both tier actions when no invite URL is configured', () => {
    mockGetBotInviteUrl.mockReturnValue(null);
    render(<Pricing />);

    expect(screen.queryAllByRole('link', { name: /INITIALIZE|DEPLOY/i })).toHaveLength(0);
    const buttons = screen.getAllByRole('button', { name: /INITIALIZE|DEPLOY/i });
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});
