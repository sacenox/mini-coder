import * as c from "yoctocolors";

export function buildResumeSessionCommand(sessionId: string): string {
  return `mc -r ${sessionId}`;
}

export function buildResumeSessionHint(
  sessionId: string,
  detail = "to continue this session.",
): string {
  return `${c.dim("Use")} ${c.cyan(buildResumeSessionCommand(sessionId))} ${c.dim(detail)}`;
}

export function buildSessionExitMessage(sessionId: string): string {
  return `${buildResumeSessionHint(sessionId)}\n${c.dim("Goodbye.")}`;
}
