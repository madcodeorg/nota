import { describe, expect, test } from 'vitest';

import { fetchPublicWebPage } from './web-page';

describe('fetchPublicWebPage', () => {
  test('rejects invalid URLs', async () => {
    await expect(fetchPublicWebPage('not a url')).rejects.toThrow(
      'Enter a valid http or https URL.'
    );
  });

  test('rejects non-web protocols', async () => {
    await expect(fetchPublicWebPage('file:///etc/passwd')).rejects.toThrow(
      'Only http and https URLs are allowed.'
    );
  });

  test('rejects loopback and private hosts', async () => {
    await expect(fetchPublicWebPage('http://127.0.0.1/')).rejects.toThrow(
      'non-public address'
    );
    await expect(fetchPublicWebPage('http://192.168.1.10/')).rejects.toThrow(
      'non-public address'
    );
  });

  test('rejects non-default ports', async () => {
    await expect(
      fetchPublicWebPage('https://example.com:8443/')
    ).rejects.toThrow('Only default http and https ports are allowed.');
  });
});
