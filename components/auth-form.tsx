'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/app/(auth)/actions';

type Props = {
  mode: 'login' | 'signup';
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** Shown above the form, e.g. after a successful password reset. */
  notice?: string;
};

const field =
  'mt-1 w-full rounded-md border border-line bg-cream px-3 py-2 outline-none focus:border-ember';

export function AuthForm({ mode, action, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === 'signup';

  return (
    <form
      action={formAction}
      className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-cream p-6 shadow-sm"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cocoa">
          {isSignup ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-bark">
          {isSignup ? 'Upload PDFs, get AI summaries, and collaborate.' : 'Welcome back.'}
        </p>
      </div>

      {notice && (
        <p className="rounded-md border border-line bg-sand px-3 py-2 text-sm text-bark">
          {notice}
        </p>
      )}

      {isSignup && (
        <label className="block">
          <span className="text-sm font-medium text-cocoa">Name</span>
          <input name="name" required autoComplete="name" maxLength={100} className={field} />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-cocoa">Email</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>

      <label className="block">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-cocoa">Password</span>
          {!isSignup && (
            <Link href="/forgot-password" className="text-xs text-bark underline hover:text-ember">
              Forgot password?
            </Link>
          )}
        </div>
        <input
          name="password"
          type="password"
          required
          minLength={isSignup ? 10 : undefined}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          className={field}
        />
        {isSignup && (
          <span className="mt-1 block text-xs text-bark/80">At least 10 characters.</span>
        )}
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
        {pending ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
      </button>

      <p className="text-sm text-bark">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="underline hover:text-ember">Sign in</Link></>
        ) : (
          <>No account? <Link href="/signup" className="underline hover:text-ember">Sign up</Link></>
        )}
      </p>
    </form>
  );
}
