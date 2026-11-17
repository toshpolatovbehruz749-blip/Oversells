import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PASSWORD, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { NO_PASSWORD } from '../../src/auth/crypto.js';
import { SESSION_COOKIE } from '../../src/auth/http.js';

describe('accounts and sessions', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  const setup = async (env: Record<string, string> = {}) => {
    ctx = await createTestContext(new FakeRunner(), env);
  };

  it('registers a user with an argon2id hash and logs them in', async () => {
    await setup();
    const c = ctx.client();
    expect((await c.inject('/api/auth/me')).json()).toEqual({ user: null });

    const res = await c.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: '  Ustoz@Maktab.UZ ', password: TEST_PASSWORD, name: 'Dilnoza Karimova' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'ustoz@maktab.uz', name: 'Dilnoza Karimova' });

    const cookie = (res.cookies as Array<{ name: string; httpOnly?: boolean; sameSite?: string }>).find(
      (x) => x.name === SESSION_COOKIE,
    );
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ustoz@maktab.uz' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    // Only the hash of the session token is stored.
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(c.cookies.get(SESSION_COOKIE)).not.toBe(session.id);

    expect((await c.inject('/api/auth/me')).json().user.email).toBe('ustoz@maktab.uz');
  });

  it.each([
    [{ email: 'not-an-email', password: TEST_PASSWORD }, 'invalid_email'],
    [{ email: 'a@b.uz', password: 'short' }, 'weak_password'],
    [{ email: 'a@b.uz', password: 'x'.repeat(201) }, 'weak_password'],
  ])('rejects invalid registration %j', async (payload, code) => {
    await setup();
    const res = await ctx.client().inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it('rejects duplicate e-mails case-insensitively', async () => {
    await setup();
    const res = await ctx.client().inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'OWNER@test.uz', password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('email_taken');
  });

  it('logs in with the right password only, with the same error for unknown users', async () => {
    await setup();
    const c = ctx.client();
    const wrong = await c.login('owner@test.uz', 'wrong-password');
    const unknown = await c.login('nobody@test.uz', TEST_PASSWORD);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(wrong.json().error.code).toBe('invalid_credentials');

    expect((await c.login('Owner@Test.uz')).statusCode).toBe(200);
    expect((await c.inject('/api/projects')).statusCode).toBe(200);
  });

  it('logs out and invalidates the session server-side', async () => {
    await setup();
    const token = ctx.api.cookies.get(SESSION_COOKIE)!;
    expect((await ctx.api.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(204);
    expect(ctx.api.cookies.has(SESSION_COOKIE)).toBe(false);
    expect((await ctx.api.inject('/api/auth/me')).json().user).toBeNull();

    // Replaying the old cookie does not work either.
    const replay = ctx.client();
    replay.cookies.set(SESSION_COOKIE, token);
    expect((await replay.inject('/api/projects')).statusCode).toBe(401);
  });

  it('expires sessions', async () => {
    await setup();
    await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ctx.api.inject('/api/projects')).json().error.code).toBe('unauthorized');
    expect(await ctx.prisma.session.count()).toBe(0);
  });

  it('requires login for the project list and project creation', async () => {
    await setup();
    const anon = ctx.client();
    expect((await anon.inject('/api/projects')).statusCode).toBe(401);
    expect((await anon.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } })).statusCode).toBe(401);
  });
});

describe('CSRF protection', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('rejects state-changing requests without a matching X-CSRF-Token', async () => {
    ctx = await createTestContext(new FakeRunner());
    const post = (headers: Record<string, string>) =>
      ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' }, headers });
    const session = `oversells_session=${ctx.api.cookies.get(SESSION_COOKIE)}`;

    const noToken = await post({ cookie: session });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('csrf_failed');

    const mismatch = await post({ cookie: `${session}; oversells_csrf=aaa`, 'x-csrf-token': 'bbb' });
    expect(mismatch.statusCode).toBe(403);

    // A header without the cookie (what a cross-site form cannot produce either way) fails too.
    expect((await post({ cookie: session, 'x-csrf-token': 'aaa' })).statusCode).toBe(403);

    const ok = await post({ cookie: `${session}; oversells_csrf=aaa`, 'x-csrf-token': 'aaa' });
    expect(ok.statusCode).toBe(201);
  });

  it('issues a readable CSRF cookie on GET requests', async () => {
    ctx = await createTestContext(new FakeRunner());
    const res = await ctx.app.inject({ url: '/api/auth/me' });
    const csrf = (res.cookies as Array<{ name: string; httpOnly?: boolean }>).find((c) => c.name === 'oversells_csrf');
    expect(csrf).toBeDefined();
    expect(csrf!.httpOnly).toBeFalsy();
  });
});

