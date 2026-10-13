import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  DATA_DIR: z.string().default('./data'),
  /** Directory with the built web client; served at / when present. */
  WEB_DIST_DIR: z.string().optional(),
  TEMPLATES_DIR: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_TEXT_FILE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  MAX_PROJECT_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  MAX_FILES_PER_PROJECT: z.coerce.number().int().positive().default(500),

  COMPILE_IMAGE: z.string().default('oversells-texlive:latest'),
  COMPILE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  COMPILE_MEMORY_MB: z.coerce.number().int().positive().default(1024),
  COMPILE_CPUS: z.coerce.number().positive().default(1),
  COMPILE_WORKDIR_MB: z.coerce.number().int().positive().default(512),
  COMPILE_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  COMPILE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  COMPILE_KEEP_OUTPUTS: z.coerce.number().int().positive().default(5),
  /** Path of the Docker socket; DOCKER_HOST (tcp://...) takes precedence. */
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  DOCKER_HOST: z.string().optional(),
  /** Set to false to skip checking for the compiler image at start-up. */
  COMPILE_CHECK_IMAGE: bool.default(true),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
