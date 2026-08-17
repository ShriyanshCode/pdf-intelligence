export default function ShareNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">This link is not available</h1>
        <p className="mt-2 text-sm text-neutral-600">
          It may have been revoked, or the address may be incorrect.
        </p>
      </div>
    </main>
  );
}
