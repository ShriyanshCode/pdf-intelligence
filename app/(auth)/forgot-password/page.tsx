import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const metadata = { title: 'Reset your password · PDF Intelligence' };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <ForgotPasswordForm />
    </main>
  );
}
