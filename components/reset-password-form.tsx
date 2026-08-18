'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { resetPasswordAction } from '@/app/(auth)/actions';

const field =
  'mt-1 w-full rounded-md border border-line bg-cream px-3 py-2 outline-none focus:border-ember';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  return (
    <form
      action={formAction}
      className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-cream p-6 shadow-sm"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cocoa">Choose a new password</h1>
        <p className="mt-1 text-sm text-bark">This link can only be used once.</p>
      </div>

      <input type="hidden" name="token" value={token} />

      <label className="block">
        <span className="text-sm font-medium text-cocoa">New password</span>
        <input
          name="password" type="password" required minLength={10}
          autoComplete="new-password" className={field}
        />
        <span className="mt-1 block text-xs text-bark/80">At least 10 characters.</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-cocoa">Confirm new password</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-md bg-error-surface px-3 py-2 text-sm text-error">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-bark px-4 py-2 text-cream transition hover:bg-cocoa disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Set new password'}
      </button>

      <p className="text-sm text-bark">
        <Link href="/forgot-password" className="underline hover:text-ember">
          Request a new link
        </Link>
      </p>
    </form>
  );
}
