/**
 * The plan card above the composer.
 *
 * The model keeps a numbered plan in one pinned card, and every `update_plan` call rewrites the
 * same `pi-gui.pin` key. The app reduces pins by key, so the card is replaced where it stands
 * instead of stacking one card per update — that is what makes it a live progress board rather
 * than a log of plans.
 *
 * Steps are plain data: `{ step, status }`. The card itself is built here so the model never has
 * to know the pin schema or the tone names.
 */

import type {
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_PIN_CUSTOM_TYPE } from "@pi-gui/session-driver";

export const updatePlanToolName = "update_plan";
export const updatePlanAction = "pi_gui_update_plan";

/** One key for the whole thread, so a new plan replaces the old one instead of stacking. */
export const PLAN_PIN_KEY = "pi-gui-plan";

export const PLAN_STEP_STATUSES = ["pending", "in_progress", "done", "blocked"] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export interface PlanStep {
  readonly step: string;
  readonly status: PlanStepStatus;
  /** How far through this step's own work, 0..1, when the writer can judge it. */
  readonly progress?: number;
}

export interface UpdatePlanToolDetails {
  readonly action: typeof updatePlanAction;
  readonly title: string;
  readonly steps: readonly PlanStep[];
  readonly removed?: boolean;
  readonly error?: string;
}

const STATUS_MARKS: Readonly<Record<PlanStepStatus, string>> = {
  pending: "○",
  in_progress: "◐",
  done: "●",
  blocked: "✕",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A step counts as progress once it is done; a blocked step is stopped, not advanced. */
export function planProgress(steps: readonly PlanStep[]): number {
  if (steps.length === 0) return 0;
  return steps.filter((step) => step.status === "done").length / steps.length;
}

export function planStepsFromParams(params: unknown): readonly PlanStep[] | undefined {
  if (!isRecord(params) || !Array.isArray(params.steps)) {
    return undefined;
  }
  const steps: PlanStep[] = [];
  for (const [index, raw] of params.steps.entries()) {
    if (!isRecord(raw)) {
      return undefined;
    }
    const step = typeof raw.step === "string" ? raw.step.trim() : "";
    const status = raw.status;
    if (!step) {
      return undefined;
    }
    // A missing status is the ordinary case while the model drafts the plan.
    const resolved: PlanStepStatus =
      typeof status === "string" && (PLAN_STEP_STATUSES as readonly string[]).includes(status)
        ? (status as PlanStepStatus)
        : index === 0
          ? "in_progress"
          : "pending";
    const progress =
      typeof raw.progress === "number" && Number.isFinite(raw.progress)
        ? Math.min(1, Math.max(0, raw.progress))
        : undefined;
    steps.push({ step, status: resolved, ...(progress !== undefined ? { progress } : {}) });
  }
  return steps.length > 0 ? steps : undefined;
}

export function planTitleFromParams(params: unknown): string {
  const title = isRecord(params) && typeof params.title === "string" ? params.title.trim() : "";
  return title || "计划";
}

/** The `pi-gui.pin` payload: `remove` for a finished plan, else a card with one row per step. */
export function planPinPayload(title: string, steps: readonly PlanStep[]): Record<string, unknown> {
  const done = steps.filter((step) => step.status === "done").length;
  return {
    key: PLAN_PIN_KEY,
    title,
    subtitle: `${done}/${steps.length} 步完成`,
    tone: "neutral",
    progress: planProgress(steps),
    // The status icon replaces the step number, so `label` carries the status mark and `value`
    // the step text: a client that does not know `status` still reads the plan in order.
    rows: steps.map((step) => ({
      label: STATUS_MARKS[step.status],
      value: step.step,
      status: step.status,
      // A finished step reads as complete; otherwise the writer's own fraction wins.
      ...(step.status === "done"
        ? { progress: 1 }
        : step.progress !== undefined
          ? { progress: step.progress }
          : {}),
    })),
    actions: [],
  };
}

export function removedPlanPinPayload(): Record<string, unknown> {
  return { key: PLAN_PIN_KEY, remove: true };
}

export function createUpdatePlanTool(pi: ExtensionAPI): ToolDefinition<any, UpdatePlanToolDetails> {
  return {
    name: updatePlanToolName,
    label: "Update plan",
    description:
      "Publish or update the numbered plan shown above the composer, so the user can watch which step is current.",
    promptSnippet:
      "update_plan: publish or update the live plan card above the composer as you work through steps.",
    promptGuidelines: [
      "Call update_plan as the first tool of any multi-step task: the steps you are about to take, with the current one in_progress.",
      "Call it again after each step finishes, flipping that step to done and the next to in_progress. Do not restate the whole plan in chat.",
      "While a long step is still running, call update_plan with that step's progress (0 to 1) each time you finish a part of it, so its own bar moves before the step ends.",
      "Keep step text short and concrete; the card shows it verbatim.",
      "Call update_plan with remove: true once every step is done, so a finished plan stops sitting above the composer.",
    ],
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title; defaults to 计划." },
        steps: {
          type: "array",
          description: "The plan, in order.",
          items: {
            type: "object",
            properties: {
              step: { type: "string", description: "One short sentence for this step." },
              status: {
                type: "string",
                enum: [...PLAN_STEP_STATUSES],
                description: "pending, in_progress, done or blocked.",
              },
              progress: {
                type: "number",
                description:
                  "0 to 1: how far through this step you are. Update it as you finish parts of a long step, so its own bar moves before the step is done.",
              },
            },
            required: ["step"],
          },
        },
        remove: { type: "boolean", description: "Remove the plan card instead of updating it." },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate) {
      if (isRecord(params) && params.remove === true) {
        pi.appendEntry(EXTENSION_PIN_CUSTOM_TYPE, removedPlanPinPayload());
        return {
          content: [{ type: "text", text: "Plan card removed." }],
          details: { action: updatePlanAction, title: "", steps: [], removed: true },
        };
      }

      const steps = planStepsFromParams(params);
      if (!steps) {
        return {
          content: [
            {
              type: "text",
              text: "update_plan needs a non-empty steps array of { step, status? }.",
            },
          ],
          details: {
            action: updatePlanAction,
            title: "",
            steps: [],
            error: "Invalid steps",
          },
        };
      }
      const title = planTitleFromParams(params);
      pi.appendEntry(EXTENSION_PIN_CUSTOM_TYPE, planPinPayload(title, steps));
      const done = steps.filter((step) => step.status === "done").length;
      return {
        content: [
          {
            type: "text",
            text: `Plan updated: ${done}/${steps.length} steps done. Current: ${
              steps.find((step) => step.status === "in_progress")?.step ?? "none"
            }`,
          },
        ],
        details: { action: updatePlanAction, title, steps },
      };
    },
  };
}

export function createPlanRuntimeExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool(createUpdatePlanTool(pi));
  };
}
