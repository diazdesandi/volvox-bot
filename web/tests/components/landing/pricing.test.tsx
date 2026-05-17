import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInviteBot, mockUseBotInvite, mockUseInView, mockUseReducedMotion } = vi.hoisted(() => ({
  mockInviteBot: vi.fn(),
  mockUseBotInvite: vi.fn(),
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

vi.mock('@/hooks/use-bot-invite', () => ({
  useBotInvite: mockUseBotInvite,
}));

import { Pricing } from '@/components/landing/Pricing';

describe('Pricing', () => {
  beforeEach(() => {
    mockInviteBot.mockReset();
    mockUseInView.mockReturnValue(true);
    mockUseReducedMotion.mockReturnValue(false);
    mockUseBotInvite.mockReset();
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: true,
    });
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

  it('should start the dashboard-returning invite flow from both tier actions', async () => {
    const user = userEvent.setup();
    render(<Pricing />);
    const buttons = screen.getAllByRole('button', { name: /INITIALIZE|DEPLOY/i });
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      await user.click(button);
    }

    expect(mockInviteBot).toHaveBeenCalledTimes(2);
  });

  it('should disable both tier actions when no invite URL is configured', () => {
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: false,
    });
    render(<Pricing />);

    expect(screen.queryAllByRole('link', { name: /INITIALIZE|DEPLOY/i })).toHaveLength(0);
    const buttons = screen.getAllByRole('button', { name: /INITIALIZE|DEPLOY/i });
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});
