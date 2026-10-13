import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicAiClient } from '../../src/ai/ai-client.js';

interface Captured {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** A local stand-in for the Messages API that records requests. */
async function mockApi(respond: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const captured: Captured[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      captured.push({ url: req.url ?? '', headers: req.headers, body });
      const r = respond(body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, captured, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 34 },
});

describe('AnthropicAiClient', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('sends a structured-output request with the fallback chain and parses the JSON answer', async () => {
    const api = await mockApi(() => ({ status: 200, json: message('{"explanation":"Qavs yetishmaydi"}') }));
    close = api.close;
    const client = new AnthropicAiClient({ apiKey: 'sk-test', model: 'claude-opus-5-5', timeoutMs: 5000, baseURL: api.url });
    const schema = { type: 'object', properties: { explanation: { type: 'string' } }, required: ['explanation'] };
    const out = await client.complete({ system: 'SYS', prompt: 'PROMPT', schema });
    expect(out).toEqual({ data: { explanation: 'Qavs yetishmaydi' }, inputTokens: 12, outputTokens: 34 });

    const req = api.captured[0]!;
    expect(req.url).toBe('/v1/messages?beta=true');
    expect(req.headers['x-api-key']).toBe('sk-test');
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'SYS',
      messages: [{ role: 'user', content: 'PROMPT' }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      fallbacks: 'default',
    });
    expect(req.body).not.toHaveProperty('thinking');
  });

  it('maps refusals, unreadable answers and API errors to app errors', async () => {
    let next: { status: number; json: unknown } = { status: 200, json: message('', 'refusal') };
    const api = await mockApi(() => next);
    close = api.close;
    const client = new AnthropicAiClient({ apiKey: 'sk-test', model: 'm', timeoutMs: 5000, baseURL: api.url });
    const call = () => client.complete({ system: 's', prompt: 'p', schema: { type: 'object' } });

    await expect(call()).rejects.toMatchObject({ code: 'ai_refused', statusCode: 422 });
    next = { status: 200, json: message('not json') };
    await expect(call()).rejects.toMatchObject({ code: 'ai_unavailable' });
    next = { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'bad key' } } };
    await expect(call()).rejects.toMatchObject({ code: 'ai_unavailable', statusCode: 502 });
  });

  it('sends PDFs and images as document and image blocks before the text', async () => {
    const api = await mockApi(() => ({ status: 200, json: message('{}') }));
    close = api.close;
    const client = new AnthropicAiClient({ apiKey: 'k', model: 'm', timeoutMs: 5000, baseURL: api.url });
    await client.complete({
      system: 's',
      prompt: 'P',
      schema: { type: 'object' },
      attachments: [{ mediaType: 'application/pdf', data: 'UERG' }, { mediaType: 'image/png', data: 'iVBO' }],
    });
    expect(api.captured[0]!.body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
          { type: 'text', text: 'P' },
        ],
      },
    ]);
  });
});
