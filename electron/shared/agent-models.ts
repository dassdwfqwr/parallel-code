import type { AgentDef } from '../ipc/shared-types.js';

export interface AgentReasoningEffort {
  reasoningEffort: string;
  description?: string;
}

/**
 * One model family shown by the desktop picker.
 *
 * Most CLIs accept `slug` directly and expose reasoning as a separate flag.
 * Antigravity publishes one slug per model/effort variant, so
 * `modelByReasoningEffort` lets the UI keep the two controls separate while
 * still launching a slug that the CLI actually advertised.
 */
export interface AgentModelChoice {
  slug: string;
  displayName: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: AgentReasoningEffort[];
  modelByReasoningEffort?: Record<string, string>;
}

export interface AgentModelSelection {
  model?: string;
  reasoningEffort?: string;
}

export type AgentModelProvider = 'codex' | 'claude' | 'antigravity';

export const CLAUDE_REASONING_EFFORTS: AgentReasoningEffort[] = [
  { reasoningEffort: 'low' },
  { reasoningEffort: 'medium' },
  { reasoningEffort: 'high' },
  { reasoningEffort: 'xhigh' },
  { reasoningEffort: 'max' },
];

export const CLAUDE_MODEL_CHOICES: AgentModelChoice[] = [
  {
    slug: 'opus',
    displayName: 'Opus (latest)',
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
  {
    slug: 'sonnet',
    displayName: 'Sonnet (latest)',
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
  {
    slug: 'haiku',
    displayName: 'Haiku (latest)',
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
  {
    slug: 'fable',
    displayName: 'Fable (latest)',
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
];

function commandBase(command: string): string {
  return command.split('/').pop() ?? command;
}

export function modelProviderForAgent(
  agent: Pick<AgentDef, 'id' | 'command'>,
): AgentModelProvider | undefined {
  const command = commandBase(agent.command);
  if (agent.id === 'codex' || command.includes('codex')) return 'codex';
  if (agent.id === 'claude-code' || command === 'claude') return 'claude';
  if (agent.id === 'antigravity' || command === 'agy') return 'antigravity';
  return undefined;
}

function stripSimpleOption(args: readonly string[], names: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (names.includes(arg)) {
      if (args[index + 1] && !args[index + 1].startsWith('-')) index++;
      continue;
    }
    if (names.some((name) => arg.startsWith(`${name}=`))) continue;
    result.push(arg);
  }
  return result;
}

function stripCodexEffort(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if ((arg === '-c' || arg === '--config') && args[index + 1]) {
      if (/^model_reasoning_effort\s*=/.test(args[index + 1])) {
        index++;
        continue;
      }
    }
    if (/^--config=model_reasoning_effort\s*=/.test(arg)) continue;
    result.push(arg);
  }
  return result;
}

function readSimpleOption(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (names.includes(arg)) {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) return value;
    }
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1) || undefined;
    }
  }
  return undefined;
}

function unquoteTomlString(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readCodexEffort(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if ((arg === '-c' || arg === '--config') && args[index + 1]) {
      const match = /^model_reasoning_effort\s*=\s*(.+)$/.exec(args[index + 1]);
      if (match) return unquoteTomlString(match[1]);
    }
    const match = /^--config=model_reasoning_effort\s*=\s*(.+)$/.exec(arg);
    if (match) return unquoteTomlString(match[1]);
  }
  return undefined;
}

export function readAgentModelSelection(
  agent: Pick<AgentDef, 'id' | 'command' | 'args'>,
): AgentModelSelection {
  const provider = modelProviderForAgent(agent);
  if (!provider) return {};
  return {
    model: readSimpleOption(agent.args, ['--model', '-m']),
    reasoningEffort:
      provider === 'codex'
        ? readCodexEffort(agent.args)
        : readSimpleOption(agent.args, ['--effort']),
  };
}

function configuredArgs(
  args: readonly string[],
  provider: NonNullable<ReturnType<typeof modelProviderForAgent>>,
  selection: AgentModelSelection,
): string[] {
  let cleaned = stripSimpleOption(args, ['--model', '-m']);
  cleaned =
    provider === 'codex' ? stripCodexEffort(cleaned) : stripSimpleOption(cleaned, ['--effort']);

  const configured: string[] = [];
  if (selection.model) configured.push('--model', selection.model);
  if (selection.reasoningEffort) {
    if (provider === 'codex') {
      configured.push('-c', `model_reasoning_effort=${JSON.stringify(selection.reasoningEffort)}`);
    } else {
      configured.push('--effort', selection.reasoningEffort);
    }
  }
  return [...configured, ...cleaned];
}

/** Return a task-local clone; never mutate the shared built-in definition. */
export function withAgentModelSelection(agent: AgentDef, selection: AgentModelSelection): AgentDef {
  const provider = modelProviderForAgent(agent);
  if (!provider) return agent;
  return {
    ...agent,
    args: configuredArgs(agent.args ?? [], provider, selection),
    resume_args: configuredArgs(agent.resume_args ?? [], provider, selection),
  };
}

/** Find the family whose primary slug or effort-specific slug is selected. */
export function findAgentModelChoice(
  choices: readonly AgentModelChoice[],
  model: string | undefined,
): AgentModelChoice | undefined {
  if (!model) return undefined;
  return choices.find(
    (choice) =>
      choice.slug === model || Object.values(choice.modelByReasoningEffort ?? {}).includes(model),
  );
}

/** Resolve an effort-specific launch slug where the CLI publishes variants. */
export function resolveAgentModelSlug(
  choice: AgentModelChoice,
  reasoningEffort: string | undefined,
): string {
  return (
    (reasoningEffort ? choice.modelByReasoningEffort?.[reasoningEffort] : undefined) ?? choice.slug
  );
}
