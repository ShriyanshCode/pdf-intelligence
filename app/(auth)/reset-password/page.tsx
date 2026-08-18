import Link from 'next/link';
import { ResetPasswordForm } from '@/components/reset-password-form';

export const metadata = { title: 'Choose a new password · PDF Intelligence' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Only checks that a token is present. Whether it is valid is decided when the
  // form is submitted, so visiting a URL never reveals if a token exists.
  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-line bg-cream p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-cocoa">This link is incomplete</h1>
          <p className="mt-2 text-sm text-bark">
            Open the link from your email, or request a new one.
          </p>
          <Link
            href="/forgot-password"
            className="mt-4 inline-block rounded-md bg-bark px-4 py-2 text-sm text-cream hover:bg-cocoa"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <ResetPasswordForm token={token} />
    </main>
  );
}
