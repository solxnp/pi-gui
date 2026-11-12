import { Component, Fragment, type ReactNode } from "react";
import { useTranslation } from "../i18n";
import type { MessageKey } from "../i18n";
import type { DesktopAppView, StateHydrationFailure } from "./desktop-app-state";

export type DesktopStartupSurfaceState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "failed";
      readonly failure: StateHydrationFailure;
      readonly retrying: boolean;
    }
  | { readonly kind: "crashed" };

/** Catalog keys, not copy: every string here has to exist in both language packs. */
export interface DesktopStartupCopy {
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly status: "loading" | "failed" | "crashed";
}

const LOADING_COPY: DesktopStartupCopy = {
  titleKey: "startup.loading.title",
  bodyKey: "startup.loading.body",
  status: "loading",
};

const STATE_FAILED_COPY: DesktopStartupCopy = {
  titleKey: "startup.failed.title",
  bodyKey: "startup.failed.body",
  status: "failed",
};

const BRIDGE_FAILED_COPY: DesktopStartupCopy = {
  titleKey: "startup.failed.title",
  bodyKey: "startup.bridgeFailed.body",
  status: "failed",
};

const CRASHED_COPY: DesktopStartupCopy = {
  titleKey: "startup.crashed.title",
  bodyKey: "startup.crashed.body",
  status: "crashed",
};

export function startupSurfaceCopy(state: DesktopStartupSurfaceState): DesktopStartupCopy {
  if (state.kind === "loading") {
    return LOADING_COPY;
  }
  if (state.kind === "crashed") {
    return CRASHED_COPY;
  }
  if (state.failure.code === "bridge-unavailable") {
    return BRIDGE_FAILED_COPY;
  }
  return STATE_FAILED_COPY;
}

export function rendererBoundaryCopy(): DesktopStartupCopy {
  return CRASHED_COPY;
}

interface DesktopStartupSurfaceProps {
  readonly state: DesktopStartupSurfaceState;
  readonly onRetry: () => void;
  readonly onRelaunch?: () => void;
}

export function DesktopStartupSurface({ state, onRetry, onRelaunch }: DesktopStartupSurfaceProps) {
  const { t } = useTranslation();
  const copy = startupSurfaceCopy(state);
  const retrying = state.kind === "failed" ? state.retrying : false;
  const showActions = copy.status !== "loading";
  const showRelaunch =
    Boolean(onRelaunch) &&
    (state.kind === "crashed" ||
      (state.kind === "failed" && state.failure.code !== "bridge-unavailable"));

  return (
    <div className="shell shell--loading">
      <main
        className="loading-card"
        data-testid="shell-status-card"
        data-status={copy.status}
        data-retrying={retrying ? "true" : "false"}
        data-failure={state.kind === "failed" ? state.failure.code : undefined}
      >
        <div className="loading-card__eyebrow">pi-gui</div>
        <h1>{t(copy.titleKey)}</h1>
        <p>{t(copy.bodyKey)}</p>
        {showActions ? (
          <div className="loading-card__actions">
            <button
              className="button button--primary"
              data-testid="hydrate-retry"
              type="button"
              disabled={retrying}
              onClick={onRetry}
            >
              {retrying ? t("startup.retrying") : t("startup.retry")}
            </button>
            {showRelaunch ? (
              <button
                className="button button--ghost"
                data-testid="hydrate-relaunch"
                type="button"
                onClick={onRelaunch}
              >
                {t("startup.relaunch")}
              </button>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

interface RendererErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onRelaunch?: () => void;
}

interface RendererErrorBoundaryState {
  readonly hasError: boolean;
  readonly remountKey: number;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { hasError: false, remountKey: 0 };

  static getDerivedStateFromError(): Pick<RendererErrorBoundaryState, "hasError"> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[renderer] render tree failed", error);
  }

  private readonly handleRetry = (): void => {
    this.setState((current) => ({
      hasError: false,
      remountKey: current.remountKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <DesktopStartupSurface
          state={{ kind: "crashed" }}
          onRetry={this.handleRetry}
          onRelaunch={this.props.onRelaunch}
        />
      );
    }
    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}

export function toStartupSurfaceState(view: DesktopAppView): DesktopStartupSurfaceState {
  if (view.kind === "failed") {
    return view;
  }
  return { kind: "loading" };
}
