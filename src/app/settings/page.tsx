import { SecondaryShell } from "@/components/shell/SecondaryShell";

export default function SettingsPage() {
  return (
    <SecondaryShell title="הגדרות">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">הגדרות</h1>
          <p className="mt-3 text-[14px] leading-6 text-[var(--text-secondary)]">
            הגדרות ממשק וחשבון מדומות ייבנו בשלב מאוחר יותר.
          </p>
        </div>
      </div>
    </SecondaryShell>
  );
}
