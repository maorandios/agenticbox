import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow-overlay)]">
        <h1 className="text-center text-[22px] font-semibold text-[var(--text-primary)]">
          AgenticBox
        </h1>
        <p className="mt-2 text-center text-[14px] text-[var(--text-secondary)]">
          התחברות למשתמשים פנימיים בלבד
        </p>
        <div className="mt-8">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
