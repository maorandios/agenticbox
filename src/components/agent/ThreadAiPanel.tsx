"use client";

import * as React from "react";
import {
  Astroid,
  ChevronLeft,
  CircleHelp,
  CircleX,
  MessageSquare,
  Pin,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCompactMessageStamp, formatMessageDateTime } from "@/lib/format";
import {
  askThreadQuestion,
  getMessageById,
  getMessagesForThread,
  getParticipant,
} from "@/mocks";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace, type ThreadAskSession } from "@/state/workspace";
import type { ThreadAskTurn } from "@/types/domain";

const EMPTY_SESSION: ThreadAskSession = {
  turns: [],
  draft: "",
  focusedMessageId: null,
  scrollTop: 0,
  generating: false,
};

function countLines(text: string) {
  return text.split(/\n/).length + Math.floor(text.length / 52);
}

function AnswerBody({ turn }: { turn: ThreadAskTurn }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = countLines(turn.answer) > 8;
  const showClamped = long && !expanded;

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-1.5">
        {turn.kind === "clarification" ? (
          <CircleHelp
            className="size-3.5 shrink-0 text-[var(--text-secondary)]"
            strokeWidth={1.75}
          />
        ) : (
          <Sparkles
            className="size-3.5 shrink-0 text-[var(--text-secondary)]"
            strokeWidth={1.75}
          />
        )}
        <span className="text-[11.5px] font-semibold text-[var(--text-secondary)]">
          {turn.kind === "clarification" ? "הבהרה" : "תשובה"}
        </span>
      </div>
      <p
        className={cn(
          "text-[13px] leading-[1.6] text-[var(--text-primary)]",
          showClamped && "line-clamp-8",
          (turn.kind === "not_found" || turn.kind === "file_not_analyzed") &&
            "text-[var(--text-secondary)]",
        )}
      >
        <span className="bidi-content" dir="auto">
          {turn.answer}
        </span>
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {expanded ? "הצג פחות" : "הצג תשובה מלאה"}
        </button>
      ) : null}
    </div>
  );
}

