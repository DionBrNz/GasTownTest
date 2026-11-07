import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';

/** Renders children only for a signed-in user; otherwise offers the Cognito sign-in. */
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();

  if (auth.isLoading || auth.activeNavigator !== undefined) {
    return (
      <main className="centered">
        <p role="status">{auth.activeNavigator === undefined ? 'Loading…' : 'Redirecting…'}</p>
      </main>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="centered">
        <h1>Todos</h1>
        {auth.error !== undefined && <p role="alert">Sign-in failed. Please try again.</p>}
        <p>Sign in to see your todos.</p>
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            void auth.signinRedirect();
          }}
        >
          Sign in
        </button>
      </main>
    );
  }

  return children;
}
