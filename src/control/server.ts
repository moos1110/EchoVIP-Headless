import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { AccountStore } from './account-store.js';
import { loadControlConfig, type ControlConfig } from './config.js';
import { CoreRunner } from './core-runner.js';
import { LoginManager } from './login-manager.js';
import { BusyError } from './locks.js';
import { OperationLog } from './operation-log.js';
import { SessionManager } from './session-manager.js';
import type { ScheduleConfig } from './types.js';

const sessionCookie = 'echovip_session';

interface AuthenticatedRequest extends FastifyRequest {
  sessionId?: string;
  csrfToken?: string;
}

const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';

export const buildControlServer = async (config: ControlConfig = loadControlConfig(true)): Promise<FastifyInstance> => {
  const accounts = new AccountStore(config.accountsDir, config.timeZone);
  await accounts.initialize();
  const runner = new CoreRunner(config.coreEntry, path.join(config.controlDir, 'operation.lock'), config.timeZone);
  const operations = new OperationLog();
  const logins = new LoginManager(accounts, config.coreEntry, config.timeZone, operations);
  const sessions = new SessionManager(config.panelPassword);
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });

  await app.register(cookie, { secret: config.sessionSecret, hook: 'onRequest' });
  await app.register(rateLimit, { global: false });
  await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });

  const assertOrigin = (request: FastifyRequest): void => {
    const origin = stringValue(request.headers.origin);
    if (!origin) throw Object.assign(new Error('缺少 Origin 请求头'), { statusCode: 403 });
    const forwardedProto = stringValue(request.headers['x-forwarded-proto']).split(',')[0]?.trim();
    const protocol = forwardedProto || request.protocol;
    const host = stringValue(request.headers['x-forwarded-host']).split(',')[0]?.trim() || request.host;
    const expectedOrigin = config.mode === 'server' && config.publicBaseUrl
      ? new URL(config.publicBaseUrl).origin
      : `${protocol}://${host}`;
    if (origin !== expectedOrigin) throw Object.assign(new Error('拒绝跨站请求'), { statusCode: 403 });
  };

  const authenticate = async (request: AuthenticatedRequest, _reply: FastifyReply): Promise<void> => {
    const raw = request.cookies[sessionCookie];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const sessionId = unsigned?.valid ? unsigned.value : undefined;
    const session = sessions.get(sessionId);
    if (!sessionId || !session) throw Object.assign(new Error('请先登录管理面板'), { statusCode: 401 });
    request.sessionId = sessionId;
    request.csrfToken = session.csrfToken;
  };

  const authorizeMutation = async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    assertOrigin(request);
    await authenticate(request, reply);
    if (stringValue(request.headers['x-csrf-token']) !== request.csrfToken) {
      throw Object.assign(new Error('CSRF 校验失败'), { statusCode: 403 });
    }
  };

  const requireServerMode = (): void => {
    if (config.mode !== 'server') throw Object.assign(new Error('本地准备模式不允许执行此操作'), { statusCode: 403 });
  };

  const runLogged = async (id: string, action: 'status' | 'claim', title: string) => {
    const paths = accounts.paths(id);
    await accounts.get(id);
    await operations.append(id, paths, {
      source: 'manual', action, status: 'running', title: `${title}已开始`, message: '正在调用冻结的核心 CLI',
    });
    try {
      const result = await runner.run(id, paths, action);
      await operations.append(id, paths, {
        source: 'manual', action, status: result.exitCode === 0 ? 'success' : 'failed',
        title: result.exitCode === 0 ? `${title}完成` : `${title}失败`,
        message: result.stdout || result.stderr || `核心命令退出码 ${result.exitCode}`,
        exitCode: result.exitCode,
      });
      return result;
    } catch (error) {
      await operations.append(id, paths, {
        source: 'manual', action, status: 'failed', title: `${title}异常`,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  app.setErrorHandler((error, _request, reply) => {
    const code = Number((error as { statusCode?: number }).statusCode ?? (error instanceof BusyError ? 409 : 400));
    const message = error instanceof Error ? error.message : '请求失败';
    void reply.code(code >= 400 && code <= 599 ? code : 500).send({ error: message || '请求失败' });
  });

  app.post('/api/session/login', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    assertOrigin(request);
    const password = stringValue((request.body as { password?: unknown } | null)?.password);
    if (!sessions.verifyPassword(password)) return reply.code(401).send({ error: '面板密码错误' });
    const session = sessions.create();
    reply.setCookie(sessionCookie, session.id, {
      path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies,
      signed: true, maxAge: 12 * 60 * 60,
    });
    return { authenticated: true, csrfToken: session.csrfToken };
  });

  app.get('/api/session/me', async (request) => {
    const raw = request.cookies[sessionCookie];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const session = sessions.get(unsigned?.valid ? unsigned.value : undefined);
    return session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false };
  });

  app.post('/api/session/logout', { preHandler: authorizeMutation }, async (request: AuthenticatedRequest, reply) => {
    sessions.delete(request.sessionId);
    reply.clearCookie(sessionCookie, { path: '/' });
    return { ok: true };
  });

  app.get('/api/system/capabilities', { preHandler: authenticate }, async () => ({
    mode: config.mode,
    provisioning: config.mode === 'provisioning',
    canExecute: config.mode === 'server',
    canSchedule: config.mode === 'server',
    panelDomain: config.panelDomain ?? '',
    publicBaseUrl: config.publicBaseUrl ?? '',
  }));

  app.get('/api/accounts', { preHandler: authenticate }, async () => ({ accounts: await accounts.summaries() }));

  app.post('/api/accounts', { preHandler: authorizeMutation }, async (request, reply) => {
    const body = request.body as { name?: unknown; schedule?: ScheduleConfig } | null;
    const manifest = await accounts.create(stringValue(body?.name) || '新账号', body?.schedule);
    await operations.append(manifest.id, accounts.paths(manifest.id), {
      source: 'manual', action: 'account', status: 'success', title: '账号目录已创建',
      message: '等待扫码登录；每个账号的认证、设备、状态和日志彼此隔离',
    });
    return reply.code(201).send({ account: await accounts.summary(manifest.id) });
  });

  app.patch('/api/accounts/:id', { preHandler: authorizeMutation }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: unknown; schedule?: ScheduleConfig } | null;
    const updated = await accounts.update(id, {
      ...(body?.name === undefined ? {} : { name: stringValue(body.name) }),
      ...(body?.schedule === undefined ? {} : { schedule: body.schedule }),
    }, config.mode === 'server');
    await operations.append(id, accounts.paths(id), {
      source: 'manual', action: 'schedule', status: 'success', title: '账号设置已保存',
      message: config.mode === 'server' && updated.pendingSchedule
        ? `签到设置将于 ${updated.pendingSchedule.effectiveDate} 生效`
        : '账号名称与签到时间窗已更新',
    });
    return { account: await accounts.summary(id) };
  });

  app.delete('/api/accounts/:id', { preHandler: authorizeMutation }, async (request) => {
    const { id } = request.params as { id: string };
    const confirmId = stringValue((request.body as { confirmId?: unknown } | null)?.confirmId);
    if (confirmId !== id) throw new Error('删除确认信息不匹配');
    const paths = accounts.paths(id);
    if (runner.isActive(id) || logins.isActive(id) || await runner.hasCoreClaimLock(paths)) {
      throw Object.assign(new Error('该账号正在执行任务，暂时不能删除'), { statusCode: 409 });
    }
    await accounts.delete(id);
    return { ok: true };
  });

  app.post('/api/accounts/:id/login/start', { preHandler: authorizeMutation }, async (request) => {
    const { id } = request.params as { id: string };
    return { job: await logins.start(id) };
  });

  app.get('/api/accounts/:id/login/status', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    await accounts.get(id);
    return { job: await logins.view(id) };
  });

  app.get('/api/accounts/:id/login/qr', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const qrPath = path.join(accounts.paths(id).runtime, 'login-qr.png');
    try { return reply.type('image/png').header('Cache-Control', 'no-store').send(await readFile(qrPath)); }
    catch { return reply.code(404).send({ error: '二维码尚未生成或已经失效' }); }
  });

  app.post('/api/accounts/:id/login/cancel', { preHandler: authorizeMutation }, async (request) => {
    const { id } = request.params as { id: string };
    return { job: await logins.cancel(id) };
  });

  app.post('/api/accounts/:id/logout', { preHandler: authorizeMutation }, async (request) => {
    const { id } = request.params as { id: string };
    if (logins.isActive(id)) await logins.cancel(id);
    const result = await runner.run(id, accounts.paths(id), 'logout');
    await accounts.disableSchedule(id);
    await operations.append(id, accounts.paths(id), {
      source: 'manual', action: 'logout', status: result.exitCode === 0 ? 'success' : 'failed',
      title: result.exitCode === 0 ? '账号已退出登录' : '退出登录失败',
      message: result.exitCode === 0 ? '认证信息已删除，设备身份保留，自动签到已停用' : (result.stdout || result.stderr),
      exitCode: result.exitCode,
    });
    return { result, account: await accounts.summary(id) };
  });

  app.post('/api/accounts/:id/status', { preHandler: authorizeMutation }, async (request) => {
    requireServerMode();
    const { id } = request.params as { id: string };
    const result = await runLogged(id, 'status', '状态刷新');
    return { result, account: await accounts.summary(id) };
  });

  app.post('/api/accounts/:id/claim', { preHandler: authorizeMutation }, async (request) => {
    requireServerMode();
    const { id } = request.params as { id: string };
    const result = await runLogged(id, 'claim', '手动签到');
    if ([10, 11, 20].includes(result.exitCode)) await accounts.disableSchedule(id);
    return { result, account: await accounts.summary(id) };
  });

  app.get('/api/accounts/:id/logs', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    await accounts.get(id);
    const paths = accounts.paths(id);
    return {
      operations: await operations.list(paths),
      lines: await runner.recentLogs(paths),
    };
  });

  app.get('/*', async (_request, reply) => reply.sendFile('index.html'));

  return app;
};

const run = async (): Promise<void> => {
  const config = loadControlConfig(true);
  const app = await buildControlServer(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(`EchoVIP Web 已启动：http://${config.host}:${config.port}（${config.mode}）`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