export function ThreadAiPanel({ threadId }: { threadId: string }) {
  const { state, dispatch } = useWorkspace();
  const session = state.threadAskByThreadId[threadId] ?? EMPTY_SESSION;
  const messages = getMessagesForThread(threadId);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollTopRef = React.useRef(session.scrollTop);
  const genTimerRef = React.useRef<number | null>(null);
  const pendingQuestionRef = React.useRef<string | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const focusedMessage = session.focusedMessageId
    ? getMessageById(session.focusedMessageId)
    : null;
  const focusedSender = focusedMessage
    ? getParticipant(focusedMessage.fromId)
    : null;

  React.useEffect(() => {
    inputRef.current?.focus();
  }, [state.threadAskFocusToken, threadId]);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = session.scrollTop || 0;
    scrollTopRef.current = session.scrollTop || 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  React.useEffect(() => {
    return () => {
      dispatch({
        type: "SET_THREAD_ASK_SCROLL",
        threadId,
        scrollTop: scrollTopRef.current,
      });
    };
  }, [dispatch, threadId]);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (session.turns.length > 0 || session.generating) {
      el.scrollTop = el.scrollHeight;
    }
  }, [session.turns.length, session.generating]);

  React.useEffect(() => {
    return () => {
      if (genTimerRef.current) window.clearTimeout(genTimerRef.current);
    };
  }, []);

  const [inputMultiline, setInputMultiline] = React.useState(false);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "24px";
    const next = Math.min(100, Math.max(24, el.scrollHeight));
    el.style.height = `${next}px`;
    setInputMultiline(next > 36);
  };

  React.useEffect(() => {
    resizeInput();
  }, [session.draft]);

  const stopGenerating = () => {
    if (genTimerRef.current) {
      window.clearTimeout(genTimerRef.current);
      genTimerRef.current = null;
    }
    pendingQuestionRef.current = null;
    dispatch({
      type: "SET_THREAD_ASK_GENERATING",
      threadId,
      generating: false,
    });
  };

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || session.generating) return;
    setError(null);
    pendingQuestionRef.current = q;
    dispatch({ type: "SET_THREAD_ASK_DRAFT", threadId, draft: "" });
    dispatch({ type: "SET_THREAD_ASK_GENERATING", threadId, generating: true });

    const previous = session.turns;
    genTimerRef.current = window.setTimeout(() => {
      genTimerRef.current = null;
      try {
        const finalTurn = askThreadQuestion(threadId, q, previous);
        const turn =
          finalTurn.kind === "answer" && finalTurn.sources.length === 0
            ? {
                ...finalTurn,
                kind: "not_found" as const,
                answer: "לא מצאתי תשובה ברורה בשרשור.",
                sources: [],
              }
            : finalTurn;
        dispatch({ type: "ADD_THREAD_ASK_TURN", turn });
        pendingQuestionRef.current = null;
      } catch {
        dispatch({
          type: "SET_THREAD_ASK_GENERATING",
          threadId,
          generating: false,
        });
        setError("לא הצלחתי לענות כרגע");
      }
    }, 700);
  };

  const showSource = (messageId: string) => {
    dispatch({ type: "HIGHLIGHT_MESSAGE", messageId });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" aria-label="מה תרצו לדעת">
      <div className="sticky top-0 z-10 shrink-0 border-b border-[var(--border)] bg-white px-[14px] py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Astroid
                className="size-4 shrink-0 text-[var(--text-secondary)]"
                strokeWidth={1.75}
              />
              <h3 className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
                מה תרצו לדעת?
              </h3>
            </div>
            <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
              מבוסס על {messages.length} הודעות בשיחה זו
            </p>
          </div>

          {session.turns.length > 0 ? (
            <Popover open={clearOpen} onOpenChange={setClearOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="נקה היסטוריית שאלות"
                      className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    >
                      <RotateCcw className="size-4" strokeWidth={1.75} />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>נקה שיחה</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-[240px] p-3">
                <p className="text-[13px] text-[var(--text-primary)]">
                  לנקות את היסטוריית השאלות?
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setClearOpen(false)}
                    className="rounded-[8px] px-2.5 py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: "CLEAR_THREAD_ASK", threadId });
                      setClearOpen(false);
                    }}
                    className="rounded-[8px] bg-[var(--action-primary)] px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-[var(--action-primary-hover)]"
                  >
                    נקה
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="חזרה לתובנות"
                onClick={() => {
                  dispatch({
                    type: "SET_THREAD_ASK_SCROLL",
                    threadId,
                    scrollTop: scrollTopRef.current,
                  });
                  dispatch({ type: "CLOSE_THREAD_AI" });
                }}
                className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <CircleX className="size-4" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>חזרה לתובנות</TooltipContent>
          </Tooltip>
        </div>

        {focusedMessage ? (
          <div className="mt-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5">
            <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11.5px] text-[var(--text-secondary)]">
              <Pin
                className="size-3.5 shrink-0 text-[var(--text-muted)]"
                strokeWidth={1.75}
              />
              <span className="truncate">
                ההודעה של <bdi>{focusedSender?.name ?? "לא ידוע"}</bdi>
                {" · "}
                {formatCompactMessageStamp(focusedMessage.sentAt)}
              </span>
            </p>
            <button
              type="button"
              aria-label="הסר מיקוד"
              onClick={() =>
                dispatch({
                  type: "SET_THREAD_ASK_FOCUSED_MESSAGE",
                  threadId,
                  messageId: null,
                })
              }
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-white hover:text-[var(--text-primary)]"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={listRef}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto px-[14px] py-3"
        onScroll={(e) => {
          scrollTopRef.current = e.currentTarget.scrollTop;
        }}
      >
        <div className="flex min-h-full flex-col justify-end gap-3">
          {session.turns.length === 0 && !session.generating ? null : (
            <>
              {session.turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[88%] rounded-[14px] bg-[var(--surface-hover)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--text-primary)]">
                      <span className="bidi-content" dir="auto">
                        {turn.question}
                      </span>
                    </div>
                  </div>

                  <div className="w-full space-y-2">
                    <AnswerBody turn={turn} />

                    {turn.kind === "clarification" &&
                    turn.clarificationOptions?.length ? (
                      <div className="space-y-1.5">
                        {turn.clarificationOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => ask(option)}
                            className="flex h-[34px] w-full items-center rounded-[10px] border border-[var(--border)] bg-white px-3 text-right text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {turn.sources.length > 0 ? (
                      <div className="space-y-1 pt-1">
                        <p className="text-[11px] font-semibold text-[var(--text-muted)]">
                          מקורות
                        </p>
                        {turn.sources.map((source) => (
                          <button
                            key={`${turn.id}-${source.messageId}`}
                            type="button"
                            onClick={() => showSource(source.messageId)}
                            className="flex w-full items-start gap-2 rounded-[10px] px-2 py-2 text-start transition-colors hover:bg-[var(--surface-hover)]"
                          >
                            <MessageSquare
                              className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]"
                              strokeWidth={1.75}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-[var(--text-secondary)]">
                                <span className="font-semibold text-[var(--text-primary)]">
                                  <bdi>{source.senderName}</bdi>
                                </span>
                                <time dateTime={source.sentAt}>
                                  {formatMessageDateTime(source.sentAt)}
                                </time>
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">
                                <span className="bidi-content" dir="auto">
                                  {source.excerpt}
                                </span>
                              </span>
                            </span>
                            <ChevronLeft
                              className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]"
                              strokeWidth={1.75}
                            />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {session.generating ? (
                <div className="flex items-center justify-between gap-2 py-1 text-[13px] text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-0.5">
                    בודק את השרשור
                    <span className="ask-loading-dots" aria-hidden>
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={stopGenerating}
                    className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] hover:bg-[var(--surface-hover)]"
                  >
                    <Square className="size-3" strokeWidth={1.75} />
                    עצור
                  </button>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
                  <p className="text-[13px] text-[var(--text-secondary)]">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      const q = pendingQuestionRef.current;
                      setError(null);
                      if (q) ask(q);
                    }}
                    className="mt-1.5 text-[12.5px] font-medium text-[var(--text-primary)] hover:underline"
                  >
                    נסה שוב
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] bg-white px-[14px] py-3">
        <div
          className={cn(
            "flex min-h-[44px] gap-1.5 border border-[var(--border)] bg-white px-2 transition-[border-radius] duration-150",
            inputMultiline
              ? "items-end rounded-[18px] py-1.5"
              : "items-center rounded-[var(--radius-pill)]",
          )}
        >
          <textarea
            ref={inputRef}
            value={session.draft}
            rows={1}
            onChange={(e) =>
              dispatch({
                type: "SET_THREAD_ASK_DRAFT",
                threadId,
                draft: e.target.value,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(session.draft);
              }
            }}
            placeholder="כתבו פה את השאלה שלכם"
            className="max-h-[100px] min-h-[24px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-[10px] text-[13px] leading-[24px] outline-none placeholder:text-[var(--text-muted)] [scrollbar-width:thin]"
            dir="rtl"
          />
          {session.generating ? (
            <button
              type="button"
              aria-label="עצור"
              onClick={stopGenerating}
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--text-primary)]",
                inputMultiline ? "mb-0.5" : "self-center",
              )}
            >
              <Square className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="שאל"
              disabled={!session.draft.trim()}
              onClick={() => ask(session.draft)}
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-35",
                inputMultiline ? "mb-0.5" : "self-center",
              )}
            >
              <SendHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-[1.4] text-[var(--text-muted)]">
          מבוסס על גוף ההודעות בלבד · קבצים מצורפים אינם נכללים
        </p>
      </div>
    </div>
  );
}
