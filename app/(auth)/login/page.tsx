import { AuthForm } from '@/components/auth-form';
import { loginAction } from '../actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <AuthForm
        mode="login"
        action={loginAction}
        notice={reset ? 'Your password has been updated. Sign in with your new password.' : undefined}
      />
    </main>
  );
}
