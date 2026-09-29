import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  CLAUDE_MODEL_CHOICES,
  type AgentModelChoice,
  type AgentModelProvider,
  type AgentReasoningEffort,
} from '../shared/agent-models.js';
import { listCodexModels } from './codex-models.js';
import { warn as logWarn } from '../log.js';

const execFileAsync = promisify(execFile);
const ANTIGRAVITY_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_MAX_BUFFER = 1024 * 1024;
const CATALOG_TTL_MS = 60_000;

let antigravityCache: { loadedAt: number; choices: AgentModelChoice[] } | undefined;

interface AntigravityVariant {
  slug: string;
  displayName: string;
  familyName: string;
  effort?: string;
}

const EFFORT_SUFFIX = /\s+\((low|medium|high|xhigh|max)\)$/i;
const EFFORT_SLUG_SUFFIX = /-(low|medium|high|xhigh|max)$/i;

function antigravityVariant(line: string): AntigravityVariant | undefined {
  const [rawSlug, ...nameParts] = line.trim().split(/\s+/);
  const displayName = nameParts.join(' ').trim();
  if (!rawSlug || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(rawSlug) || !displayName) return undefined;
  const displayMatch = EFFORT_SUFFIX.exec(displayName);
  const slugMatch = EFFORT_SLUG_SUFFIX.exec(rawSlug);
  const effort = (displayMatch?.[1] ?? slugMatch?.[1])?.toLowerCase();
  return {
    slug: rawSlug,
    displayName,
    familyName: displayMatch ? displayName.slice(0, displayMatch.index) : displayName,
    effort,
  };
}

/** Parse the stable two-column output of `agy models` into model families. */
export function parseAntigravityModels(stdout: string): AgentModelChoice[] {
  const variants = stdout
    .split(/\r?\n/)
    .map(antigravityVariant)
    .filter((variant): variant is AntigravityVariant => Boolean(variant));
  const families = new Map<string, AntigravityVariant[]>();
  for (const variant of variants) {
    const key = variant.familyName.toLowerCase();
    const family = families.get(key) ?? [];
    family.push(variant);
    families.set(key, family);
  }

  return [...families.values()].map((family) => {
    const primary = family.find((variant) => variant.effort === 'high') ?? family[0];
    const supportedReasoningEfforts: AgentReasoningEffort[] = [];
    const modelByReasoningEffort: Record<string, string> = {};
    for (const variant of family) {
      if (!variant.effort || modelByReasoningEffort[variant.effort]) continue;
      modelByReasoningEffort[variant.effort] = variant.slug;
      supportedReasoningEfforts.push({ reasoningEffort: variant.effort });
    }
    return {
      slug: primary.slug,
      displayName: primary.familyName,
      ...(primary.effort ? { defaultReasoningEffort: primary.effort } : {}),
      supportedReasoningEfforts,
      ...(Object.keys(modelByReasoningEffort).length > 0 ? { modelByReasoningEffort } : {}),
    };
  });
}

async function listAntigravityModels(): Promise<AgentModelChoice[]> {
  const now = Date.now();
  if (antigravityCache && now - antigravityCache.loadedAt < CATALOG_TTL_MS) {
    return antigravityCache.choices;
  }
  try {
    const { stdout } = await execFileAsync('agy', ['models'], {
      encoding: 'utf8',
      timeout: ANTIGRAVITY_TIMEOUT_MS,
      maxBuffer: ANTIGRAVITY_MAX_BUFFER,
    });
    const choices = parseAntigravityModels(stdout);
    antigravityCache = { loadedAt: now, choices };
    return choices;
  } catch (error) {
    logWarn('agentModels', 'Could not list Antigravity models', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function listAgentModels(provider: AgentModelProvider): Promise<AgentModelChoice[]> {
  if (provider === 'codex') {
    return listCodexModels().map((model) => ({
      ...model,
      supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    }));
  }
  if (provider === 'claude') return CLAUDE_MODEL_CHOICES;
  if (provider === 'antigravity') return listAntigravityModels();
  return [];
}
