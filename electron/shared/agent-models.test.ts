import { describe, expect, it } from 'vitest';
import type { AgentDef } from '../ipc/shared-types.js';
import {
  findAgentModelChoice,
  modelProviderForAgent,
  readAgentModelSelection,
  resolveAgentModelSlug,
  withAgentModelSelection,
  type AgentModelChoice,
} from './agent-models.js';

function agent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    resume_args: ['resume', '--last'],
    skip_permissions_args: [],
    description: '',
    ...overrides,
  };
}

describe('modelProviderForAgent', () => {
  it('recognizes task-local custom definitions by executable', () => {
    expect(modelProviderForAgent(agent({ id: 'local-codex', command: '/opt/bin/codex' }))).toBe(
      'codex',
    );
    expect(modelProviderForAgent(agent({ id: 'local-claude', command: 'claude' }))).toBe('claude');
    expect(modelProviderForAgent(agent({ id: 'local-agy', command: 'agy' }))).toBe('antigravity');
  });
});

describe('withAgentModelSelection', () => {
  it('replaces Codex model and effort without losing resume selectors or unrelated flags', () => {
    const original = agent({
      args: ['--model', 'old-model', '--search'],
      resume_args: [
        '--config=model_reasoning_effort="low"',
        'resume',
        '--last',
        '--model=old-model',
      ],
    });

    const configured = withAgentModelSelection(original, {
      model: 'gpt-6-sol',
      reasoningEffort: 'xhigh',
    });

    expect(configured).not.toBe(original);
    expect(original.args).toEqual(['--model', 'old-model', '--search']);
    expect(configured.args).toEqual([
      '--model',
      'gpt-6-sol',
      '-c',
      'model_reasoning_effort="xhigh"',
      '--search',
    ]);
    expect(configured.resume_args).toEqual([
      '--model',
      'gpt-6-sol',
      '-c',
      'model_reasoning_effort="xhigh"',
      'resume',
      '--last',
    ]);
    expect(readAgentModelSelection(configured)).toEqual({
      model: 'gpt-6-sol',
      reasoningEffort: 'xhigh',
    });
  });

  it('places Claude and Antigravity flags before their preserved resume commands', () => {
    const claude = withAgentModelSelection(
      agent({ id: 'claude-code', command: 'claude', resume_args: ['--continue'] }),
      { model: 'sonnet', reasoningEffort: 'high' },
    );
    expect(claude.args).toEqual(['--model', 'sonnet', '--effort', 'high']);
    expect(claude.resume_args).toEqual(['--model', 'sonnet', '--effort', 'high', '--continue']);

    const antigravity = withAgentModelSelection(
      agent({ id: 'antigravity', command: 'agy', resume_args: ['-c'] }),
      { model: 'gemini-3.8-flash-low', reasoningEffort: 'low' },
    );
    expect(antigravity.resume_args).toEqual([
      '--model',
      'gemini-3.8-flash-low',
      '--effort',
      'low',
      '-c',
    ]);
  });

  it('removes overrides when the user returns to CLI defaults', () => {
    const configured = agent({
      args: ['-m', 'gpt-6-sol', '-c', 'model_reasoning_effort="high"', '--search'],
      resume_args: ['resume', '--last', '--model=gpt-6-sol'],
    });
    const reset = withAgentModelSelection(configured, {});
    expect(reset.args).toEqual(['--search']);
    expect(reset.resume_args).toEqual(['resume', '--last']);
    expect(readAgentModelSelection(reset)).toEqual({
      model: undefined,
      reasoningEffort: undefined,
    });
  });
});

describe('Antigravity model families', () => {
  const choice: AgentModelChoice = {
    slug: 'gemini-3.8-flash-high',
    displayName: 'Gemini 3.8 Flash',
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'low' }],
    modelByReasoningEffort: {
      high: 'gemini-3.8-flash-high',
      low: 'gemini-3.8-flash-low',
    },
  };

  it('finds and resolves an effort-specific slug', () => {
    expect(findAgentModelChoice([choice], 'gemini-3.8-flash-low')).toBe(choice);
    expect(resolveAgentModelSlug(choice, 'low')).toBe('gemini-3.8-flash-low');
    expect(resolveAgentModelSlug(choice, undefined)).toBe('gemini-3.8-flash-high');
  });
});
