'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { signIn } from '@/lib/auth';
import { hashPassword, normalizeEmail } from '@/lib/password';
import { signupSchema, loginSchema } from '@/lib/validation';

export type FormState = { error?: string } | undefined;

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
