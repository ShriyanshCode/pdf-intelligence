import { AuthForm } from '@/components/auth-form';
import { loginAction } from '../actions';

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <AuthForm mode="login" action={loginAction} />
    </main>
  );
}
