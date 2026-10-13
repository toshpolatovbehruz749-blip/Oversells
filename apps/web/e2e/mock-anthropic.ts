import { createServer, type Server } from 'node:http';

/**
 * A stand-in for the Anthropic Messages API used by the browser tests. The
 * server under test must run with ANTHROPIC_BASE_URL pointing here (see
 * README, "Tests"). The task is recognised from the JSON schema the server
 * asks for, and the answer is derived from the prompt so the flow is realistic.
 */
export interface MockRequest {
  system: string;
  prompt: string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export const MOCK_PORT = Number(process.env.E2E_AI_MOCK_PORT ?? 4599);

function answer(body: Record<string, unknown>, prompt: string): unknown {
  const schema = (body.output_config as { format?: { schema?: { required?: string[] } } } | undefined)?.format?.schema;
  const required = schema?.required ?? [];
  if (required.includes('replacement')) {
    const excerpt = /<excerpt>\n([\s\S]*)\n<\/excerpt>/.exec(prompt)?.[1] ?? '';
    return {
      replacement: excerpt.replace(/ ?\\badcommand/g, ''),
      explanation: 'Nomaʼlum \\badcommand buyrugʻi olib tashlandi.',
    };
  }
  if (required.includes('explanation')) {
    const error = /<error[^>]*>([^<]*)<\/error>/.exec(prompt)?.[1] ?? '';
    return { explanation: `MOCK: «${error}» — bu buyruq LaTeX’da mavjud emas.` };
  }
  if (required.includes('libraries')) {
    return {
      latex: '\\begin{tikzpicture}\n  \\draw[-{Latex}] (0,0) -- (3,0) -- (0,4) -- cycle;\n  \\node at (1.5,-0.3) {3};\n\\end{tikzpicture}',
      libraries: ['arrows.meta'],
    };
  }
  const topic = /<topic>([^<]*)<\/topic>/.exec(prompt)?.[1] ?? '';
  return {
    latex: `\\begin{enumerate}\n  \\item ${topic}: $\\frac{1}{2} + \\frac{1}{3}$ ni hisoblang.\n  \\item $\\frac{2}{5} + \\frac{1}{5}$ ni hisoblang.\n\\end{enumerate}\n\\paragraph{Javoblar} $\\frac{5}{6}$; $\\frac{3}{5}$.`,
  };
}

export async function startMockAnthropic(port = MOCK_PORT): Promise<{ requests: MockRequest[]; close(): Promise<void> }> {
  const requests: MockRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const messages = (body.messages as Array<{ content: string }> | undefined) ?? [];
      const prompt = messages[0]?.content ?? '';
      requests.push({ system: String(body.system ?? ''), prompt, body, headers: req.headers });
      const text = JSON.stringify(answer(body, prompt));
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: `msg_mock_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
