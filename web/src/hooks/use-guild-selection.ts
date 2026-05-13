import { useEffect, useRef, useState } from 'react';
import {
  GUILD_SELECTED_EVENT,
  GUILD_SELECTION_CLEARED_EVENT,
  SELECTED_GUILD_KEY,
} from '@/lib/guild-selection';

interface UseGuildSelectionOptions {
  onGuildChange?: () => void;
}

/**
 * Shared hook that listens for guild selection via localStorage and custom events.
 * Returns the currently selected guild ID.
 */
export function useGuildSelection(options?: UseGuildSelectionOptions): string | null {
  const [guildId, setGuildId] = useState<string | null>(null);
  const onGuildChangeRef = useRef(options?.onGuildChange);

  useEffect(() => {
    onGuildChangeRef.current = options?.onGuildChange;
  }, [options?.onGuildChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const saved = window.localStorage.getItem(SELECTED_GUILD_KEY);
      if (saved) setGuildId(saved);
    } catch {
      // localStorage may be unavailable
    }

    const applyGuildSelection = (nextGuildId: string | null) => {
      setGuildId((currentGuildId) => {
        if (currentGuildId === nextGuildId) {
          return currentGuildId;
        }
        onGuildChangeRef.current?.();
        return nextGuildId;
      });
    };

    const handleGuildSelect = (event: Event) => {
      if (event.defaultPrevented) return;
      const selected = (event as CustomEvent<string>).detail;
      applyGuildSelection(selected || null);
    };

    const handleGuildSelectionCleared = () => {
      applyGuildSelection(null);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SELECTED_GUILD_KEY && event.key !== null) return;
      applyGuildSelection(event.newValue || null);
    };

    window.addEventListener(GUILD_SELECTED_EVENT, handleGuildSelect as EventListener);
    window.addEventListener(GUILD_SELECTION_CLEARED_EVENT, handleGuildSelectionCleared);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(GUILD_SELECTED_EVENT, handleGuildSelect as EventListener);
      window.removeEventListener(GUILD_SELECTION_CLEARED_EVENT, handleGuildSelectionCleared);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return guildId;
}
