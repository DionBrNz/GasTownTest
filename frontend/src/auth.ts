import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { UserManagerSettings } from 'oidc-client-ts';
import type { RuntimeConfig } from './config';

/** OAuth scopes the app client allows. `todo/api` is required by the API authorizer. */
export const SCOPES = 'openid email todo/api';

/** Where Cognito sends the browser after sign-in and sign-out. Must be a registered URL. */
export function appRedirectUri(): string {
  return `${window.location.origin}/`;
}

export function oidcSettings(config: RuntimeConfig): UserManagerSettings {
  return {
    authority: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    client_id: config.clientId,
    redirect_uri: appRedirectUri(),
    post_logout_redirect_uri: appRedirectUri(),
    // Authorization code flow. oidc-client-ts always sends a PKCE S256 challenge.
    response_type: 'code',
    scope: SCOPES,
    // Tokens live only in memory, never in localStorage or sessionStorage. The
    // short-lived state store (PKCE verifier + state for the redirect round trip)
    // keeps the library default, sessionStorage, and is removed on callback.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    // Renew with the refresh token before the access token expires.
    automaticSilentRenew: true,
    // Cognito has no check_session_iframe; don't load any iframes.
    monitorSession: false,
    loadUserInfo: false,
  };
}

export function createUserManager(config: RuntimeConfig): UserManager {
  return new UserManager(oidcSettings(config));
}

/** Cognito's own logout endpoint, which also ends the managed login session. */
export function cognitoLogoutUrl(config: RuntimeConfig): string {
  const url = new URL(`https://${config.cognitoDomain}/logout`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('logout_uri', appRedirectUri());
  return url.href;
}

/** Drops the code/state query parameters after the sign-in redirect completes. */
export function clearSigninParams(): void {
  window.history.replaceState(null, '', window.location.pathname);
}
