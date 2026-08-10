"use client";

import * as React from "react";
import { Download, ImageOff, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { getRenderableContent } from "@/mocks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/state/workspace";
import type {
  Message,
  MessageContentBlock,
  MessageInlineImageBlock,
} from "@/types/domain";

type QuotedBlockRender = (props: {
  text: string;
  dark: boolean;
}) => React.ReactNode;

type ContentGroup =
  | { kind: "block"; block: MessageContentBlock }
  | { kind: "image-grid"; images: MessageInlineImageBlock[] };

function groupContent(blocks: MessageContentBlock[]): ContentGroup[] {
  const groups: ContentGroup[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "inline-image") {
      const images: MessageInlineImageBlock[] = [];
      while (i < blocks.length && blocks[i].type === "inline-image") {
        images.push(blocks[i] as MessageInlineImageBlock);
        i += 1;
      }
      if (images.length >= 2) {
        groups.push({ kind: "image-grid", images });
      } else {
        groups.push({ kind: "block", block: images[0] });
      }
      continue;
    }
    // Attachments + quoted replies are rendered by MessageBubble (order + progressive disclosure)
    if (block.type === "attachment" || block.type === "quoted-text") {
      i += 1;
      continue;
    }
    groups.push({ kind: "block", block });
    i += 1;
  }
  return groups;
}

function PrivacyBlockedPlaceholder({
  dark,
  onReveal,
  onAlwaysShow,
}: {
  dark: boolean;
  onReveal: () => void;
  onAlwaysShow: () => void;
}) {
  return (
    <div
      className={cn(
        "my-2.5 flex flex-col items-center justify-center gap-2.5 rounded-[12px] px-4 py-8 text-center",
        dark ? "bg-white/8" : "bg-[var(--surface-selected)]",
      )}
    >
      <ImageOff
        className={cn(
          "size-6",
          dark ? "text-white/55" : "text-[var(--text-muted)]",
        )}
        strokeWidth={1.75}
      />
      <p
        className={cn(
          "text-[13px]",
          dark ? "text-white/75" : "text-[var(--text-secondary)]",
        )}
      >
        תמונות חיצוניות נחסמו להגנת הפרטיות
      </p>
      <button
        type="button"
        onClick={onReveal}
        className={cn(
          "rounded-[10px] px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
          dark
            ? "bg-white text-[var(--text-primary)] hover:bg-white/90"
            : "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]",
        )}
      >
        הצג תמונות
      </button>
      <button
        type="button"
        onClick={onAlwaysShow}
        className={cn(
          "text-[12px] underline-offset-2 hover:underline",
          dark ? "text-white/55" : "text-[var(--text-muted)]",
        )}
      >
        הצג תמיד תמונות מהשולח הזה
      </button>
    </div>
  );
}

function ImageErrorState({
  dark,
  fileName,
  alt,
  onRetry,
  onDownload,
}: {
  dark: boolean;
  fileName: string;
  alt?: string;
  onRetry: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className={cn(
        "my-2.5 flex flex-col items-center justify-center gap-2 rounded-[12px] px-4 py-7 text-center",
        dark ? "bg-white/8" : "bg-[var(--surface-selected)]",
      )}
    >
      <ImageOff
        className={cn(
          "size-6",
          dark ? "text-white/55" : "text-[var(--text-muted)]",
        )}
        strokeWidth={1.75}
      />
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-[13px] font-medium",
            dark ? "text-white" : "text-[var(--text-primary)]",
          )}
        >
          <bdi>{fileName}</bdi>
        </p>
        {alt ? (
          <p
            className={cn(
              "mt-0.5 text-[12px]",
              dark ? "text-white/55" : "text-[var(--text-muted)]",
            )}
          >
            {alt}
          </p>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "text-[12.5px] font-medium",
            dark ? "text-white hover:underline" : "text-[var(--text-primary)] hover:underline",
          )}
        >
          נסה שוב
        </button>
        <button
          type="button"
          onClick={onDownload}
          className={cn(
            "text-[12.5px] font-medium",
            dark ? "text-white/70 hover:underline" : "text-[var(--text-secondary)] hover:underline",
          )}
        >
          הורד
        </button>
      </div>
    </div>
  );
}

