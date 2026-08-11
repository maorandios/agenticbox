"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isSupabaseBrowserConfigured()) {
      setError("Supabase אינו מוגדר. בדקו את משתני הסביבה.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError("ההתחברות נכשלה. בדקו אימייל וסיסמה.");
        return;
      }
      const next = searchParams.get("next") || "/inbox";
      router.replace(next.startsWith("/") ? next : "/inbox");
      router.refresh();
    } catch {
      setError("אירעה שגיאה. נסו שוב.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-[13px] text-[var(--text-secondary)]"
        >
          אימייל
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--text-primary)]"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-[13px] text-[var(--text-secondary)]"
        >
          סיסמה
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--text-primary)]"
        />
      </div>
      {error ? (
        <p className="text-[13px] text-[var(--text-primary)]" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[12px] bg-[var(--action-primary)] px-3 py-2.5 text-[14px] font-medium text-[var(--action-on-primary)] disabled:opacity-60"
      >
        {pending ? "מתחבר…" : "התחברות"}
      </button>
    </form>
  );
}
