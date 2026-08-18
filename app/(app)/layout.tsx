import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';

/**
 * The authentication gate for every page in this group. There is no
 * middleware.ts by design: middleware runs on the Edge runtime, which cannot
 * load bcryptjs or the Postgres driver that lib/auth.ts depends on. A
 * server-side check here covers the same ground, and route handlers verify
 * auth() independently.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b bg-surface px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          PDF Intelligence
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden text-ink/80 sm:inline">{session.user.email}</span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button className="underline hover:no-underline">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
