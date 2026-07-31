import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCorsHeaders, resolveAllowedOrigin } from '../src/api/cors';

test('CORS never uses wildcard origins', () => {
  process.env.CORS_ORIGIN = '*';
  assert.equal(resolveAllowedOrigin('https://evil.example'), null);
  assert.deepEqual(buildCorsHeaders('https://evil.example'), {});
});

test('CORS allows configured production origins only', () => {
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = 'https://app.example.com,https://www.example.com';

  assert.equal(resolveAllowedOrigin('https://app.example.com'), 'https://app.example.com');
  assert.equal(resolveAllowedOrigin('https://other.example'), null);

  const headers = buildCorsHeaders('https://www.example.com');
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://www.example.com');
  assert.match(headers['Access-Control-Allow-Headers'] ?? '', /Authorization/);
  assert.match(headers['Access-Control-Allow-Headers'] ?? '', /Content-Type/);
  assert.ok(!Object.values(headers).includes('*'));
});

test('CORS allows local Vite origins in non-production when CORS_ORIGIN unset', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.CORS_ORIGIN;

  assert.equal(resolveAllowedOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(resolveAllowedOrigin('https://evil.example'), null);
});

test('CORS is disabled in production when CORS_ORIGIN unset', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.CORS_ORIGIN;

  assert.equal(resolveAllowedOrigin('http://localhost:5173'), null);
  assert.deepEqual(buildCorsHeaders('http://localhost:5173'), {});
});
