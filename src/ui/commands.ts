/**
 * Slash-command and overlay controllers for the terminal UI.
 *
 * Owns Select-overlay command flows (`/model`, `/session`, `/login`, etc.)
 * and stateful command mutations that operate on the current {@link AppState}.
 * Runtime-specific concerns such as rendering, overlay storage, and input draft
 * ownership are injected from `ui.ts` so this module can stay independent of
 * module-scoped UI state.
 *
 * @module
 */

import { Select } from "@cel-tui/components";
import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { OAuthProviderInterface } from "@mariozechner/pi-ai/oauth";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import type { AppState } from "../index.ts";
import { getAvailableModels, saveOAuthCredentials } from "../index.ts";
import { COMMANDS } from "../input.ts";
import {
  computeStats,
  forkSession,
  listPromptHistory,
  listSessions,
  loadMessages,
  undoLastTurn,
} from "../session.ts";
import { updateSettings } from "../settings.ts";
import { buildHelpText, COMMAND_DESCRIPTIONS } from "./help.ts";
import { type ActiveOverlay, OVERLAY_MAX_VISIBLE } from "./overlay.ts";
import { abbreviatePath } from "./status.ts";

/** Effort levels available for selection. */
const EFFORT_LEVELS: { label: string; value: ThinkingLevel }[] = [
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" },
];

/** Runtime hooks injected from the stateful UI module. */
export interface UiCommandRuntime {
  /** Open an overlay and trigger a re-render. */
  openOverlay: (overlay: ActiveOverlay) => void;
  /** Dismiss the active overlay and trigger a re-render. */
  dismissOverlay: () => void;
  /** Update the current input draft. */
  setInputValue: (value: string) => void;
  /** Append a UI-only info message to the conversation log. */
  appendInfoMessage: (text: string, state: AppState) => void;
  /** Re-enable stick-to-bottom behavior for the conversation log. */
  scrollConversationToBottom: () => void;
  /** Trigger a UI re-render. */
  render: () => void;
  /** Open a URL in the user's default browser. */
  openInBrowser: (url: string) => void;
}

/** Public command actions consumed by `ui.ts` and unit tests. */
export interface UiCommandController {
  /** Apply a model selection and persist it to settings. */
  applyModelSelection: (
    state: AppState,
    model: AppState["model"] & NonNullable<AppState["model"]>,
  ) => void;
  /** Apply an effort selection and persist it to settings. */
  applyEffortSelection: (state: AppState, effort: ThinkingLevel) => void;
  /** Open the slash-command autocomplete overlay. */
  showCommandAutocomplete: (state: AppState) => void;
  /** Open the raw input-history overlay. */
  showInputHistoryOverlay: (state: AppState) => void;
  /** Dispatch a parsed command and report whether it was handled. */
  handleCommand: (command: string, state: AppState) => boolean;
}

/**
 * Apply a model selection to the active state and persisted settings.
 *
 * @param state - Application state.
 * @param model - Selected model.
 */
export function applyModelSelection(
  state: AppState,
  model: Model<string>,
): void {
  state.model = model;
  state.settings = updateSettings(state.settingsPath, {
    defaultModel: `${model.provider}/${model.id}`,
  });
}

/**
 * Apply an effort selection to the active state and persisted settings.
 *
 * @param state - Application state.
 * @param effort - Selected reasoning effort.
 */
export function applyEffortSelection(
  state: AppState,
  effort: ThinkingLevel,
): void {
  state.effort = effort;
  state.settings = updateSettings(state.settingsPath, {
    defaultEffort: effort,
  });
}

/**
 * Format a recent timestamp for display.
 *
 * @param date - Timestamp to format.
 * @param now - Reference time used to compute the relative label.
 * @returns Relative time text suitable for Select labels.
 */
