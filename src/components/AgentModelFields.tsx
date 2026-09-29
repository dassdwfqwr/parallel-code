import { For, Show, createMemo, createResource } from 'solid-js';
import type { AgentDef } from '../ipc/types';
import { IPC } from '../../electron/ipc/channels';
import type { AgentModelChoice, AgentModelSelection } from '../../electron/shared/agent-models';
import {
  findAgentModelChoice,
  modelProviderForAgent,
  resolveAgentModelSlug,
} from '../../electron/shared/agent-models';
import { invoke } from '../lib/ipc';
import { theme } from '../lib/theme';

interface AgentModelFieldsProps {
  agentDef: AgentDef | undefined;
  selection: AgentModelSelection;
  onChange: (selection: AgentModelSelection) => void;
  compact?: boolean;
}

function uniqueEfforts(models: readonly AgentModelChoice[]): string[] {
  const efforts = new Set<string>();
  for (const model of models) {
    for (const option of model.supportedReasoningEfforts) {
      efforts.add(option.reasoningEffort);
    }
  }
  return [...efforts];
}

/** Model and reasoning controls shared by task creation and per-agent setup. */
export function AgentModelFields(props: AgentModelFieldsProps) {
  const source = () => {
    const agent = props.agentDef;
    return agent ? (modelProviderForAgent(agent) ?? null) : null;
  };
  const [models] = createResource(source, (provider) =>
    invoke<AgentModelChoice[]>(IPC.ListAgentModels, { provider }),
  );
  const choices = () => models() ?? [];
  const selectedChoice = createMemo(() => findAgentModelChoice(choices(), props.selection.model));
  const selectedValue = () => selectedChoice()?.slug ?? props.selection.model ?? '';
  const efforts = createMemo(() => {
    const selected = selectedChoice();
    return selected
      ? selected.supportedReasoningEfforts.map((option) => option.reasoningEffort)
      : uniqueEfforts(choices());
  });
  const currentModelIsUnlisted = () => Boolean(props.selection.model && !selectedChoice());

  function selectModel(slug: string) {
    if (!slug) {
      props.onChange({ reasoningEffort: props.selection.reasoningEffort });
      return;
    }
    const choice = choices().find((option) => option.slug === slug);
    if (!choice) return;
    const supported = choice.supportedReasoningEfforts.map((option) => option.reasoningEffort);
    const reasoningEffort = supported.includes(props.selection.reasoningEffort ?? '')
      ? props.selection.reasoningEffort
      : choice.defaultReasoningEffort;
    props.onChange({
      model: resolveAgentModelSlug(choice, reasoningEffort),
      reasoningEffort,
    });
  }

  function selectEffort(reasoningEffort: string) {
    const effort = reasoningEffort || undefined;
    const choice = selectedChoice();
    props.onChange({
      model: choice ? resolveAgentModelSlug(choice, effort) : props.selection.model,
      reasoningEffort: effort,
    });
  }

  const fieldStyle = () =>
    ({
      background: theme.bgInput,
      border: `1px solid ${theme.border}`,
      'border-radius': 'var(--radius-sm)',
      color: theme.fg,
      padding: props.compact ? '3px 7px' : '8px 10px',
      'font-size': props.compact ? '11px' : '13px',
      'min-width': props.compact ? '128px' : '0',
      flex: '1',
    }) as const;

  return (
    <Show when={source()}>
      <div
        class="agent-model-fields"
        style={{
          display: 'flex',
          'align-items': props.compact ? 'center' : 'stretch',
          'flex-direction': props.compact ? 'row' : 'column',
          gap: props.compact ? '6px' : '8px',
          'min-width': '0',
        }}
      >
        <Show when={!props.compact}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'minmax(0, 1fr) minmax(130px, 0.45fr)',
              gap: '8px',
            }}
          >
            <label style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
              <span style={{ color: theme.fgMuted, 'font-size': '12px' }}>Model</span>
              {modelSelect()}
            </label>
            <label style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
              <span style={{ color: theme.fgMuted, 'font-size': '12px' }}>Reasoning</span>
              {effortSelect()}
            </label>
          </div>
        </Show>
        <Show when={props.compact}>
          {modelSelect()}
          {effortSelect()}
        </Show>
        <Show when={models.error}>
          <span style={{ color: theme.error, 'font-size': '11px' }}>
            Models unavailable; the CLI default will still work.
          </span>
        </Show>
      </div>
    </Show>
  );

  function modelSelect() {
    return (
      <select
        aria-label="Agent model"
        title="Model for this agent; CLI default follows the agent's own settings"
        disabled={models.loading}
        value={selectedValue()}
        onChange={(event) => selectModel(event.currentTarget.value)}
        style={fieldStyle()}
      >
        <option value="" selected={selectedValue() === ''}>
          {models.loading ? 'Loading models…' : 'CLI default'}
        </option>
        <Show when={currentModelIsUnlisted()}>
          <option
            value={props.selection.model}
            selected={selectedValue() === props.selection.model}
          >
            {props.selection.model}
          </option>
        </Show>
        <For each={choices()}>
          {(choice) => (
            <option value={choice.slug} selected={selectedValue() === choice.slug}>
              {choice.displayName}
            </option>
          )}
        </For>
      </select>
    );
  }

  function effortSelect() {
    return (
      <select
        aria-label="Agent reasoning effort"
        title="Reasoning strength for this agent"
        disabled={models.loading || efforts().length === 0}
        value={props.selection.reasoningEffort ?? ''}
        onChange={(event) => selectEffort(event.currentTarget.value)}
        style={fieldStyle()}
      >
        <option value="" selected={!props.selection.reasoningEffort}>
          Default effort
        </option>
        <For each={efforts()}>
          {(effort) => (
            <option value={effort} selected={props.selection.reasoningEffort === effort}>
              {effort}
            </option>
          )}
        </For>
      </select>
    );
  }
}
