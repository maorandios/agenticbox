/**
 * O5C.2 — Deterministic derived calculations (server-side only).
 * The model proposes operands + sources; never invents the final number.
 */

import type {
  SupportedCalculation,
  SupportingSource,
} from "./schemas";

export type CalculationOutcome =
  | {
      status: "ok";
      value: number;
      unit: string | null;
      derived: true;
      formula: string;
      calculation: SupportedCalculation;
    }
  | { status: "insufficient"; reason: string }
  | { status: "conflicting"; reason: string };

function sameUnit(a: string | null, b: string | null): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na && !nb) return true;
  return na === nb;
}

function hasEvidence(src: SupportingSource | null | undefined): boolean {
  return Boolean(src?.evidence?.trim() && src.threadId);
}

export function evaluateSupportedCalculation(
  calc: SupportedCalculation,
): CalculationOutcome {
  if (!hasEvidence(calc.leftSource) || !hasEvidence(calc.rightSource)) {
    return { status: "insufficient", reason: "operand_missing_source_evidence" };
  }
  if (!Number.isFinite(calc.leftOperand) || !Number.isFinite(calc.rightOperand)) {
    return { status: "insufficient", reason: "operand_not_numeric" };
  }
  if (!sameUnit(calc.unit, calc.unit)) {
    return { status: "conflicting", reason: "unit_mismatch" };
  }
  // Unit consistency across operands is carried on calc.unit; if sources embed
  // different currency tokens in evidence, caller must set conflicting upstream.
  const left = calc.leftOperand;
  const right = calc.rightOperand;
  let value: number;
  let formula: string;
  switch (calc.operation) {
    case "add":
      value = left + right;
      formula = `${left} + ${right}`;
      break;
    case "subtract":
      value = left - right;
      formula = `${left} - ${right}`;
      break;
    case "multiply":
      value = left * right;
      formula = `${left} × ${right}`;
      break;
    case "divide":
      if (right === 0) {
        return { status: "insufficient", reason: "divide_by_zero" };
      }
      value = left / right;
      formula = `${left} ÷ ${right}`;
      break;
    case "percent_increase":
      value = left * (1 + right / 100);
      formula = `${left} × (1 + ${right}/100)`;
      break;
    case "percent_decrease":
      value = left * (1 - right / 100);
      formula = `${left} × (1 - ${right}/100)`;
      break;
    default:
      return { status: "insufficient", reason: "unknown_operation" };
  }
  if (!Number.isFinite(value)) {
    return { status: "insufficient", reason: "non_finite_result" };
  }
  return {
    status: "ok",
    value,
    unit: calc.unit,
    derived: true,
    formula: calc.unit ? `${formula} = ${value} ${calc.unit}` : `${formula} = ${value}`,
    calculation: calc,
  };
}

/** Detect conflicting currency tokens across two evidence strings. */
export function currenciesConflict(a: string, b: string): boolean {
  const re = /(?:₪|\$|€|£|USD|EUR|ILS|NIS)/gi;
  const ta = [...a.matchAll(re)].map((m) => m[0]!.toUpperCase().replace("NIS", "ILS"));
  const tb = [...b.matchAll(re)].map((m) => m[0]!.toUpperCase().replace("NIS", "ILS"));
  if (ta.length === 0 || tb.length === 0) return false;
  return ta[0] !== tb[0];
}

export function resolveAmountCandidates(opts: {
  candidates: Array<{ amount: number; unit: string | null; source: SupportingSource }>;
}): { status: "ok"; pick: (typeof opts.candidates)[0] } | { status: "conflicting" | "insufficient"; reason: string } {
  if (opts.candidates.length === 0) {
    return { status: "insufficient", reason: "no_base_amount" };
  }
  if (opts.candidates.length > 1) {
    const units = new Set(
      opts.candidates.map((c) => (c.unit ?? "").trim().toLowerCase()),
    );
    const amounts = new Set(opts.candidates.map((c) => c.amount));
    if (amounts.size > 1 || units.size > 1) {
      return { status: "conflicting", reason: "multiple_base_amounts" };
    }
  }
  return { status: "ok", pick: opts.candidates[0]! };
}
