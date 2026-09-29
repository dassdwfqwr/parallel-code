export type AITerminalLayout = 'split' | 'tabs';

export const DEFAULT_AI_TERMINAL_LAYOUT: AITerminalLayout = 'tabs';

/** Missing values are legacy records from before the tabs default existed. */
export function resolveAITerminalLayout(value: unknown): AITerminalLayout {
  return value === 'split' ? 'split' : DEFAULT_AI_TERMINAL_LAYOUT;
}
