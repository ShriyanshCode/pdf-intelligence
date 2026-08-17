import { AuthForm } from '@/components/auth-form';
import { signupAction } from '../actions';

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <AuthForm mode="signup" action={signupAction} />
    </main>
  );
}
