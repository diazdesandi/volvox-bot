import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuildSelection } from '@/hooks/use-guild-selection';
import {
  clearSelectedGuild,
  forceClearSelectedGuild,
  GUILD_SELECTED_EVENT,
  SELECTED_GUILD_KEY,
} from '@/lib/guild-selection';

describe('useGuildSelection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates the selected guild from localStorage', async () => {
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-1');

    const { result } = renderHook(() => useGuildSelection());

    await waitFor(() => {
      expect(result.current).toBe('guild-1');
    });
  });

  it('updates the selection and fires onGuildChange for custom events', async () => {
    const onGuildChange = vi.fn();
    const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

    act(() => {
      window.dispatchEvent(new CustomEvent(GUILD_SELECTED_EVENT, { detail: 'guild-2' }));
    });

    await waitFor(() => {
      expect(result.current).toBe('guild-2');
    });
    expect(onGuildChange).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate custom events for the currently selected guild', async () => {
    const onGuildChange = vi.fn();
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-2');

    const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

    await waitFor(() => {
      expect(result.current).toBe('guild-2');
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(GUILD_SELECTED_EVENT, { detail: 'guild-2' }));
    });

    await waitFor(() => {
      expect(result.current).toBe('guild-2');
    });
    expect(onGuildChange).not.toHaveBeenCalled();
  });

  it('updates the selection for storage events on the selected guild key', async () => {
    const onGuildChange = vi.fn();
    const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SELECTED_GUILD_KEY,
          newValue: 'guild-3',
        }),
      );
    });

    await waitFor(() => {
      expect(result.current).toBe('guild-3');
    });
    expect(onGuildChange).toHaveBeenCalledTimes(1);
  });

  it('clears the selected guild for empty custom events and null storage values', async () => {
    const onGuildChange = vi.fn();
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-1');
    const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

    await waitFor(() => {
      expect(result.current).toBe('guild-1');
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(GUILD_SELECTED_EVENT, { detail: '' }));
    });

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(onGuildChange).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent(GUILD_SELECTED_EVENT, { detail: 'guild-2' }));
    });

    await waitFor(() => {
      expect(result.current).toBe('guild-2');
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'other-key',
          newValue: 'guild-4',
        }),
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SELECTED_GUILD_KEY,
          newValue: null,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(onGuildChange).toHaveBeenCalledTimes(3);
  });


  it('force-clears selection even when cancelable clear events are guarded', async () => {
    const onGuildChange = vi.fn();
    const guard = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener(GUILD_SELECTED_EVENT, guard, true);
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-guarded');

    try {
      const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

      await waitFor(() => {
        expect(result.current).toBe('guild-guarded');
      });

      act(() => {
        clearSelectedGuild();
      });

      expect(result.current).toBe('guild-guarded');

      act(() => {
        forceClearSelectedGuild();
      });

      await waitFor(() => {
        expect(result.current).toBeNull();
      });
      expect(onGuildChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(GUILD_SELECTED_EVENT, guard, true);
    }
  });

  it('clears selected guild state for localStorage.clear storage events', async () => {
    const onGuildChange = vi.fn();
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-clear');
    const { result } = renderHook(() => useGuildSelection({ onGuildChange }));

    await waitFor(() => {
      expect(result.current).toBe('guild-clear');
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
          newValue: null,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(onGuildChange).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
          newValue: null,
        }),
      );
    });

    expect(onGuildChange).toHaveBeenCalledTimes(1);
  });

  it('survives localStorage access errors', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const { result } = renderHook(() => useGuildSelection());

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });
});
