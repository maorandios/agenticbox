"use client";

import * as React from "react";
import {
  Building2,
  ContactRound,
  Copy,
  FileText,
  Image as ImageIcon,
  Link2,
  Mail,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
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
import type {
  SignatureSnapshot,
  SignatureSnapshotImage,
  SignatureSnapshotLink,
} from "@/types/domain";

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("לא ניתן להעתיק");
  }
}

function isVisibleSignatureImage(image: SignatureSnapshotImage) {
  if (image.isTrackingPixel || image.isSpacer || image.isTinyDuplicateIcon) {
    return false;
  }
  if (image.width === 1 && image.height === 1) return false;
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width <= 2 &&
    image.height <= 2
  ) {
    return false;
  }
  return true;
}

function linkHref(link: SignatureSnapshotLink) {
  return link.url.startsWith("http") ? link.url : `https://${link.url}`;
}

function linkLabel(link: SignatureSnapshotLink) {
  return link.url.replace(/^https?:\/\//, "");
}

function formatSnapshotForCopy(snapshot: SignatureSnapshot) {
  const images = (snapshot.images ?? []).filter(isVisibleSignatureImage);
  const lines: string[] = [];
  if (snapshot.name) lines.push(snapshot.name);
  if (snapshot.title) lines.push(snapshot.title);
  if (snapshot.company) lines.push(snapshot.company);
  if (snapshot.descriptionBlocks?.length) {
    lines.push("", "טקסט מהחתימה:", ...snapshot.descriptionBlocks);
  }
  if (snapshot.phoneNumbers?.length) {
    lines.push("", "מספרי טלפון:", ...snapshot.phoneNumbers);
  }
  if (snapshot.emailAddresses?.length) {
    lines.push("", "כתובות אימייל:", ...snapshot.emailAddresses);
  }
  if (snapshot.links?.length) {
    lines.push("", "קישורים:", ...snapshot.links.map((l) => l.url));
  }
  if (images.length) {
    lines.push("", "תמונות מהחתימה:", ...images.map((i) => i.alt || i.src));
  }
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
        <p className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">
          {label}
        </p>
      </div>
      <div className="space-y-1.5 text-start">{children}</div>
    </div>
  );
}

