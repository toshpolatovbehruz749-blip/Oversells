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
  DESIGNS_DIR: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_TEXT_FILE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  MAX_PROJECT_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  MAX_FILES_PER_PROJECT: z.coerce.number().int().positive().default(500),

  /**
   * inline: compile in the app process (needs the Docker socket; simple setups, tests);
   * queue: the app queues jobs in PostgreSQL and the compile worker service runs them.
   */
  COMPILE_MODE: z.enum(['inline', 'queue']).default('inline'),
  /** Queue mode: how often to check a queued job when no notification arrives. */
  COMPILE_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(5000),
  /** A running job without a heartbeat for this long belongs to a lost worker. */
  WORKER_STALE_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /** Port of the worker's /health and /metrics endpoints. */
  WORKER_PORT: z.coerce.number().int().positive().default(9464),
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
  /** Generate template preview images in the background at start-up. */
  TEMPLATE_PREVIEWS_WARMUP: bool.default(true),

  // --- accounts --------------------------------------------------------------
  /** Public base URL, used in e-mails (password reset links). */
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Mark cookies Secure (set to true when served over HTTPS). */
  COOKIE_SECURE: bool.default(false),
  /** Honour X-Forwarded-For (only behind a trusted reverse proxy). */
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /** Max requests per IP and window on login/register/password-reset endpoints. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Claims the projects created before accounts existed (see README). */
  DEFAULT_OWNER_EMAIL: z.string().optional(),
  DEFAULT_OWNER_PASSWORD: z.string().optional(),

  // --- storage ------------------------------------------------------------------
  /** local: files below DATA_DIR; s3: an S3-compatible bucket (AWS S3, MinIO). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().default('oversells'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_PREFIX: z.string().default(''),
  /** Create the bucket at start-up if it is missing. */
  S3_CREATE_BUCKET: bool.default(true),

  // --- several app instances ---------------------------------------------------
  /** Redis for live documents across app instances and shared rate limits. */
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX: z.string().default('oversells:'),

  // --- operations ---------------------------------------------------------------
  /** Bearer token for GET /metrics; metrics are disabled without it. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Version retention and clean-up of expired sessions (0 disables). */
  MAINTENANCE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(3_600_000),

  // --- administration and quotas (Phase 4) -------------------------------------
  /** Comma-separated e-mails that get the admin role (at start-up and when registering). */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  /** Default number of projects a user may own (admins can change it per user). */
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(200),
  /** Default total size of the files in a user's projects (2 GB). */
  USER_STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),

  // --- collaboration (Phase 3) ------------------------------------------------
  COLLAB_PERSIST_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(300),
  COLLAB_STORAGE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(1000),
  COLLAB_COMPACT_AFTER: z.coerce.number().int().positive().default(100),
  COLLAB_UNLOAD_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  /** Minimum time between automatic versions while people edit (default 10 min). */
  AUTO_VERSION_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),

  // --- AI assistance (Phase 4) -----------------------------------------------
  /** Master switch; when false nothing is ever sent to the AI provider. */
  AI_ENABLED: bool.default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Read by the Anthropic SDK itself; set to point at a proxy or a test mock. */
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** AI requests per user and day (UTC); admins can override it per user. */
  AI_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(30),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // --- e-mail (SMTP); without SMTP_HOST e-mails are written to the log ------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Oversells <no-reply@localhost>'),
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
