'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordResetAction } from '@/app/(auth)/actions';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <form
      action={formAction}
      className="w-full max-w-sm space-y-4 rounded-3xl border border-line bg-surface p-7 shadow-card"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-ink/80">
          Enter your email and we&rsquo;ll send you a link to choose a new one.
        </p>
      </div>

      {/* Shown whether or not the address is registered, so the form cannot be
          used to discover which emails have accounts. */}
      {state?.notice ? (
        <p className="rounded-xl border border-line bg-mist px-3 py-2 text-sm text-ink/80">
          {state.notice}
        </p>
      ) : (
        <label className="block">
          <span className="text-sm font-medium text-ink">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 outline-none focus:border-clay"
          />
        </label>
      )}

      {state?.error && (
        <p role="alert" className="rounded-xl bg-error-surface px-3 py-2 text-sm text-error">
          {state.error}
        </p>
      )}

      {!state?.notice && (
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-ink px-4 py-2 text-white transition hover:bg-clay-deep disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      )}

      <p className="text-sm text-ink/80">
        <Link href="/login" className="underline hover:text-clay">Back to sign in</Link>
      </p>
    </form>
  );
}
