import { Suspense } from "react";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import { MailAccountSettings } from "@/components/settings/MailAccountSettings";

export default function SettingsPage() {
  return (
    <SecondaryShell title="הגדרות">
      <div className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
        <div className="mx-auto w-full max-w-lg">
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">
            הגדרות
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-[var(--text-secondary)]">
            חיבור חשבון מייל לקריאה בלבד. שאר ההגדרות יתווספו בהמשך.
          </p>
          <div className="mt-8">
            <Suspense fallback={null}>
              <MailAccountSettings />
            </Suspense>
          </div>
        </div>
      </div>
    </SecondaryShell>
  );
}
