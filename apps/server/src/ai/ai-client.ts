import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../errors.js';

export interface AiCompletionRequest {
  system: string;
  prompt: string;
  /** JSON schema of the answer; the answer text is then a JSON document. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface AiCompletion {
  /** The parsed JSON answer. */
  data: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** The model behind the AI features (Claude in production, a fake in tests). */
export interface AiClient {
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}

export const aiUnavailable = (message = 'The AI service is not available right now') =>
  new AppError(502, 'ai_unavailable', message);

export interface AnthropicAiClientOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Defaults to the ANTHROPIC_BASE_URL environment variable (SDK behaviour). */
  baseURL?: string;
}

/**
 * Claude through the official SDK. Uses structured output (a JSON schema) so
 * answers can be parsed reliably, and the server-side fallback chain so a
 * refused request is retried on the default fallback model.
 */
export class AnthropicAiClient implements AiClient {
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicAiClientOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs,
      maxRetries: 2,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.opts.model,
        max_tokens: req.maxTokens ?? 8000,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AppError(503, 'ai_busy', 'The AI service is busy, try again soon');
      if (err instanceof Anthropic.APIError) throw aiUnavailable();
      throw err;
    }
    if (message.stop_reason === 'refusal') {
      throw new AppError(422, 'ai_refused', 'The AI declined this request');
    }
    if (message.stop_reason === 'max_tokens') {
      throw aiUnavailable('The AI answer was too long');
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw aiUnavailable('The AI answer could not be read');
    }
    return { data, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  }
}
