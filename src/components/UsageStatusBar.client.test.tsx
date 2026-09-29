import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageState } from '../store/types';
import { UsageStatusBar } from './UsageStatusBar';

const { mockRefreshUsage, usage } = vi.hoisted(() => {
  const idle: UsageState = {
    groups: [],
    fetchedAt: null,
    status: 'idle',
    error: null,
  };
  const inAnHour = Date.now() + 3_600_000;
  return {
    mockRefreshUsage: vi.fn(),
    usage: {
      claude: {
        groups: [
          {
            id: 'claude',
            label: 'Claude',
            fiveHour: { usedPercent: 40, resetsAt: inAnHour },
            sevenDay: { usedPercent: 10, resetsAt: inAnHour },
          },
        ],
        fetchedAt: Date.now(),
        status: 'ok',
        error: null,
      } satisfies UsageState,
      codex: { ...idle },
      antigravity: {
        groups: [
          {
            id: 'gemini',
            label: 'Gemini Models',
            fiveHour: { usedPercent: 25, resetsAt: inAnHour },
            sevenDay: { usedPercent: 30, resetsAt: inAnHour },
          },
          {
            id: 'third-party',
            label: 'Claude and GPT Models',
            fiveHour: { usedPercent: 50, resetsAt: inAnHour },
            sevenDay: { usedPercent: 55, resetsAt: inAnHour },
          },
        ],
        fetchedAt: Date.now(),
        status: 'ok',
        error: null,
      } satisfies UsageState,
    },
  };
});

vi.mock('../store/store', () => ({
  store: { usage },
  refreshUsage: mockRefreshUsage,
  USAGE_PROVIDERS: ['claude', 'codex', 'antigravity'],
}));

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  mockRefreshUsage.mockClear();
});

function mount(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(() => <UsageStatusBar />, container));
  return container;
}

const popover = () => document.querySelector<HTMLElement>('[data-testid="usage-popover"]');

describe('UsageStatusBar', () => {
  it('shows one headline for Claude and two compact Antigravity group headlines', () => {
    const container = mount();
    const entries = container.querySelectorAll('[role="status"]');
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain('Claude');
    expect(entries[0].textContent).toContain('60% left');
    expect(entries[0].textContent).not.toContain('7d');
    expect(entries[1].textContent).toContain('Antigravity');
    expect(entries[1].textContent).toContain('G 5h');
    expect(entries[1].textContent).toContain('3P 5h');
    expect(entries[1].textContent).not.toContain('Gemini Models');
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
  });

  it('fills the meter with what is left, not what is used', () => {
    const container = mount();
    const meter = container.querySelector<HTMLElement>('[role="progressbar"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('60');
    expect(meter?.firstElementChild).toHaveProperty('style.width', '60%');
  });

  it('opens a popover with both windows and the refresh time on hover', () => {
    const container = mount();
    const entry = container.querySelectorAll<HTMLElement>('[role="status"]')[0];
    if (!entry) throw new Error('no provider entry');
    expect(popover()).toBeNull();

    entry.dispatchEvent(new MouseEvent('mouseenter'));
    const card = popover();
    expect(card?.textContent).toContain('5h');
    expect(card?.textContent).toContain('7d');
    expect(card?.textContent).toContain('90% left');
    expect(card?.textContent).toContain('Updated');
    expect(card?.style.pointerEvents).toBe('none');

    entry.dispatchEvent(new MouseEvent('mouseleave'));
    expect(popover()).toBeNull();
  });

  it('refreshes just the clicked provider', () => {
    const container = mount();
    container.querySelectorAll<HTMLElement>('[role="status"]')[1]?.click();
    expect(mockRefreshUsage).toHaveBeenCalledWith('antigravity', { force: true });
  });

  it('shows full Antigravity group names and both windows in the popover', () => {
    const container = mount();
    const entry = container.querySelectorAll<HTMLElement>('[role="status"]')[1];
    entry.dispatchEvent(new MouseEvent('mouseenter'));
    const card = popover();
    expect(card?.textContent).toContain('Gemini Models');
    expect(card?.textContent).toContain('Claude and GPT Models');
    expect(card?.textContent).toContain('5h');
    expect(card?.textContent).toContain('7d');
  });
});
