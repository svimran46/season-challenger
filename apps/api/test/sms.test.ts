import { describe, expect, it } from 'vitest';
import { SslWirelessSmsSender } from '../src/auth/sms';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = {
  status: 'SUCCESS',
  status_code: 200,
  error_message: '',
  smsinfo: [{ sms_status: 'SUCCESS', msisdn: '8801712345678', sms_id: 'abc' }],
};

describe('SslWirelessSmsSender', () => {
  it('posts a v3 single send with the number without its plus', async () => {
    const f = fakeFetch(200, ok);
    const sender = new SslWirelessSmsSender({ apiToken: 'tok', sid: 'SEASON', fetch: f.fn });
    await sender.send('+8801712345678', '123456 is your code');
    expect(f.calls[0]!.url).toBe('https://smsplus.sslwireless.com/api/v3/send-sms');
    expect(f.calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body).toMatchObject({
      api_token: 'tok',
      sid: 'SEASON',
      msisdn: '8801712345678',
      sms: '123456 is your code',
    });
    expect(body.csms_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('uses a fresh csms_id per message and honours a custom host', async () => {
    const f = fakeFetch(200, ok);
    const sender = new SslWirelessSmsSender({
      apiToken: 't',
      sid: 's',
      baseUrl: 'https://sandbox.example.com/',
      fetch: f.fn,
    });
    await sender.send('+8801712345678', 'a');
    await sender.send('+8801712345678', 'b');
    expect(f.calls[0]!.url).toBe('https://sandbox.example.com/api/v3/send-sms');
    const ids = f.calls.map((c) => JSON.parse(String(c.init.body)).csms_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('throws when SSL Wireless refuses the message', async () => {
    const f = fakeFetch(200, {
      status: 'FAILED',
      status_code: 4001,
      error_message: 'Authentication failed',
    });
    const sender = new SslWirelessSmsSender({ apiToken: 'bad', sid: 's', fetch: f.fn });
    await expect(sender.send('+8801712345678', 'x')).rejects.toThrow(/refused/);
  });

  it('throws on an HTTP error or a network failure', async () => {
    const f = fakeFetch(500, {});
    await expect(
      new SslWirelessSmsSender({ apiToken: 't', sid: 's', fetch: f.fn }).send(
        '+8801712345678',
        'x',
      ),
    ).rejects.toThrow(/refused/);
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new SslWirelessSmsSender({ apiToken: 't', sid: 's', fetch: down }).send(
        '+8801712345678',
        'x',
      ),
    ).rejects.toThrow(/unreachable/);
  });
});
