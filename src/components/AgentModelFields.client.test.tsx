import { render } from 'solid-js/web';
import { createSignal, untrack } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '../../electron/ipc/channels';
import type { AgentModelChoice } from '../../electron/shared/agent-models';
import { AgentModelFields } from './AgentModelFields';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../lib/ipc', () => ({ invoke: mocks.invoke }));

const antigravityModels: AgentModelChoice[] = [
  {
    slug: 'gemini-3.8-flash-high',
    displayName: 'Gemini 3.8 Flash',
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'high' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'low' },
    ],
    modelByReasoningEffort: {
      high: 'gemini-3.8-flash-high',
      medium: 'gemini-3.8-flash-medium',
      low: 'gemini-3.8-flash-low',
    },
  },
];

let host: HTMLDivElement;
let dispose: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(antigravityModels);
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  dispose?.();
  host.remove();
});

it('uses a canonical provider for a custom local agent and maps effort to its launch slug', async () => {
  const [selection, setSelection] = createSignal({});
  dispose = render(
    () => (
      <AgentModelFields
        agentDef={{
          id: 'custom-local-antigravity',
          name: 'Antigravity Local',
          command: '/Users/me/bin/agy',
          args: [],
          resume_args: ['-c'],
          skip_permissions_args: [],
          description: '',
        }}
        selection={selection()}
        onChange={setSelection}
      />
    ),
    host,
  );

  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.ListAgentModels, {
      provider: 'antigravity',
    }),
  );
  const model = host.querySelector<HTMLSelectElement>('select[aria-label="Agent model"]');
  const effort = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Agent reasoning effort"]',
  );
  expect(model).not.toBeNull();
  expect(effort).not.toBeNull();

  if (!model || !effort) throw new Error('Model controls did not render');
  model.value = 'gemini-3.8-flash-high';
  model.dispatchEvent(new Event('change', { bubbles: true }));
  expect(untrack(selection)).toEqual({
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high',
  });

  effort.value = 'low';
  effort.dispatchEvent(new Event('change', { bubbles: true }));
  expect(untrack(selection)).toEqual({
    model: 'gemini-3.8-flash-low',
    reasoningEffort: 'low',
  });
  expect(model.value).toBe('gemini-3.8-flash-high');
});

it('keeps CLI defaults available without inventing a model', async () => {
  const [selection, setSelection] = createSignal({
    model: 'gemini-3.8-flash-low' as string | undefined,
    reasoningEffort: 'low' as string | undefined,
  });
  dispose = render(
    () => (
      <AgentModelFields
        agentDef={{
          id: 'antigravity',
          name: 'Antigravity',
          command: 'agy',
          args: [],
          resume_args: ['-c'],
          skip_permissions_args: [],
          description: '',
        }}
        selection={selection()}
        onChange={setSelection}
      />
    ),
    host,
  );

  await vi.waitFor(() =>
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Agent model"]')?.value).toBe(
      'gemini-3.8-flash-high',
    ),
  );
  const model = host.querySelector<HTMLSelectElement>('select[aria-label="Agent model"]');
  if (!model) throw new Error('Missing model selector');
  model.value = '';
  model.dispatchEvent(new Event('change', { bubbles: true }));
  expect(untrack(selection)).toEqual({ reasoningEffort: 'low' });
});
