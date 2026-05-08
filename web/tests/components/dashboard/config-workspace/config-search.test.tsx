import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSearch } from '@/components/dashboard/config-workspace/config-search';
import type { ConfigSearchItem } from '@/components/dashboard/config-workspace/types';

// Mock getCategoryById used in config-search to render category labels
vi.mock('@/components/dashboard/config-workspace/config-categories', () => ({
  getCategoryById: () => ({ label: 'Test Category' }),
}));

const MOCK_ITEM: ConfigSearchItem = {
  id: 'ai-chat',
  featureId: 'ai-chat',
  categoryId: 'ai-automation',
  label: 'AI Chat',
  description: 'Configure AI chat settings',
  keywords: ['ai', 'chat'],
  isAdvanced: false,
};

function renderSearch(props: Partial<Parameters<typeof ConfigSearch>[0]> = {}) {
  const defaults = {
    value: '',
    onChange: vi.fn(),
    results: [],
    onSelect: vi.fn(),
  };
  return render(<ConfigSearch {...defaults} {...props} />);
}

describe('ConfigSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the search input', () => {
    renderSearch();
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toBeInTheDocument();
  });

  it('does not show dropdown when value is empty', () => {
    renderSearch({ value: '', results: [MOCK_ITEM] });
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('opens dropdown on input focus when value is non-empty', async () => {
    const user = userEvent.setup();
    renderSearch({ value: 'ai', results: [MOCK_ITEM] });

    // isOpen is false initially — focus opens it
    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input); // triggers focus → setIsOpen(true)

    // Both conditions met: isOpen=true and normalizedValue.length > 0
    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
  });

  it('opens dropdown when controlled value changes from empty to non-empty', async () => {
    const user = userEvent.setup();

    function StatefulSearch() {
      const [value, setValue] = useState('');

      return (
        <ConfigSearch
          value={value}
          onChange={setValue}
          results={value ? [MOCK_ITEM] : []}
          onSelect={vi.fn()}
        />
      );
    }

    render(<StatefulSearch />);

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input);
    await user.type(input, 'ai');

    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Chat/i })).toBeVisible();
  });

  it('shows "No results found" when value is non-empty but results array is empty', async () => {
    const user = userEvent.setup();
    renderSearch({ value: 'xyz', results: [] });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input); // triggers focus → setIsOpen(true)

    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('shows result items when value is non-empty and results are present', async () => {
    const user = userEvent.setup();
    renderSearch({ value: 'ai', results: [MOCK_ITEM] });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input);

    expect(screen.getByText('AI Chat')).toBeInTheDocument();
    expect(screen.getByText('Configure AI chat settings')).toBeInTheDocument();
  });

  it('limits results to 8 items', async () => {
    const user = userEvent.setup();
    const manyResults: ConfigSearchItem[] = Array.from({ length: 12 }, (_, i) => ({
      ...MOCK_ITEM,
      id: `item-${i}`,
      label: `Item ${i}`,
    }));

    renderSearch({ value: 'item', results: manyResults });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(8);
  });

  it('calls onSelect and closes dropdown when a result is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSearch({ value: 'ai', results: [MOCK_ITEM], onSelect });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input);

    const resultButton = screen.getByText('AI Chat').closest('button');
    expect(resultButton).not.toBeNull();
    await user.click(resultButton!);

    expect(onSelect).toHaveBeenCalledWith(MOCK_ITEM);
    // Dropdown should close
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('clears value and closes dropdown when clear button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSearch({ value: 'ai', results: [MOCK_ITEM], onChange });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input); // open dropdown

    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
    // After clear, dropdown should close
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('closes dropdown when clicking outside the container', async () => {
    const user = userEvent.setup();
    renderSearch({ value: 'ai', results: [MOCK_ITEM] });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input); // open

    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();

    // Click outside the container
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('does not close dropdown when clicking inside the container', async () => {
    const user = userEvent.setup();
    renderSearch({ value: 'ai', results: [MOCK_ITEM] });

    const input = screen.getByRole('textbox', { name: 'Search settings' });
    await user.click(input); // open

    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();

    // Click inside (on the input itself)
    fireEvent.mouseDown(input);

    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
  });

  it('does not show clear button when value is empty', () => {
    renderSearch({ value: '' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('shows clear button when value is non-empty', () => {
    renderSearch({ value: 'hello' });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });
});