describe('rate limiting', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('limits login attempts per IP', async () => {
    ctx = await createTestContext(new FakeRunner(), { AUTH_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_WINDOW_MS: '60000' });
    const c = ctx.client();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.login('owner@test.uz', 'wrong-password')).statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const limited = await c.login('owner@test.uz');
    expect(limited.json().error.code).toBe('rate_limited');
    // Other endpoints are not limited.
    expect((await ctx.api.inject('/api/projects')).statusCode).toBe(200);
  });
});

describe('password reset', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  const tokenFrom = (text: string) => decodeURIComponent(/reset-password\?token=([^\s]+)/.exec(text)![1]!);

  it('e-mails a link that sets a new password and ends all sessions', async () => {
    ctx = await createTestContext(new FakeRunner(), { APP_URL: 'https://oversells.example.uz' });
    const res = await ctx.client().inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'owner@test.uz', lang: 'uz' },
    });
    expect(res.json()).toEqual({ ok: true });
    expect(ctx.mailer.sent).toHaveLength(1);
    const mail = ctx.mailer.sent[0]!;
    expect(mail.to).toBe('owner@test.uz');
    expect(mail.subject).toContain('parolni tiklash');
    expect(mail.text).toContain('https://oversells.example.uz/reset-password?token=');
    const token = tokenFrom(mail.text);
    // The token is not stored in clear text.
    expect(await ctx.prisma.passwordResetToken.count({ where: { id: token } })).toBe(0);

    const c = ctx.client();
    const confirm = await c.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token, password: 'yangi-parol-456' },
    });
    expect(confirm.json()).toEqual({ ok: true });

    expect((await ctx.api.inject('/api/projects')).statusCode).toBe(401); // old session ended
    expect((await c.login('owner@test.uz')).statusCode).toBe(401);
    expect((await c.login('owner@test.uz', 'yangi-parol-456')).statusCode).toBe(200);

    // A token works once.
    const again = await c.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token, password: 'boshqa-parol-789' },
    });
    expect(again.json().error.code).toBe('invalid_reset_token');
  });

  it('does not reveal whether an account exists', async () => {
    ctx = await createTestContext(new FakeRunner());
    const res = await ctx.client().inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'nobody@test.uz' },
    });
    expect(res.json()).toEqual({ ok: true });
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('rejects expired and unknown tokens and weak passwords', async () => {
    ctx = await createTestContext(new FakeRunner());
    const token = (await ctx.auth.requestPasswordReset('owner@test.uz', 'en'))!;
    expect(ctx.mailer.sent[0]!.subject).toBe('Oversells: reset your password');
    const confirm = (t: string, password = 'yangi-parol-456') =>
      ctx.client().inject({ method: 'POST', url: '/api/auth/password-reset/confirm', payload: { token: t, password } });

    expect((await confirm(token, 'short')).json().error.code).toBe('weak_password');
    expect((await confirm('unknown-token')).json().error.code).toBe('invalid_reset_token');
    await ctx.prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await confirm(token)).json().error.code).toBe('invalid_reset_token');
  });
});

describe('default owner of pre-account projects', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('can be claimed once with an e-mail and password', async () => {
    ctx = await createTestContext(new FakeRunner());
    await ctx.prisma.user.create({
      data: { id: 'default-owner', email: 'owner@oversells.local', name: 'Oversells', passwordHash: NO_PASSWORD },
    });
    await ctx.prisma.project.create({ data: { name: 'Eski loyiha', ownerId: 'default-owner' } });

    // Cannot log in before it is claimed.
    expect((await ctx.client().login('owner@oversells.local', '!')).statusCode).toBe(401);

    expect(await ctx.auth.claimDefaultOwner('Admin@Maktab.uz', 'admin-parol-123')).toBe(true);
    expect(await ctx.auth.claimDefaultOwner('other@maktab.uz', 'admin-parol-123')).toBe(false);

    const c = ctx.client();
    expect((await c.login('admin@maktab.uz', 'admin-parol-123')).statusCode).toBe(200);
    expect((await c.inject('/api/projects')).json().projects.map((p: { name: string }) => p.name)).toEqual([
      'Eski loyiha',
    ]);
  });

  it('moves the projects to an existing account with that e-mail', async () => {
    ctx = await createTestContext(new FakeRunner());
    await ctx.prisma.user.create({
      data: { id: 'default-owner', email: 'owner@oversells.local', name: 'Oversells', passwordHash: NO_PASSWORD },
    });
    await ctx.prisma.project.create({ data: { name: 'Eski loyiha', ownerId: 'default-owner' } });
    expect(await ctx.auth.claimDefaultOwner('owner@test.uz', 'whatever-123')).toBe(true);
    expect((await ctx.api.inject('/api/projects')).json().projects).toHaveLength(1);
  });
});
