import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPublicDns } from '../master/dnsVerify';

describe('verifyPublicDns', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('type=A') || url.includes('type=1')) {
          if (url.includes('citbankplc.webfinance.app')) {
            return new Response(
              JSON.stringify({
                Status: 0,
                Answer: [
                  { type: 1, data: '63.176.8.218' },
                  { type: 1, data: '35.157.26.135' },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/dns-json' } },
            );
          }
          if (url.includes('aesthetic-stardust-5199e7.netlify.app')) {
            return new Response(
              JSON.stringify({
                Status: 0,
                Answer: [
                  { type: 1, data: '35.157.26.135' },
                  { type: 1, data: '63.176.8.218' },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/dns-json' } },
            );
          }
        }
        if (url.includes('type=CNAME') || url.includes('type=5')) {
          return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
        }
        if (url.includes('type=AAAA') || url.includes('type=28')) {
          return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
      }),
    );
  });

  it('verifies when A records overlap the Netlify target', async () => {
    const result = await verifyPublicDns(
      'citbankplc.webfinance.app',
      'aesthetic-stardust-5199e7.netlify.app',
    );
    expect(result.status).toBe('verified');
    expect(result.detail).toMatch(/matches/i);
  });
});
