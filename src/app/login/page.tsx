import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm showDemo={process.env.NODE_ENV !== 'production'} />
    </Suspense>
  );
}
