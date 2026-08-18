'use server';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users, passwordResetTokens } from '@/lib/db/schema';
import { signIn } from '@/lib/auth';
import { hashPassword, normalizeEmail } from '@/lib/password';
import {
  signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema,
} from '@/lib/validation';
import {
  generateResetToken, hashResetToken, resetUrlFor, RESET_TOKEN_TTL_MINUTES,
} from '@/lib/reset-token';
import { sendPasswordResetEmail } from '@/lib/email';

export type FormState = { error?: string; notice?: string } | undefined;

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = normalizeEmail(parsed.data.email);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return { error: 'An account with that email already exists.' };

  await db.insert(users).values({
    name: parsed.data.name,
    email,
    passwordHash: await hashPassword(parsed.data.password),
  });

  try {
    await signIn('credentials', { email, password: parsed.data.password, redirect: false });
  } catch {
    // The account exists; only the automatic sign-in failed. Send them to log in
    // rather than losing the registration.
    return { error: 'Account created, but sign-in failed. Please log in.' };
  }

  // Must sit outside the try: redirect() signals by throwing, so a catch would
  // swallow it and the navigation would never happen.
  redirect('/dashboard');
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Enter a valid email and password.' };

  try {
    await signIn('credentials', {
      email: normalizeEmail(parsed.data.email),
      password: parsed.data.password,
      redirect: false,
    });
  } catch {
    // Deliberately identical for unknown email and wrong password, so the form
    // does not reveal which accounts exist.
    return { error: 'Incorrect email or password.' };
  }

  redirect('/dashboard');
}

/**
 * Step one of password reset.
 *
 * Always reports the same outcome whether or not the address is registered.
 * Saying "no account with that email" would turn this form into a way to
 * enumerate which addresses have accounts.
 */
export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = normalizeEmail(parsed.data.email);
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user) {
    // Retire any outstanding links first, so requesting a new one invalidates
    // the old. Otherwise every past email stays usable until it expires.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

    const token = generateResetToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    });

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      url: resetUrlFor(token),
    });
  }

  return {
    notice:
      `If an account exists for that address, a reset link is on its way. ` +
      `It expires in ${RESET_TOKEN_TTL_MINUTES} minutes.`,
  };
}

/**
 * Step two: exchange a valid, unused, unexpired token for a new password.
 */
export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashResetToken(parsed.data.token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  // One message for unknown, already-used, and expired tokens alike: which of
  // those it is would tell an attacker whether a token ever existed.
  if (!row) {
    return { error: 'That reset link is invalid or has expired. Request a new one.' };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(users.id, row.userId));

  // Burn every outstanding token for this user, not just the one used.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));

  redirect('/login?reset=1');
}
