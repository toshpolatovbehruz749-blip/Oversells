import type { LoggerOptions } from 'pino';

/** Hides capability tokens that can appear in URLs (share links, reset links). */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:share|token)=)[^&#]*/g, '$1[redacted]');
}

/**
 * Structured (JSON) logging for the app and the worker: one object per line,
 * secrets redacted. Request logs carry the request id (also returned in the
 * X-Request-Id header).
 */
export function loggerOptions(level: string, service: 'app' | 'worker'): LoggerOptions {
  return {
    level,
    base: { service },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'req.headers["x-share-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req(req: { id?: string; method?: string; url?: string; ip?: string }) {
        return { id: req.id, method: req.method, url: req.url ? redactUrl(req.url) : undefined, ip: req.ip };
      },
    },
  };
}
