import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from './config';

const valid = {
  region: 'eu-west-2',
  userPoolId: 'eu-west-2_AbC123xyz',
  clientId: '1h57kf5cpq17m0eml12exampl',
  cognitoDomain: 'todo-dev-1234.auth.eu-west-2.amazoncognito.com',
  apiUrl: 'https://abc123.execute-api.eu-west-2.amazonaws.com/prod/',
};

describe('parseConfig', () => {
  it('accepts a valid config and drops the trailing slash from apiUrl', () => {
    expect(parseConfig(valid)).toEqual({
      ...valid,
      apiUrl: 'https://abc123.execute-api.eu-west-2.amazonaws.com/prod',
    });
  });

  it.each([
    ['not an object', []],
    ['missing field', { ...valid, clientId: undefined }],
    ['empty field', { ...valid, region: '' }],
    ['non-string field', { ...valid, region: 42 }],
    ['bad region', { ...valid, region: 'Europe' }],
    ['pool from another region', { ...valid, userPoolId: 'us-east-1_AbC123xyz' }],
    ['bad client id', { ...valid, clientId: 'has spaces' }],
    [
      'domain with a scheme',
      { ...valid, cognitoDomain: 'https://x.auth.eu-west-2.amazoncognito.com' },
    ],
    [
      'plain-http API',
      { ...valid, apiUrl: 'http://abc123.execute-api.eu-west-2.amazonaws.com/prod' },
    ],
    ['API with a query', { ...valid, apiUrl: 'https://abc123.example.com/prod?x=1' }],
    ['unparseable API URL', { ...valid, apiUrl: 'not a url' }],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('fetches /config.json without the HTTP cache', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(valid));
    await expect(loadConfig(fetchFn)).resolves.toMatchObject({ region: 'eu-west-2' });
    expect(fetchFn).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('fails on a non-200 response', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(loadConfig(fetchFn)).rejects.toThrow('HTTP 404');
  });

  it('fails on a non-JSON body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'));
    await expect(loadConfig(fetchFn)).rejects.toThrow(ConfigError);
  });
});
