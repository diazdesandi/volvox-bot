import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleDirectoryProvider } from '@/components/layout/role-directory-context';
import { RoleSelector } from '@/components/ui/role-selector';

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

const MOCK_ROLES = [
  { id: 'role-1', name: 'Admin', color: 15_292_223 },
  { id: 'role-2', name: 'Moderator', color: 3_443_003 },
  { id: 'role-3', name: 'Member', color: 0 },
];

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/dashboard/moderation');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the shared role cache for duplicate selectors in the same guild', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_ROLES,
    } as Response);

    render(
      <RoleDirectoryProvider>
        <RoleSelector guildId="guild-1" selected={['role-1']} onChange={vi.fn()} />
        <RoleSelector guildId="guild-1" selected={['role-2']} onChange={vi.fn()} />
      </RoleDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Moderator')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('with maxSelections=1, replaces the current selection instead of adding', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_ROLES,
    } as Response);

    render(
      <RoleDirectoryProvider>
        <RoleSelector
          guildId="guild-1"
          selected={['role-1']}
          onChange={onChange}
          maxSelections={1}
        />
      </RoleDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('1 role selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    const moderatorItem = await screen.findByRole('option', { name: /Moderator/i });
    await user.click(moderatorItem);

    expect(onChange).toHaveBeenCalledWith(['role-2']);
  });

  it('with maxSelections=1, does not disable unselected roles even when one is selected', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_ROLES,
    } as Response);

    render(
      <RoleDirectoryProvider>
        <RoleSelector
          guildId="guild-1"
          selected={['role-1']}
          onChange={vi.fn()}
          maxSelections={1}
        />
      </RoleDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('1 role selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    // Moderator role should be enabled (not disabled) even though max=1 and role-1 is selected
    const moderatorItem = await screen.findByRole('option', { name: /Moderator/i });
    expect(moderatorItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('with maxSelections=1, deselects a selected role on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_ROLES,
    } as Response);

    render(
      <RoleDirectoryProvider>
        <RoleSelector
          guildId="guild-1"
          selected={['role-1']}
          onChange={onChange}
          maxSelections={1}
        />
      </RoleDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('1 role selected')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('combobox'));

    // Click the already-selected role to deselect it
    const adminItem = await screen.findByRole('option', { name: /Admin/i });
    await user.click(adminItem);

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
