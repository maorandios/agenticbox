/**
 * Request speech-act classification — general rules only (no golden hardcodes).
 */

export type RequestSpeechAct =
  | "directive"
  | "permission_request"
  | "commitment"
  | "status_change"
  | "information"
  | "uncertain";

const PERMISSION_REQUEST =
  /אם אתה מאשר(?:ת)? לי|אם אפשר(?:י)? לי|מאשר לי (?:לשנות|להוסיף|לציין|לעדכן)|may I |can I (?:add|change|update)/i;

const DIRECTIVE =
  /(?:^|[\s,.;:])(?:נא|בבקשה|please)\b|תעדכן אותי|תבדוק|תענה|תשלח|תאשר|תטפל|חסר\s+\S{2,}|נא\s+לאשר|נא\s+לשלוח|please\s+(?:approve|send|check|update)/i;

const COMMITMENT =
  /אני (?:אשלח|אטפל|אאשר|אבדוק)|I'll |I will |we will /i;

const STATUS_CHANGE =
  /השתנה מ-|changed from|עלה ל-|ירד ל-|עודכן ל-|המחיר|הכמות|הסטטוס/i;

const REPORTED_DECISION =
  /(?:^|[\s])(?:אישר|אושרה?|דחה|נדחתה|החליט)\s/i;

/** Evidence in CURRENT_MESSAGE that a request speech act is present. */
export function hasRequestEvidenceInCurrentMessage(
  body: string,
  evidenceText: string,
): boolean {
  const text = `${evidenceText}\n${body}`;
  return (
    PERMISSION_REQUEST.test(text) ||
    DIRECTIVE.test(text) ||
    COMMITMENT.test(text) ||
    /\?/.test(evidenceText)
  );
}

export function classifyRequestSpeechAct(opts: {
  body: string;
  evidenceText: string;
  requestModality?: string | null;
  type?: string | null;
}): RequestSpeechAct {
  const text = `${opts.evidenceText}\n${opts.body}`;

  if (PERMISSION_REQUEST.test(text)) return "permission_request";
  if (DIRECTIVE.test(text)) return "directive";
  if (
    opts.requestModality === "commitment" ||
    COMMITMENT.test(text)
  ) {
    return "commitment";
  }
  if (STATUS_CHANGE.test(text)) return "status_change";
  if (
    REPORTED_DECISION.test(text) &&
    !PERMISSION_REQUEST.test(text) &&
    !DIRECTIVE.test(text)
  ) {
    return "status_change";
  }
  if (
    opts.requestModality === "information_only" ||
    opts.type === "decision"
  ) {
    return "information";
  }
  return "uncertain";
}

export function speechActAllowsActionCoercion(
  act: RequestSpeechAct,
): boolean {
  return (
    act === "directive" ||
    act === "permission_request" ||
    act === "commitment"
  );
}

/**
 * General requestedAction refinement from CURRENT_MESSAGE — no golden IDs/names.
 */
export function refineRequestedAction(opts: {
  body: string;
  action: string;
  speechAct: RequestSpeechAct;
  requesterDisplayName: string | null;
}): string {
  const bodyNorm = opts.body.replace(/\s+/g, " ").trim();
  const action = opts.action.trim();
  const who =
    opts.requesterDisplayName?.trim().split(/\s+/)[0] || "המבקש/ת";

  // Missing deliverable directed at recipient → send/complete the missing item.
  const missing = bodyNorm.match(/חסר\s+([^\n.!?،,]{2,80})/i);
  if (missing && opts.speechAct === "directive") {
    const obj = missing[1]!.trim().replace(/\s+/g, " ");
    if (obj && !/^לשלוח/.test(action)) {
      return `לשלוח את ${obj} החסר`;
    }
  }

  // Permission to change/add a caption or label on a document — not document approval.
  if (opts.speechAct === "permission_request") {
    const quoted = bodyNorm.match(/[«"“”']([^«"“”']{2,80})[»"“”']/);
    if (quoted && /(?:להוסיף|לציין|לשנות|כתוב|כיתוב)/i.test(bodyNorm)) {
      return `לאשר ל${who} לציין על המסמך "${quoted[1]!.trim()}"`;
    }
    const writeOn = bodyNorm.match(/כתוב על ([^\n.!?،,]{2,80})/i);
    if (writeOn && /(?:מאשר|לאשר|להוסיף|לציין|לשנות)/i.test(bodyNorm)) {
      return `לאשר ל${who} לציין על ${writeOn[1]!.trim()}`;
    }
    if (/(?:להוסיף|לשנות|לציין).{0,40}(?:כיתוב|כתוב)/i.test(bodyNorm)) {
      return `לאשר ל${who} לשנות את הכיתוב במסמך`;
    }
  }

  return action;
}
