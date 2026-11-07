import { render } from '@testing-library/react';
import { User } from 'oidc-client-ts';
import type { UserManager } from 'oidc-client-ts';
import { App } from '../App';
import { createUserManager } from '../auth';
import { createQueryClient } from '../todos';
import { ACCESS_TOKEN, TEST_CONFIG } from './api-server';

export function testUser(): User {
  const now = Math.floor(Date.now() / 1000);
  return new User({
    access_token: ACCESS_TOKEN,
    token_type: 'Bearer',
    scope: 'openid email todo/api',
    expires_at: now + 3600,
    profile: {
      sub: 'user-1',
      email: 'ada@example.test',
      iss: `https://cognito-idp.${TEST_CONFIG.region}.amazonaws.com/${TEST_CONFIG.userPoolId}`,
      aud: TEST_CONFIG.clientId,
      exp: now + 3600,
      iat: now,
    },
  });
}

/** Renders the whole app. Signed in by default, with a user held in the in-memory store. */
export async function renderApp({ signedIn = true }: { signedIn?: boolean } = {}): Promise<{
  userManager: UserManager;
}> {
  const userManager = createUserManager(TEST_CONFIG);
  if (signedIn) await userManager.storeUser(testUser());
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  render(<App config={TEST_CONFIG} userManager={userManager} queryClient={queryClient} />);
  return { userManager };
}
