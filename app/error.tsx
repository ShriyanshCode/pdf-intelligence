'use client';

/**
 * The `error` prop is intentionally not rendered: a raw server error message can
 * leak schema or filesystem detail to the browser. It is logged server-side by
 * the route that threw.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-bark">
          The error has been logged. You can try again.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-bark px-4 py-2 text-sm text-cream"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
