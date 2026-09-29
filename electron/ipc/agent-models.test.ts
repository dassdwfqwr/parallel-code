import { describe, expect, it } from 'vitest';
import { parseAntigravityModels } from './agent-models.js';

describe('parseAntigravityModels', () => {
  it('groups model effort variants while retaining standalone models', () => {
    const choices = parseAntigravityModels(`Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`);

    expect(choices).toEqual([
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
      {
        slug: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6 (Thinking)',
        supportedReasoningEfforts: [],
      },
      {
        slug: 'gpt-oss-120b-medium',
        displayName: 'GPT-OSS 120B',
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
        modelByReasoningEffort: { medium: 'gpt-oss-120b-medium' },
      },
    ]);
  });

  it('rejects malformed command output instead of exposing it to launch arguments', () => {
    expect(
      parseAntigravityModels(`--bad Injected\nUPPER Invalid\nvalid-model\tValid Model\n`),
    ).toEqual([
      {
        slug: 'valid-model',
        displayName: 'Valid Model',
        supportedReasoningEfforts: [],
      },
    ]);
  });
});
