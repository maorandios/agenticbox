"use client";

import * as React from "react";
import Link from "next/link";
import {
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import type { SearchAnswerDto, SearchSourceDto } from "@/types/search";

const SUGGESTIONS = [
  "מה דורש ממני טיפול?",
  "אילו מועדים השתנו לאחרונה?",
  "מה הוחלט השבוע?",
  "עם מי עדיין לא נסגר הנושא?",
] as const;

const LOADING_STEPS = [
  "מחפש במיילים…",
  "בודק מקורות רלוונטיים…",
  "מכין תשובה…",
] as const;

/** Client hard stop — slightly above server Onyx timeout so the UI never spins for minutes. */
const ASK_CLIENT_TIMEOUT_MS = 130_000;

type UiState =
  | "initial"
  | "loading"
  | "answered"
  | "insufficient"
  | "error"
  | "no_indexed"
  | "no_account"
  | "offline";

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function SourceCard({ source }: { source: SearchSourceDto }) {
  return (
    <article className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
        <span className="bidi-content" dir="auto">
          {source.title}
        </span>
      </h3>
      <div className="mt-1 space-y-0.5 text-[12px] text-[var(--text-secondary)]">
        {source.senderNames[0] || source.senderEmails[0] ? (
          <div>
            <bdi>
              {source.senderNames[0] || source.senderEmails[0]}
              {source.senderEmails[0] ? ` · ${source.senderEmails[0]}` : ""}
            </bdi>
          </div>
        ) : null}
        <div>
          {formatWhen(source.lastMessageAt)} · {source.messageCount} הודעות
        </div>
      </div>
      {source.snippet ? (
        <p className="bidi-content mt-2 line-clamp-3 text-[13px] text-[var(--text-secondary)]" dir="auto">
          {source.snippet}
        </p>
      ) : null}
      <Link
        href={source.sourceUrl}
        className="mt-3 inline-flex rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
      >
        פתח מקור
      </Link>
    </article>
  );
}

export function AskSearchPage() {
  const [question, setQuestion] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");
  const [ui, setUi] = React.useState<UiState>("initial");
  const [loadingStep, setLoadingStep] = React.useState(0);
  const [answer, setAnswer] = React.useState<SearchAnswerDto | null>(null);
  const [chatSessionId, setChatSessionId] = React.useState<string | null>(null);
  const abortRef = React.useRef(0);

  React.useEffect(() => {
    if (ui !== "loading") return;
    const id = window.setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 4500);
    return () => window.clearInterval(id);
  }, [ui]);

  async function ask(nextQuestion: string, sessionId: string | null) {
    const q = nextQuestion.trim();
    if (!q || ui === "loading") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setUi("offline");
      return;
    }

    const token = ++abortRef.current;
    setLoadingStep(0);
    setUi("loading");
    setAnswer(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ASK_CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/search/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          chatSessionId: sessionId,
        }),
        signal: controller.signal,
      });
      if (token !== abortRef.current) return;

      if (res.status === 401) {
        setUi("error");
        setAnswer({
          status: "failed",
          answer: "פג תוקף ההתחברות. התחברו מחדש והמשיכו.",
          chatSessionId: null,
          requestId: "local",
          latencyMs: 0,
          sources: [],
          errorCode: "session_expired",
        });
        return;
      }

      const data = (await res.json()) as SearchAnswerDto;
      if (token !== abortRef.current) return;
      setAnswer(data);
      setChatSessionId(data.chatSessionId);
      if (data.status === "answered") setUi("answered");
      else if (data.status === "insufficient_evidence") setUi("insufficient");
      else if (data.status === "no_indexed_data") setUi("no_indexed");
      else if (data.status === "no_account") setUi("no_account");
      else setUi("error");
      setQuestion("");
      setFollowUp("");
    } catch (error) {
      if (token !== abortRef.current) return;
      const timedOut =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      if (timedOut) {
        setUi("error");
        setAnswer({
          status: "failed",
          answer: "החיפוש ארך יותר מדי זמן. נסו שאלה ממוקדת יותר או נסו שוב בעוד רגע.",
          chatSessionId: sessionId,
          requestId: "local",
          latencyMs: ASK_CLIENT_TIMEOUT_MS,
          sources: [],
          errorCode: "timeout",
        });
        return;
      }
      setUi("offline");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function resetSearch() {
    abortRef.current += 1;
    setChatSessionId(null);
    setAnswer(null);
    setQuestion("");
    setFollowUp("");
    setUi("initial");
  }

  const showComposer = ui === "initial" || ui === "no_indexed" || ui === "no_account";

  return (
    <SecondaryShell title="שאל">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
              {ui === "initial" ? "מה תרצה לדעת?" : "שאל"}
            </h1>
            <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
              שאלות על המיילים העסקיים המאונדקסים · מקורות מאומתים בלבד
            </p>
          </div>
          {ui !== "initial" ? (
            <button
              type="button"
              onClick={resetSearch}
              className="inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              <RefreshCw className="size-4" strokeWidth={1.75} />
              חיפוש חדש
            </button>
          ) : null}
        </div>

        {showComposer ? (
          <div className="mt-8">
            <label className="sr-only" htmlFor="ask-input">
              שאלה
            </label>
            <div className="rounded-[20px] border border-[var(--border)] bg-white p-3 shadow-[0_1px_0_var(--border)]">
              <textarea
                id="ask-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                placeholder="שאלו שאלה על המיילים שלכם…"
                className="w-full resize-none bg-transparent px-2 py-2 text-[16px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question, null);
                  }
                }}
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!question.trim()}
                  onClick={() => void ask(question, null)}
                  className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--action-primary)] px-4 py-2.5 text-[14px] font-medium text-[var(--action-on-primary)] disabled:opacity-50"
                >
                  <Sparkles className="size-4" strokeWidth={1.75} />
                  שאל
                </button>
              </div>
            </div>

            {ui === "initial" ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s, null)}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {ui === "no_indexed" ? (
              <p className="mt-4 text-[14px] text-[var(--text-secondary)]">
                עדיין אין מספיק מיילים מאונדקסים. השלימו סנכרון ואינדוקס בהגדרות.
              </p>
            ) : null}
            {ui === "no_account" ? (
              <p className="mt-4 text-[14px] text-[var(--text-secondary)]">
                אין חשבון מייל מחובר.{" "}
                <Link href="/settings" className="underline">
                  להגדרות
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {ui === "loading" ? (
          <div className="mt-10 flex items-center gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-5 text-[15px] text-[var(--text-primary)]">
            <LoaderCircle className="size-5 animate-spin" strokeWidth={1.75} />
            {LOADING_STEPS[loadingStep]}
          </div>
        ) : null}

        {ui === "offline" ? (
          <p className="mt-8 text-[14px] text-[var(--text-secondary)]">
            אין חיבור לרשת. בדקו את החיבור ונסו שוב.
          </p>
        ) : null}

        {(ui === "answered" ||
          ui === "insufficient" ||
          ui === "error") &&
        answer ? (
          <div className="mt-8 space-y-6">
            <section className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
              <div className="mb-3 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                <MessageCircleQuestion className="size-4" strokeWidth={1.75} />
                תשובה
              </div>
              <div
                className="bidi-content whitespace-pre-wrap text-[16px] leading-7 text-[var(--text-primary)]"
                dir="auto"
              >
                {answer.answer}
              </div>
            </section>

            {answer.sources.length > 0 ? (
              <section>
                <h2 className="mb-3 text-[15px] font-semibold text-[var(--text-primary)]">
                  מקורות לתשובה
                </h2>
                <div className="grid gap-3">
                  {answer.sources.map((source) => (
                    <SourceCard key={source.id} source={source} />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-[20px] border border-[var(--border)] bg-white p-3">
              <textarea
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                rows={2}
                placeholder="שאלו שאלת המשך…"
                className="w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(followUp, chatSessionId);
                  }
                }}
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!followUp.trim()}
                  onClick={() => void ask(followUp, chatSessionId)}
                  className="rounded-[12px] bg-[var(--action-primary)] px-4 py-2 text-[14px] font-medium text-[var(--action-on-primary)] disabled:opacity-50"
                >
                  המשך
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </SecondaryShell>
  );
}
