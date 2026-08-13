/**
 * O5C.2/O5C.3 — Attribution and speech-act guards for context resolution.
 */

export function assertAttributionBoundaries(opts: {
  triggerRequesterEmail: string | null;
  triggerAssigneeEmail: string | null;
  resolvedItem: {
    requester?: { email?: string | null } | null;
    assignee?: { email?: string | null } | null;
  };
}): boolean {
  const rq = opts.resolvedItem.requester?.email?.toLowerCase() ?? null;
  const as = opts.resolvedItem.assignee?.email?.toLowerCase() ?? null;
  if (
    rq &&
    opts.triggerRequesterEmail &&
    rq !== opts.triggerRequesterEmail.toLowerCase()
  ) {
    return false;
  }
  if (
    as &&
    opts.triggerAssigneeEmail &&
    as !== opts.triggerAssigneeEmail.toLowerCase()
  ) {
    return false;
  }
  return true;
}

export function historicalCannotCreateActionWithoutCurrentSpeechAct(opts: {
  currentSpeechAct: string | null | undefined;
  proposedType: string;
}): boolean {
  if (opts.proposedType !== "action") return true;
  return Boolean(
    opts.currentSpeechAct &&
      [
        "directive",
        "approval_request",
        "response_request",
        "permission_request",
        "implicit_missing_item_request",
        "commitment",
      ].includes(opts.currentSpeechAct),
  );
}
