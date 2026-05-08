import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelDirectoryProvider } from '@/components/layout/channel-directory-context';
import { ChannelSelector } from '@/components/ui/channel-selector';

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

const TEXT_CHANNELS = [
  { id: 'ch-1', name: 'general', type: 0 },
  { id: 'ch-2', name: 'announcements', type: 5 },
  { id: 'ch-3', name: 'off-topic', type: 0 },
];

describe('ChannelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/dashboard/settings');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with placeholder when no channels selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXT_CHANNELS,
    } as Response);

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector guildId="guild-1" selected={[]} onChange={vi.fn()} />
      </ChannelDirectoryProvider>,
    );

    expect(screen.getByText('Select channels...')).toBeInTheDocument();
  });

  it('with maxSelections=1, replaces the selected channel instead of appending', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXT_CHANNELS,
    } as Response);

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector
          guildId="guild-1"
          selected={['ch-1']}
          onChange={onChange}
          maxSelections={1}
        />
      </ChannelDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('1 channel selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    const offTopicItem = await screen.findByRole('option', { name: /off-topic/i });
    await user.click(offTopicItem);

    expect(onChange).toHaveBeenCalledWith(['ch-3']);
  });

  it('with maxSelections=1, does not disable other channels when max is reached', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXT_CHANNELS,
    } as Response);

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector
          guildId="guild-1"
          selected={['ch-1']}
          onChange={vi.fn()}
          maxSelections={1}
        />
      </ChannelDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('1 channel selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    // off-topic (ch-3) should NOT be disabled even though max=1 and ch-1 is selected
    const offTopicItem = await screen.findByRole('option', { name: /off-topic/i });
    expect(offTopicItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('with maxSelections>1, disables additional items when max is reached', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXT_CHANNELS,
    } as Response);

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector
          guildId="guild-1"
          selected={['ch-1', 'ch-3']}
          onChange={vi.fn()}
          maxSelections={2}
        />
      </ChannelDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('2 channels selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    // announcements (ch-2) is NOT selected and max is reached — it should be disabled
    const announcementsItem = await screen.findByRole('option', { name: /announcements/i });
    expect(announcementsItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('deselects a channel when clicking an already-selected one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXT_CHANNELS,
    } as Response);

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector
          guildId="guild-1"
          selected={['ch-1', 'ch-3']}
          onChange={onChange}
          maxSelections={2}
        />
      </ChannelDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('2 channels selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    const generalItem = await screen.findByRole('option', { name: /general/i });
    await user.click(generalItem);

    expect(onChange).toHaveBeenCalledWith(['ch-3']);
  });

  it('uses provided external channels without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const externalChannels = [
      { id: 'ext-1', name: 'preview', type: 0 },
      { id: 'ext-2', name: 'demo', type: 0 },
    ];

    render(
      <ChannelDirectoryProvider>
        <ChannelSelector
          guildId="guild-1"
          selected={[]}
          onChange={vi.fn()}
          channels={externalChannels}
        />
      </ChannelDirectoryProvider>,
    );

    // Open the popover to trigger channel load
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /preview/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /demo/i })).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});