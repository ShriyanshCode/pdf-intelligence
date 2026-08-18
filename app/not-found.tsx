import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-bark">
          This page does not exist, or you do not have access to it.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block underline">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
