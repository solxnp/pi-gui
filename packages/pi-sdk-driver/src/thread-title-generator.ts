import { join } from "node:path";
import {
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  createAgentSession,
  ModelRuntime,
  type AgentSession,
  type CreateAgentSessionOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { SessionModelSelection, WorkspaceRef } from "@pi-gui/session-driver";
import { messageText as sessionMessageText } from "./session-supervisor-utils.js";

export interface GenerateThreadTitleOptions {
  readonly prompt: string;
  readonly model?: SessionModelSelection;
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

export interface ThreadTitleGeneratorDeps {
  readonly agentDir: string;
  /**
   * The workspace's loaded model runtime plus its real default selection.
   *
   * A bare runtime here cannot see extension providers, so a default model that an
   * extension registers (e.g. a router provider) resolves to nothing and silently
   * degrades to whatever the fallback picks. Returns undefined when the workspace
   * context is unavailable; the bare runtime is then used as before.
   */
  readonly loadWorkspaceModelContext?: (
    workspace: WorkspaceRef,
  ) => Promise<WorkspaceModelContext | undefined>;
}

/** What the title prompt needs from the workspace: its models and its real defaults. */
export interface WorkspaceModelContext {
  readonly modelRuntime: ModelRuntime;
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
}

const MAX_THREAD_TITLE_LENGTH = 36;
const THREAD_TITLE_SYSTEM_PROMPT = [
  "You generate concise UI thread titles for a coding assistant.",
  "Return only the title text.",
  "Keep it short, usually 2 to 5 words.",
  "Use the same language as the source message.",
  "Preserve ticket IDs exactly.",
  "No markdown, quotes, labels, or trailing punctuation.",
].join("\n");

export async function generateThreadTitle(
  workspace: WorkspaceRef,
  options: GenerateThreadTitleOptions,
  deps: ThreadTitleGeneratorDeps,
): Promise<string | null> {
  const prompt = options.prompt.trim();
  if (!prompt || options.signal?.aborted) {
    return null;
  }

  const workspaceContext = await deps.loadWorkspaceModelContext?.(workspace).catch((error) => {
    console.warn(
      `[thread-title] workspace model context unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  });
  // The workspace's own runtime carries its extension providers; without it the default model
  // below cannot resolve and the title silently rides on an unrelated fallback model.
  const modelRuntime = workspaceContext?.modelRuntime ?? (await createBareModelRuntime(deps));
  // In-memory settings keep compaction and retry off for this one-shot prompt, but they must
  // still name the real default model — otherwise the runtime falls back to its own guess.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    ...(workspaceContext?.defaultProvider
      ? { defaultProvider: workspaceContext.defaultProvider }
      : {}),
    ...(workspaceContext?.defaultModelId
      ? { defaultModel: workspaceContext.defaultModelId }
      : {}),
  });
  const resourceLoader = createThreadTitleResourceLoader();
  const createOptions: CreateAgentSessionOptions = {
    cwd: workspace.path,
    agentDir: deps.agentDir,
    modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  };
  const selectedModel = pickThreadTitleModel(modelRuntime, options.model);
  if (selectedModel) {
    createOptions.model = selectedModel;
  }
  if (options.thinkingLevel) {
    createOptions.thinkingLevel = options.thinkingLevel as NonNullable<
      CreateAgentSessionOptions["thinkingLevel"]
    >;
  }

  const { session } = await createAgentSession(createOptions);
  const handleAbort = () => {
    void session.abort().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    if (options.signal?.aborted) {
      return null;
    }
    if (!(await resolveTitleModel(session))) {
      // No promptable model (a router-only provider, or one without credentials) is a
      // configuration problem rather than a failed request: title the thread from its own words
      // instead of leaving it on the placeholder.
      console.warn("[thread-title] no usable model; falling back to the first message");
      return fallbackThreadTitle(prompt) || null;
    }

    await session.prompt(buildTitlePrompt(prompt), { source: "interactive" });
    const generated = normalizeThreadTitle(extractLastAssistantText(session));
    if (generated) {
      return generated;
    }
    // A provider that errors out (quota, outage, a model that returns nothing) must not leave
    // the thread stuck on its placeholder forever; fall back to the user's own words.
    console.warn(
      `[thread-title] no generated title for "${prompt.slice(0, 40)}"; falling back to the first message`,
    );
    return fallbackThreadTitle(prompt) || null;
  } finally {
    options.signal?.removeEventListener("abort", handleAbort);
    session.dispose();
  }
}

async function createBareModelRuntime(deps: ThreadTitleGeneratorDeps): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: join(deps.agentDir, "auth.json"),
    modelsPath: join(deps.agentDir, "models.json"),
    refreshOnCreate: false,
  });
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}

type ThreadTitleModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/**
 * Whether a catalog entry is a router.
 *
 * `pi` does not export its own `isVirtualModel()` helper, and the check is one field: a virtual
 * model advertises this API id and never reaches a provider.
 */
function isVirtualModel(model: { readonly api: string }): boolean {
  return model.api === VIRTUAL_MODEL_API;
}

const VIRTUAL_MODEL_API = "pi-virtual";

/**
 * The physical model one title request can actually reach.
 *
 * A virtual model (a router such as `commandcode/auto`) cannot be prompted directly: routing runs
 * through an extension context that only a full session service builds, and this one-shot session
 * has none — the request fails with "Extension runtime not initialized", which used to leave the
 * thread on its placeholder. So a virtual selection is swapped for a concrete chat model of the
 * same provider. Returns undefined when not even that exists, so the caller can fall back to the
 * first message instead of dropping the title on the floor.
 */
async function resolveTitleModel(
  session: Pick<AgentSession, "model" | "modelRuntime" | "agent">,
): Promise<ThreadTitleModel | undefined> {
  const hasCredentials = async (model: ThreadTitleModel): Promise<boolean> => {
    const auth = await session.modelRuntime.getAuth(model.provider);
    return Boolean(auth?.auth.apiKey);
  };

  const selected = session.model as ThreadTitleModel | undefined;
  if (selected && !isVirtualModel(selected)) {
    return (await hasCredentials(selected)) ? selected : undefined;
  }

  const provider = selected?.provider;
  const candidates = provider
    ? session.modelRuntime.getModels(provider).filter((model) => !isVirtualModel(model))
    : [];
  for (const candidate of candidates) {
    if (await hasCredentials(candidate as ThreadTitleModel)) {
      const physical = candidate as ThreadTitleModel;
      // Point this one-shot session at the physical model so the prompt reaches a provider.
      session.agent.state.model = physical;
      return physical;
    }
  }

  if (provider) {
    console.warn(
      `[thread-title] ${provider}/${selected?.id ?? "?"} is a virtual model and this provider has no direct model; falling back to the first message`,
    );
  }
  return undefined;
}

/**
 * The caller's model when this runtime can resolve it, otherwise undefined so the runtime
 * default is used. A model the runtime cannot see must not cost the thread its title: the
 * workspace's own runtime is passed in, so a miss here means the selection is stale (a removed
 * provider, a model dropped from the catalog), not that extensions are missing.
 */
export function pickThreadTitleModel(
  modelRuntime: Pick<ModelRuntime, "getModel">,
  selection: SessionModelSelection | undefined,
): ThreadTitleModel | undefined {
  if (!selection) {
    return undefined;
  }
  const model = modelRuntime.getModel(selection.provider, selection.modelId);
  if (model) {
    return model;
  }
  console.warn(
    `[thread-title] ${selection.provider}/${selection.modelId} is not in this workspace's model catalog; falling back to the default model`,
  );
  return undefined;
}

function createThreadTitleResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => THREAD_TITLE_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** The user's own first line, trimmed to a title, when generation produces nothing usable. */
export function fallbackThreadTitle(prompt: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const compressed = (firstLine ?? prompt).replace(/\s+/g, " ").trim();
  if (!compressed) {
    return "";
  }
  if (compressed.length <= MAX_THREAD_TITLE_LENGTH) {
    return compressed;
  }
  return `${compressed.slice(0, MAX_THREAD_TITLE_LENGTH - 3).trimEnd()}...`;
}

function buildTitlePrompt(prompt: string): string {
  return [
    "Generate a short UI thread title for the user's first message.",
    "Return only the title.",
    "",
    "<user_message>",
    prompt,
    "</user_message>",
  ].join("\n");
}

function extractLastAssistantText(session: { messages: readonly unknown[] }): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }
    return sessionMessageText(message);
  }
  return "";
}

function normalizeThreadTitle(title: string): string | null {
  let normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/^title\s*:\s*/i, "").trim();
  normalized = stripWrappingQuotes(normalized);
  normalized = normalized.replace(/[.?!,:;]+$/g, "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_THREAD_TITLE_LENGTH) {
    normalized = `${normalized.slice(0, MAX_THREAD_TITLE_LENGTH - 3).trimEnd()}...`;
  }

  return normalized || null;
}

function stripWrappingQuotes(value: string): string {
  let current = value.trim();
  while (current.length >= 2) {
    const first = current[0];
    const last = current[current.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`")
    ) {
      current = current.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
