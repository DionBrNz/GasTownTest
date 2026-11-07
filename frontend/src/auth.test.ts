import { describe, expect, it } from 'vitest';
import { cognitoLogoutUrl, createUserManager, oidcSettings } from './auth';
import { TEST_CONFIG } from './test/api-server';
import { testUser } from './test/render-app';

describe('oidcSettings', () => {
  it('uses the Cognito issuer, the code flow and the API scope', () => {
    const settings = oidcSettings(TEST_CONFIG);
    expect(settings.authority).toBe(
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool1',
    );
    expect(settings.client_id).toBe(TEST_CONFIG.clientId);
    expect(settings.response_type).toBe('code');
    expect(settings.scope).toBe('openid email todo/api');
    expect(settings.redirect_uri).toBe(`${window.location.origin}/`);
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('keeps tokens in memory, out of web storage', async () => {
    localStorage.clear();
    sessionStorage.clear();
    const userManager = createUserManager(TEST_CONFIG);

    await userManager.storeUser(testUser());

    expect((await userManager.getUser())?.access_token).toBe('test-access-token');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    userManager.stopSilentRenew();
  });
});

describe('cognitoLogoutUrl', () => {
  it('points at the Cognito logout endpoint with the client id and return URL', () => {
    const url = new URL(cognitoLogoutUrl(TEST_CONFIG));
    expect(url.origin).toBe('https://todo-test.auth.us-east-1.amazoncognito.com');
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('client_id')).toBe(TEST_CONFIG.clientId);
    expect(url.searchParams.get('logout_uri')).toBe(`${window.location.origin}/`);
  });
});