export function formatRelativeDate(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Collapse a raw prompt into a one-line preview for the Select overlay.
 *
 * @param text - Raw prompt text.
 * @returns A single-line preview string.
 */
export function formatPromptHistoryPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Lightweight item shape used by the shared Select-overlay helper. */
interface OverlayItem {
  /** Label shown in the Select list. */
  label: string;
  /** Stable item value. */
  value: string;
  /** Search text used by Select filtering. */
  filterText: string;
}

/**
 * Create the UI command controller bound to the current UI runtime hooks.
 *
 * @param runtime - State mutation and rendering hooks owned by `ui.ts`.
 * @returns Command actions for slash commands and overlays.
 */
export function createCommandController(
  runtime: UiCommandRuntime,
): UiCommandController {
  const openSelectOverlay = (
    state: AppState,
    title: string,
    items: OverlayItem[],
    placeholder: string,
    onSelect: (value: string) => void,
  ): void => {
    const select = Select({
      items,
      maxVisible: OVERLAY_MAX_VISIBLE,
      placeholder,
      focused: true,
      highlightColor: state.theme.accentText,
      onSelect,
      onBlur: runtime.dismissOverlay,
    });

    runtime.openOverlay({ select, title });
  };

  const showCommandAutocomplete = (state: AppState): void => {
    const items = COMMANDS.map((command) => ({
      label: `/${command}  ${COMMAND_DESCRIPTIONS[command] ?? ""}`,
      value: command,
      filterText: command,
    }));

    runtime.setInputValue("");
    openSelectOverlay(
      state,
      "Commands",
      items,
      "type to filter commands...",
      (value) => {
        runtime.dismissOverlay();
        handleCommand(value, state);
      },
    );
  };

  const showInputHistoryOverlay = (state: AppState): void => {
    const history = listPromptHistory(state.db);
    if (history.length === 0) {
      return;
    }

    const items = history.map((entry) => {
      const preview = formatPromptHistoryPreview(entry.text);
      const date = formatRelativeDate(new Date(entry.createdAt));
      return {
        label: `${preview}  ·  ${abbreviatePath(entry.cwd)}  ·  ${date}`,
        value: String(entry.id),
        filterText: `${entry.text} ${entry.cwd}`,
      };
    });

    openSelectOverlay(
      state,
      "Input history",
      items,
      "type to filter history...",
      (value) => {
        const picked = history.find((entry) => String(entry.id) === value);
        if (picked) {
          runtime.setInputValue(picked.text);
        }
        runtime.dismissOverlay();
      },
    );
  };

  const handleModelCommand = (state: AppState): void => {
    const models = getAvailableModels(state);
    if (models.length === 0) {
      return;
    }

    const currentValue = state.model
      ? `${state.model.provider}/${state.model.id}`
      : null;
    const items = models.map((model) => {
      const value = `${model.provider}/${model.id}`;
      const current = value === currentValue ? " (current)" : "";
      return {
        label: `${model.provider}/${model.id}${current}`,
        value,
        filterText: `${model.provider} ${model.id}`,
      };
    });

    openSelectOverlay(
      state,
      "Select a model",
      items,
      "type to filter models...",
      (value) => {
        const picked = models.find(
          (model) => `${model.provider}/${model.id}` === value,
        );
        if (picked) {
          applyModelSelection(state, picked);
        }
        runtime.dismissOverlay();
      },
    );
  };

  const handleEffortCommand = (state: AppState): void => {
    const items = EFFORT_LEVELS.map((effort) => ({
      label:
        effort.value === state.effort
          ? `${effort.label} (current)`
          : effort.label,
      value: effort.value,
      filterText: effort.label,
    }));

    openSelectOverlay(
      state,
      "Select effort level",
      items,
      "type to filter...",
      (value) => {
        applyEffortSelection(state, value as ThinkingLevel);
        runtime.dismissOverlay();
      },
    );
  };

  const handleSessionCommand = (state: AppState): void => {
    const sessions = listSessions(state.db, state.canonicalCwd);
    if (sessions.length === 0) {
      return;
    }

    const currentSessionId = state.session?.id ?? null;
    const items = sessions.map((session) => {
      const dateStr = formatRelativeDate(new Date(session.updatedAt));
      const model = session.model ?? "no model";
      const current = session.id === currentSessionId ? " (current)" : "";
      return {
        label: `${dateStr}  ${model}${current}`,
        value: session.id,
        filterText: `${dateStr} ${model}`,
      };
    });

    openSelectOverlay(
      state,
      "Resume a session",
      items,
      "type to filter sessions...",
      (sessionId) => {
        if (sessionId !== currentSessionId) {
          const picked = sessions.find((session) => session.id === sessionId);
          if (picked) {
            state.session = picked;
            state.messages = loadMessages(state.db, picked.id);
            state.stats = computeStats(state.messages);
            runtime.scrollConversationToBottom();
          }
        }
        runtime.dismissOverlay();
      },
    );
  };

  const handleNewCommand = (state: AppState): void => {
    if (state.running) {
      return;
    }
    state.session = null;
    state.messages = [];
    state.stats = { totalInput: 0, totalOutput: 0, totalCost: 0 };
    runtime.scrollConversationToBottom();
    runtime.render();
  };

  const handleForkCommand = (state: AppState): void => {
    if (state.running || !state.session) {
      return;
    }
    const forked = forkSession(state.db, state.session.id);
    state.session = forked;
    state.messages = loadMessages(state.db, forked.id);
    state.stats = computeStats(state.messages);
    runtime.appendInfoMessage("Forked session.", state);
  };

  const handleUndoCommand = (state: AppState): void => {
    if (state.running && state.abortController) {
      state.abortController.abort();
    }
    if (!state.session) {
      return;
    }
    const removed = undoLastTurn(state.db, state.session.id);
    if (removed) {
      state.messages = loadMessages(state.db, state.session.id);
      state.stats = computeStats(state.messages);
      runtime.scrollConversationToBottom();
      runtime.render();
    }
  };

  const handleReasoningCommand = (state: AppState): void => {
    state.showReasoning = !state.showReasoning;
    state.settings = updateSettings(state.settingsPath, {
      showReasoning: state.showReasoning,
    });
    runtime.render();
  };

  const handleVerboseCommand = (state: AppState): void => {
    state.verbose = !state.verbose;
    state.settings = updateSettings(state.settingsPath, {
      verbose: state.verbose,
    });
    runtime.render();
  };

  const performLogin = async (
    provider: OAuthProviderInterface,
    state: AppState,
  ): Promise<void> => {
    runtime.appendInfoMessage(`Logging in to ${provider.name}...`, state);

    const credentials = await provider.login({
      onAuth: (info) => {
        runtime.openInBrowser(info.url);
        runtime.appendInfoMessage(
          info.instructions ?? "Opening browser for login...",
          state,
        );
      },
      onPrompt: () => {
        return Promise.reject(new Error("Manual code input is not supported."));
      },
      onProgress: (message) => {
        runtime.appendInfoMessage(message, state);
      },
    });

    state.oauthCredentials[provider.id] = credentials;
    saveOAuthCredentials(state.oauthCredentials);

    const apiKey = provider.getApiKey(credentials);
    state.providers.set(provider.id, apiKey);

    if (!state.model) {
      const models = getAvailableModels(state);
      if (models.length > 0) {
        state.model = models[0]!;
      }
    }

    runtime.appendInfoMessage(`Logged in to ${provider.name}.`, state);
  };

  const handleLoginCommand = (state: AppState): void => {
    const oauthProviders = getOAuthProviders();
    if (oauthProviders.length === 0) {
      return;
    }

    const items = oauthProviders.map((provider) => {
      const loggedIn = state.oauthCredentials[provider.id] != null;
      const status = loggedIn ? " (logged in)" : "";
      return {
        label: `${provider.name}${status}`,
        value: provider.id,
        filterText: provider.name,
      };
    });

    openSelectOverlay(
      state,
      "Login to a provider",
      items,
      "type to filter providers...",
      (providerId) => {
        runtime.dismissOverlay();
        const provider = oauthProviders.find(
          (entry) => entry.id === providerId,
        );
        if (provider) {
          performLogin(provider, state).catch((err) => {
            runtime.appendInfoMessage(
              `Login failed: ${err instanceof Error ? err.message : String(err)}`,
              state,
            );
          });
        }
      },
    );
  };

  const handleLogoutCommand = (state: AppState): void => {
    const loggedInProviders = getOAuthProviders().filter(
      (provider) => state.oauthCredentials[provider.id] != null,
    );
    if (loggedInProviders.length === 0) {
      return;
    }

    const items = loggedInProviders.map((provider) => ({
      label: provider.name,
      value: provider.id,
      filterText: provider.name,
    }));

    openSelectOverlay(
      state,
      "Logout from a provider",
      items,
      "type to filter providers...",
      (providerId) => {
        delete state.oauthCredentials[providerId];
        saveOAuthCredentials(state.oauthCredentials);
        state.providers.delete(providerId);

        if (state.model && state.model.provider === providerId) {
          state.model = null;
        }

        const provider = loggedInProviders.find(
          (entry) => entry.id === providerId,
        );
        runtime.dismissOverlay();
        runtime.appendInfoMessage(
          `Logged out of ${provider?.name ?? providerId}.`,
          state,
        );
      },
    );
  };

  const handleHelpCommand = (state: AppState): void => {
    runtime.appendInfoMessage(buildHelpText(state), state);
  };

  const handleCommand = (command: string, state: AppState): boolean => {
    switch (command) {
      case "model":
        handleModelCommand(state);
        return true;
      case "effort":
        handleEffortCommand(state);
        return true;
      case "session":
        handleSessionCommand(state);
        return true;
      case "login":
        handleLoginCommand(state);
        return true;
      case "logout":
        handleLogoutCommand(state);
        return true;
      case "new":
        handleNewCommand(state);
        return true;
      case "fork":
        handleForkCommand(state);
        return true;
      case "undo":
        handleUndoCommand(state);
        return true;
      case "reasoning":
        handleReasoningCommand(state);
        return true;
      case "verbose":
        handleVerboseCommand(state);
        return true;
      case "help":
        handleHelpCommand(state);
        return true;
      default:
        return false;
    }
  };

  return {
    applyModelSelection,
    applyEffortSelection,
    showCommandAutocomplete,
    showInputHistoryOverlay,
    handleCommand,
  };
}
