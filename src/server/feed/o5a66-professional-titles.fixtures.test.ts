/**
 * O5A.6.6 — Professional standalone title normalization fixtures.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyProfessionalTitleGate,
  normalizeProfessionalTitle,
} from "@/server/feed/professional-title";

describe("O5A.6.6 professional titles — must pass", () => {
  it("resolves talk-with-me using requester canonical name (HE)", () => {
    const gate = applyProfessionalTitleGate({
      title: "תציץ בתוכן ותדבר איתי",
      speechAct: "response_request",
      requestEvidence: "אשמח שתציץ בתוכן ותדבר איתי",
      businessObjectEvidence: "התוכן",
      subject: "אשמח שתציץ בתוכן ותדבר איתי",
      body: "מצורף תיאור לסקירה",
      requesterCanonicalName: "Uriel Example",
    });
    expect(gate.status).toBe("ready_for_persist");
    expect(gate.finalTitle).toMatch(/^לעבור על התוכן ולשוחח עם Uriel$/);
    expect(gate.requestEvidenceOriginal).toBe("אשמח שתציץ בתוכן ותדבר איתי");
    expect(gate.checks.noContextDependentPronouns).toBe(true);
    expect(gate.checks.noPolitenessNoise).toBe(true);
  });

  it("download + schedule call — infinitive, no politeness", () => {
    const body = "תוריד את הקבצים בבקשה ובוא נעשה שיחה לגבי זה בבקשה.";
    const gate = applyProfessionalTitleGate({
      title: "תוריד את הקבצים בבקשה ובוא נעשה שיחת",
      speechAct: "directive",
      requestEvidence: body,
      businessObjectEvidence: "הקבצים",
      body,
      requesterCanonicalName: "Peer",
    });
    expect(gate.finalTitle).toBe("להוריד את הקבצים ולתאם שיחה");
    expect(gate.checks.noPolitenessNoise).toBe(true);
    expect(gate.checks.noContextDependentPronouns).toBe(true);
    expect(gate.requestEvidenceOriginal).toContain("בבקשה");
  });

  it("strips trailing וכו׳ without losing work object", () => {
    const lead = "הזמנת ציוד משרדי - לטיפולכם הזנת הזמנה וכו";
    const gate = applyProfessionalTitleGate({
      title: "לטיפולכם הזנת הזמנה וכו",
      speechAct: "directive",
      requestEvidence: lead,
      businessObjectEvidence: "הזנת הזמנה וכו",
      body: lead,
      subject: "FW: PO-9",
      requesterCanonicalName: "Office Peer",
    });
    expect(gate.finalTitle).not.toMatch(/וכו/);
    expect(gate.finalTitle).toMatch(/^לבצע/);
    expect(gate.checks.noTrailingEtc).toBe(true);
    expect(gate.status).toBe("ready_for_persist");
  });

  it("finance EN — pay invoice", () => {
    const body = "Please pay invoice INV-2044 by Friday.";
    const gate = applyProfessionalTitleGate({
      title: "please pay invoice INV-2044",
      speechAct: "directive",
      requestEvidence: body,
      businessObjectEvidence: "invoice INV-2044",
      body,
      requesterCanonicalName: "Finance Bot",
    });
    expect(gate.finalTitle.toLowerCase()).toMatch(/^pay invoice/);
    expect(gate.checks.noPolitenessNoise).toBe(true);
    expect(gate.status).toBe("ready_for_persist");
  });

  it("HR EN — update handbook", () => {
    const body = "Please update the employee handbook section on remote work.";
    const gate = applyProfessionalTitleGate({
      title: "please update the employee handbook",
      speechAct: "directive",
      requestEvidence: body,
      businessObjectEvidence: "employee handbook",
      body,
      requesterCanonicalName: "HR Partner",
    });
    expect(gate.finalTitle.toLowerCase()).toMatch(/^update /);
    expect(gate.status).toBe("ready_for_persist");
  });

  it("procurement HE — approve substitute item", () => {
    const body = "נא לאשר שימוש בפריט חלופי SKU-22";
    const gate = applyProfessionalTitleGate({
      title: "נא לאשר שימוש בפריט חלופי SKU-22",
      speechAct: "approval_request",
      requestEvidence: body,
      businessObjectEvidence: "פריט חלופי SKU-22",
      subject: "החלפת פריט מלאי",
      body,
      requesterCanonicalName: "Buyer Peer",
    });
    expect(gate.finalTitle).toMatch(/^לאשר את/);
    expect(gate.finalTitle).not.toMatch(/נא|בבקשה/);
    expect(gate.requestEvidenceOriginal).toContain("נא לאשר");
  });

  it("service HE — reply about delivery date", () => {
    const body = "נא להשיב ללקוח לגבי מועד האספקה";
    const gate = applyProfessionalTitleGate({
      title: "נא להשיב ללקוח לגבי מועד האספקה",
      speechAct: "response_request",
      requestEvidence: body,
      businessObjectEvidence: "מועד האספקה",
      body,
      requesterCanonicalName: "Support Lead",
    });
    expect(gate.checks.noPolitenessNoise).toBe(true);
    expect(gate.finalTitle).not.toMatch(/\bנא\b/);
  });
});

describe("O5A.6.6 professional titles — must fail / human review", () => {
  it("unresolved pronoun without requester name → needs_human_review", () => {
    const gate = applyProfessionalTitleGate({
      title: "תדבר איתי על התוכן",
      speechAct: "response_request",
      requestEvidence: "תדבר איתי על התוכן",
      businessObjectEvidence: "התוכן",
      body: "תדבר איתי על התוכן",
      requesterCanonicalName: null,
    });
    expect(gate.status).toBe("needs_human_review");
    expect(gate.checks.noContextDependentPronouns).toBe(false);
  });

  it("does not invent object absent from source", () => {
    const norm = normalizeProfessionalTitle({
      draftTitle: "לאשר את פרויקט האפולו",
      speechAct: "approval_request",
      requestEvidence: "אשמח לאישור",
      businessObject: null,
      subject: "בקשה כללית",
      bodyLead: "אשמח לאישור",
      requesterCanonicalName: "Peer",
    });
    expect(norm.title ?? "").not.toMatch(/אפולו/);
  });

  it("evidence quote is never rewritten by the gate", () => {
    const original = "תוריד את הקבצים בבקשה ובוא נעשה שיחה לגבי זה בבקשה.";
    const gate = applyProfessionalTitleGate({
      title: "תוריד את הקבצים בבקשה",
      speechAct: "directive",
      requestEvidence: original,
      businessObjectEvidence: "הקבצים",
      body: original,
      requesterCanonicalName: "Peer",
    });
    expect(gate.requestEvidenceOriginal).toBe(original);
    expect(gate.finalTitle).not.toContain("בבקשה");
  });
});