export function SignatureSnapshotCard({
  snapshot,
  open,
  onOpenChange,
  anchor,
}: {
  snapshot: SignatureSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.ReactNode;
}) {
  const [preview, setPreview] = React.useState<SignatureSnapshotImage | null>(
    null,
  );
  const [copyTipOpen, setCopyTipOpen] = React.useState(false);

  const visibleImages = (snapshot.images ?? []).filter(isVisibleSignatureImage);
  const hasIdentity = Boolean(
    snapshot.name || snapshot.title || snapshot.company,
  );
  const hasPhones = Boolean(snapshot.phoneNumbers?.length);
  const hasEmails = Boolean(snapshot.emailAddresses?.length);
  const hasLinks = Boolean(snapshot.links?.length);
  const hasDescriptions = Boolean(snapshot.descriptionBlocks?.length);
  const hasImages = visibleImages.length > 0;

  React.useEffect(() => {
    if (!open) setCopyTipOpen(false);
  }, [open]);

  return (
    <>
      {React.isValidElement(anchor)
        ? React.cloneElement(
            anchor as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>,
            {
              onClick: (e: React.MouseEvent) => {
                (
                  anchor as React.ReactElement<{
                    onClick?: (e: React.MouseEvent) => void;
                  }>
                ).props.onClick?.(e);
                onOpenChange(true);
              },
            },
          )
        : (
          <button type="button" onClick={() => onOpenChange(true)}>
            {anchor}
          </button>
        )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setCopyTipOpen(false);
          onOpenChange(next);
        }}
      >
        <DialogContent
          showClose={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="thin-scroll max-h-[min(86vh,520px)] w-[min(92vw,360px)] max-w-[360px] overflow-y-auto rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-[16px] shadow-[var(--shadow-overlay)]"
        >
          <DialogTitle className="sr-only">חתימת השולח</DialogTitle>
          <DialogDescription className="sr-only">
            פרטי החתימה כפי שהופיעו בהודעה
          </DialogDescription>

          <div dir="rtl" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5 text-start">
                {hasIdentity ? (
                  <>
                    {snapshot.name ? (
                      <p className="text-[14px] font-semibold leading-[1.45] text-[var(--text-primary)]">
                        <bdi>{snapshot.name}</bdi>
                      </p>
                    ) : null}
                    {snapshot.title ? (
                      <p className="text-[12px] leading-[1.45] text-[var(--text-secondary)]">
                        {snapshot.title}
                      </p>
                    ) : null}
                    {snapshot.company ? (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Building2
                          className="size-3.5 shrink-0 text-[var(--text-muted)]"
                          strokeWidth={1.75}
                        />
                        <p className="truncate text-[12px] leading-[1.45] text-[var(--text-secondary)]">
                          <bdi>{snapshot.company}</bdi>
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                    חתימה ללא פרטי זהות
                  </p>
                )}
              </div>
              <Tooltip open={copyTipOpen} onOpenChange={setCopyTipOpen}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="העתק את פרטי החתימה"
                    onPointerEnter={() => setCopyTipOpen(true)}
                    onPointerLeave={() => setCopyTipOpen(false)}
                    onClick={() =>
                      copyText(
                        formatSnapshotForCopy(snapshot),
                        "פרטי החתימה הועתקו",
                      )
                    }
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <Copy className="size-3.5" strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>העתק את פרטי החתימה</TooltipContent>
              </Tooltip>
            </div>

            {hasDescriptions ? (
              <Section icon={FileText} label="טקסט מהחתימה">
                {snapshot.descriptionBlocks!.map((block, index) => (
                  <p
                    key={`desc-${index}`}
                    className="bidi-content whitespace-pre-wrap text-[13px] leading-[1.5] text-[var(--text-primary)]"
                    dir="auto"
                  >
                    {block}
                  </p>
                ))}
              </Section>
            ) : null}

            {hasPhones ? (
              <Section icon={Phone} label="מספרי טלפון">
                {snapshot.phoneNumbers!.map((phone) => (
                  <p
                    key={phone}
                    className="text-start text-[13px] leading-[1.5] text-[var(--text-primary)]"
                  >
                    <bdi dir="ltr">{phone}</bdi>
                  </p>
                ))}
              </Section>
            ) : null}

            {hasEmails ? (
              <Section icon={Mail} label="כתובות אימייל">
                {snapshot.emailAddresses!.map((email) => (
                  <p
                    key={email}
                    className="truncate text-start text-[13px] leading-[1.5] text-[var(--text-primary)]"
                  >
                    <bdi dir="ltr">{email}</bdi>
                  </p>
                ))}
              </Section>
            ) : null}

            {hasLinks ? (
              <Section icon={Link2} label="קישורים">
                {snapshot.links!.map((link) => (
                  <a
                    key={link.id}
                    href={linkHref(link)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-start text-[13px] leading-[1.5] text-[var(--text-primary)] hover:underline"
                  >
                    <bdi dir="ltr">{linkLabel(link)}</bdi>
                  </a>
                ))}
              </Section>
            ) : null}

            {hasImages ? (
              <Section icon={ImageIcon} label="תמונות מהחתימה">
                <div className="flex flex-wrap justify-start gap-2">
                  {visibleImages.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setPreview(image)}
                      className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-subtle)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.src}
                        alt={image.alt ?? "תמונה מהחתימה"}
                        className="size-11 object-cover"
                      />
                    </button>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent
          showClose={false}
          className="w-[min(92vw,520px)] max-w-[520px] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-0"
        >
          <DialogTitle className="sr-only">תצוגת תמונה מהחתימה</DialogTitle>
          <DialogDescription className="sr-only">
            {preview?.alt ?? "תמונה"}
          </DialogDescription>
          {preview ? (
            <div className="bg-[var(--surface-subtle)] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.src}
                alt={preview.alt ?? "תמונה מהחתימה"}
                className="mx-auto max-h-[70vh] w-auto max-w-full rounded-[12px] object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SignatureSnapshotAffordance({
  dark = false,
  open,
  onOpenChange,
}: {
  dark?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="הצג את חתימת השולח"
          onClick={() => onOpenChange(!open)}
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-[4px] transition-colors",
            dark
              ? "text-white/70 hover:bg-white/10 hover:text-white"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
          )}
        >
          <ContactRound className="size-3.5" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>הצג את חתימת השולח</TooltipContent>
    </Tooltip>
  );
}
