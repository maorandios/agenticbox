"use client";

import * as React from "react";
import Link from "next/link";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import type {
  HumanReviewLabel,
  TextSignalId,
  ZeroInsightAuditCard,
} from "@/server/feed/blind/o5a62-audit-core";

type LabelOption = { id: HumanReviewLabel; he: string };

type ReviewPayload = {
  status: string;
  zeroInsightCount: number;
  summary: {
    byStopReason: Record<string, number>;
    byStage: Record<string, number>;
    byRejection: Record<string, number>;
    modelStopped: number;
    validatorStopped: number;
    possibleFalseNegatives: number;
  };
  actionBias: {
    persistedByType: Record<string, number>;
    assessment: string;
  };
  failedTimeout: {
    threadId: string;
    threadIdMasked?: string;
    subject?: string | null;
    errorCode?: string;
    latencyMs?: number;
    sourceRoute?: string;
    note?: string;
    textSignals?: TextSignalId[];
  } | null;
  cards: ZeroInsightAuditCard[];
  labelOptions: LabelOption[];
  recommendations: string[];
};

const SIGNAL_HE: Record<TextSignalId, string> = {
  response_request: "בקשה/שאלה לתגובה",
  approval_or_review_request: "בקשת אישור/בדיקה",
  participant_commitment: "התחייבות משתתף",
  reported_decision: "החלטה שהתקבלה",
  state_change: "שינוי מצב",
  deadline_or_due: "מועד/דדליין",
  delay_fault_or_exception: "עיכוב/תקלה/חריגה",
  new_business_document_or_version: "מסמך/גרסה עסקית",
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function O5a62ReviewPage() {
  const [data, setData] = React.useState<ReviewPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/feed/review/o5a6", {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `http_${res.status}`);
        }
        const json = (await res.json()) as ReviewPayload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveLabel(threadId: string, label: HumanReviewLabel) {
    setBusyId(threadId);
    try {
      const res = await fetch("/api/feed/review/o5a6/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, label }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `http_${res.status}`);
      }
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.threadId === threadId ? { ...c, humanLabel: label } : c,
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "label_failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SecondaryShell title="סקירת Zero Insight — O5A.6.2">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6"
        dir="rtl"
      >
        <header className="border-b border-[var(--border)] pb-4">
          <p className="text-xs tracking-wide text-[var(--muted)]">
            פיתוח בלבד · read-only · לא כותב ל־feed_items
          </p>
          <h1 className="mt-1 text-2xl font-medium text-[var(--foreground)]">
            O5A.6.2 — סקירת Zero Insight
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            סמנו לכל שרשור האם נכון שלא הופיע בפיד, או איזו תובנה חסרה. הבחירה
            נשמרת בקובץ evaluation בלבד.
          </p>
        </header>

        {error ? (
          <p className="rounded-[12px] border border-[var(--border)] px-3 py-2 text-sm">
            שגיאה: {error}
          </p>
        ) : null}

        {!data ? (
          <p className="text-sm text-[var(--muted)]">טוען…</p>
        ) : (
          <>
            <section className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-[12px] border border-[var(--border)] px-3 py-3">
                <div>Zero insights: {data.zeroInsightCount}</div>
                <div>נעצרו במודל: {data.summary.modelStopped}</div>
                <div>
                  נעצרו ב־validator/safety/evidence:{" "}
                  {data.summary.validatorStopped}
                </div>
                <div>
                  possible FN (heuristic):{" "}
                  {data.summary.possibleFalseNegatives}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--border)] px-3 py-3">
                <div className="font-medium">הטיית Actions</div>
                <div dir="ltr" className="mt-1 text-xs">
                  {JSON.stringify(data.actionBias.persistedByType)}
                </div>
                <p className="mt-2 text-[var(--muted)]">
                  {data.actionBias.assessment}
                </p>
              </div>
            </section>

            {data.failedTimeout ? (
              <section className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-4">
                <h2 className="text-base font-medium">Timeout נפרד</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {data.failedTimeout.note}
                </p>
                <p className="mt-2 text-sm">
                  {data.failedTimeout.threadIdMasked ??
                    data.failedTimeout.threadId}{" "}
                  · {data.failedTimeout.subject ?? "—"} ·{" "}
                  {data.failedTimeout.errorCode} · {data.failedTimeout.latencyMs}
                  ms
                </p>
                {data.failedTimeout.sourceRoute ? (
                  <Link
                    className="mt-2 inline-block text-sm underline"
                    href={data.failedTimeout.sourceRoute}
                  >
                    פתח שרשור
                  </Link>
                ) : null}
              </section>
            ) : null}

            <div className="flex flex-col gap-5">
              {data.cards.map((card) => (
                <article
                  key={card.threadId}
                  className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2
                        className="text-lg font-medium"
                        dir="auto"
                        style={{ unicodeBidi: "plaintext" }}
                      >
                        {card.subject || "(ללא נושא)"}
                      </h2>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        <bdi>{card.threadIdMasked}</bdi>
                      </p>
                    </div>
                    <Link
                      href={card.sourceRoute}
                      className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-sm"
                    >
                      פתח שרשור מלא
                    </Link>
                  </div>

                  <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[var(--muted)]">שולח</dt>
                      <dd dir="auto" style={{ unicodeBidi: "plaintext" }}>
                        {card.fromName ?? "—"}{" "}
                        <bdi>&lt;{card.fromEmail ?? "—"}&gt;</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">נמענים</dt>
                      <dd dir="auto" style={{ unicodeBidi: "plaintext" }}>
                        {card.toEmails.length
                          ? card.toEmails.join(", ")
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">תאריך אחרון</dt>
                      <dd>
                        <bdi>{formatWhen(card.lastMessageAt)}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">כיוון</dt>
                      <dd>{card.direction ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">prefilter</dt>
                      <dd>{card.prefilterClassification ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">model class</dt>
                      <dd>{card.modelThreadClassification ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">שלב סינון</dt>
                      <dd>
                        {card.filterStage} / {card.stopReason}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">candidates</dt>
                      <dd>
                        {card.rawCandidateCount} · {card.candidatesNote}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3">
                    <div className="text-xs text-[var(--muted)]">
                      CURRENT_MESSAGE
                    </div>
                    <pre
                      className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-[10px] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      dir="auto"
                      style={{ unicodeBidi: "plaintext" }}
                    >
                      {card.currentMessageClean || "(ריק)"}
                    </pre>
                  </div>

                  <div className="mt-3 text-sm">
                    <div className="text-[var(--muted)]">rejection reasons</div>
                    <div>
                      {card.rejectionReasons.length
                        ? card.rejectionReasons.join(", ")
                        : "—"}
                    </div>
                    <div className="mt-2 text-[var(--muted)]">
                      אותות בטקסט (לא כרטיס אוטומטי)
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {card.textSignals.length ? (
                        card.textSignals.map((s) => (
                          <span
                            key={s}
                            className="rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-xs"
                          >
                            {SIGNAL_HE[s] ?? s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-[var(--muted)]">
                          לא זוהו אותות
                        </span>
                      )}
                    </div>
                    {card.possibleFalseNegative ? (
                      <p className="mt-2 text-sm">
                        סימון heuristic: possible FN · הצעה:{" "}
                        {card.suggestedMissingInsightType}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t border-[var(--border)] pt-3">
                    <div className="mb-2 text-sm font-medium">
                      Human Review
                      {card.humanLabel ? (
                        <span className="mr-2 font-normal text-[var(--muted)]">
                          (נוכחי:{" "}
                          {data.labelOptions.find(
                            (o) => o.id === card.humanLabel,
                          )?.he ?? card.humanLabel}
                          )
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {data.labelOptions.map((opt) => {
                        const active = card.humanLabel === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={busyId === card.threadId}
                            onClick={() => saveLabel(card.threadId, opt.id)}
                            className={
                              active
                                ? "rounded-[10px] border border-[var(--foreground)] bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)]"
                                : "rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-sm"
                            }
                          >
                            {opt.he}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <section className="rounded-[12px] border border-[var(--border)] px-4 py-4 text-sm">
              <h2 className="font-medium">המלצות כלליות</h2>
              <ul className="mt-2 list-disc pr-5">
                {data.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-4 font-medium">{data.status}</p>
            </section>
          </>
        )}
      </div>
    </SecondaryShell>
  );
}
