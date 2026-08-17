export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border bg-neutral-50" />
        ))}
      </div>
    </main>
  );
}
