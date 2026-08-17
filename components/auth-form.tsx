'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/app/(auth)/actions';

type Props = {
  mode: 'login' | 'signup';
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
};

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === 'signup';

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignup ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isSignup
            ? 'Upload PDFs, get AI summaries, and collaborate.'
            : 'Welcome back.'}
        </p>
      </div>

      {isSignup && (
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            name="name" required autoComplete="name" maxLength={100}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email" type="email" required autoComplete="email"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password" type="password" required
          minLength={isSignup ? 10 : undefined}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
        {isSignup && (
          <span className="mt-1 block text-xs text-neutral-500">At least 10 characters.</span>
        )}
      </label>

      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
      </button>

      <p className="text-sm text-neutral-600">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="underline">Sign in</Link></>
        ) : (
          <>No account? <Link href="/signup" className="underline">Sign up</Link></>
        )}
      </p>
    </form>
  );
}