function InlineImageView({
  image,
  dark,
  senderId,
  compact = false,
  onOpenLightbox,
}: {
  image: MessageInlineImageBlock;
  dark: boolean;
  senderId: string;
  compact?: boolean;
  onOpenLightbox: (image: MessageInlineImageBlock) => void;
}) {
  const { state, dispatch } = useWorkspace();
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(Boolean(image.forceError));
  const [retryToken, setRetryToken] = React.useState(0);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  const alwaysShow = state.alwaysShowImagesFromSenderIds.includes(senderId);
  const revealed = state.revealedExternalImageIds.includes(image.id);
  const blocked = Boolean(image.privacyBlocked) && !revealed && !alwaysShow;

  const src =
    image.forceError && retryToken === 0
      ? image.src
      : image.forceError
        ? `/mock-mail/retry-fallback.jpg?r=${retryToken}`
        : image.src;

  React.useEffect(() => {
    setLoaded(false);
    setFailed(Boolean(image.forceError) && retryToken === 0);
  }, [image.forceError, image.src, retryToken]);

  // Cached images often fire load before React attaches onLoad — sync from complete.
  React.useLayoutEffect(() => {
    const el = imgRef.current;
    if (!el || failed || blocked) return;
    if (el.complete && el.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src, retryToken, failed, blocked]);

  if (blocked) {
    return (
      <PrivacyBlockedPlaceholder
        dark={dark}
        onReveal={() =>
          dispatch({ type: "REVEAL_EXTERNAL_IMAGE", imageId: image.id })
        }
        onAlwaysShow={() => {
          dispatch({ type: "ALWAYS_SHOW_IMAGES_FROM_SENDER", senderId });
          dispatch({ type: "REVEAL_EXTERNAL_IMAGE", imageId: image.id });
        }}
      />
    );
  }

  if (failed) {
    return (
      <ImageErrorState
        dark={dark}
        fileName={image.fileName}
        alt={image.alt}
        onRetry={() => {
          setFailed(false);
          setLoaded(false);
          setRetryToken((n) => n + 1);
        }}
        onDownload={() => toast(`הורדה מדומה — ${image.fileName}`)}
      />
    );
  }

  return (
    <div
      className={cn(
        "group/img relative overflow-hidden rounded-[12px]",
        compact
          ? "my-0 aspect-[4/3] bg-[var(--surface-selected)]"
          : "my-2.5 bg-[var(--surface-selected)]",
        dark && "bg-white/10",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`${image.id}-${retryToken}`}
        ref={imgRef}
        src={src}
        alt={image.alt ?? image.fileName}
        loading="eager"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          setLoaded(false);
        }}
        onClick={() => onOpenLightbox(image)}
        className={cn(
          "relative z-[1] block w-full max-w-full cursor-zoom-in object-contain",
          compact ? "h-full object-cover" : "h-auto",
        )}
      />
      {!loaded ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[2] animate-pulse",
            dark ? "bg-white/12" : "bg-[var(--surface-hover)]",
          )}
          aria-hidden
        />
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex justify-end gap-1 p-2 opacity-0 transition-opacity duration-[120ms] group-hover/img:pointer-events-auto group-hover/img:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="הצג בגודל מלא"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLightbox(image);
              }}
              className="inline-flex size-8 items-center justify-center rounded-[8px] bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
            >
              <Maximize2 className="size-4" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>הצג בגודל מלא</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="הורד תמונה"
              onClick={(e) => {
                e.stopPropagation();
                toast(`הורדה מדומה — ${image.fileName}`);
              }}
              className="inline-flex size-8 items-center justify-center rounded-[8px] bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
            >
              <Download className="size-4" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>הורד תמונה</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ParagraphBlock({
  text,
  dark,
}: {
  text: string;
  dark: boolean;
}) {
  return (
    <div
      className={cn(
        "bidi-content whitespace-pre-wrap text-[15px] leading-[1.7]",
        dark && "[&_a]:text-white [&_a]:underline-offset-2 hover:[&_a]:underline",
      )}
      dir="auto"
    >
      {text}
    </div>
  );
}

function ListBlock({
  items,
  ordered,
  dark,
}: {
  items: string[];
  ordered?: boolean;
  dark: boolean;
}) {
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag
      className={cn(
        "bidi-content my-2 list-inside space-y-1 text-[15px] leading-[1.7]",
        ordered ? "list-decimal" : "list-disc",
        dark ? "text-white" : "text-[var(--text-primary)]",
      )}
      dir="auto"
    >
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>
          <span className="bidi-content" dir="auto">
            {item}
          </span>
        </li>
      ))}
    </ListTag>
  );
}

export function MessageBody({
  message,
  dark,
  renderQuoted,
}: {
  message: Message;
  dark: boolean;
  renderQuoted: QuotedBlockRender;
}) {
  const blocks = getRenderableContent(message);
  const groups = groupContent(blocks);
  const [lightbox, setLightbox] = React.useState<MessageInlineImageBlock | null>(
    null,
  );

  return (
    <>
      <div className="space-y-1">
        {groups.map((group) => {
          if (group.kind === "image-grid") {
            return (
              <div
                key={`grid-${group.images.map((i) => i.id).join("-")}`}
                className="my-2.5 grid grid-cols-2 gap-2"
              >
                {group.images.map((image) => (
                  <InlineImageView
                    key={image.id}
                    image={image}
                    dark={dark}
                    senderId={message.fromId}
                    compact
                    onOpenLightbox={setLightbox}
                  />
                ))}
              </div>
            );
          }

          const block = group.block;
          switch (block.type) {
            case "paragraph":
              return (
                <ParagraphBlock key={block.id} text={block.text} dark={dark} />
              );
            case "list":
              return (
                <ListBlock
                  key={block.id}
                  items={block.items}
                  ordered={block.ordered}
                  dark={dark}
                />
              );
            case "inline-image":
              return (
                <InlineImageView
                  key={block.id}
                  image={block}
                  dark={dark}
                  senderId={message.fromId}
                  onOpenLightbox={setLightbox}
                />
              );
            default:
              return null;
          }
        })}
      </div>

      {message.signature && !message.content && !message.signatureSnapshot
        ? renderQuoted({ text: message.signature, dark })
        : null}

      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          showClose={false}
          className="w-[min(94vw,880px)] max-w-[880px] overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-0 shadow-[var(--shadow-overlay)]"
        >
          <DialogTitle className="sr-only">
            {lightbox?.fileName ?? "תמונה"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {lightbox?.alt ?? "תצוגה בגודל מלא"}
          </DialogDescription>
          {lightbox ? (
            <div className="flex flex-col" dir="rtl">
              <div className="bg-[var(--surface-subtle)] p-5">
                <div className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      lightbox.forceError
                        ? "/mock-mail/retry-fallback.jpg"
                        : lightbox.src
                    }
                    alt={lightbox.alt ?? lightbox.fileName}
                    className="mx-auto block max-h-[min(72vh,720px)] w-auto max-w-full object-contain"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
                <p className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                  <bdi>{lightbox.fileName}</bdi>
                </p>
                <button
                  type="button"
                  onClick={() => toast(`הורדה מדומה — ${lightbox.fileName}`)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-subtle)] px-4 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <Download className="size-4" strokeWidth={1.75} />
                  הורד תמונה
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
