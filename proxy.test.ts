import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from './proxy';

describe('proxy matcher', () => {
  it.each([
    '/',
    '/artists/hong-sil',
    '/api/payments/goods/confirm',
    '/settings/delete-account?next=%2Forders',
    '/assets/catalog-cover.avif',
  ])('keeps application and non-excluded asset requests behind the proxy: %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });

  it.each([
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Fcatalog.png&w=640&q=75',
    '/favicon.ico',
    '/catalog/cover.svg',
    '/catalog/cover.png',
    '/catalog/cover.jpg',
    '/catalog/cover.jpeg',
    '/catalog/cover.gif',
    '/catalog/cover.webp',
  ])('does not run the proxy for the explicitly excluded static request: %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });
});
