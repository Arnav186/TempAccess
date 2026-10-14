import crypto from 'node:crypto';
import cors from 'cors'; import cookieParser from 'cookie-parser'; import express from 'express'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit';
import { AccountStatus, AuditAction, MessageRole, Provider, SessionRole } from '@prisma/client';
import { z } from 'zod';
import { allowedModels, env } from './config.js'; import { prisma } from './db.js'; import { clearSession, clientIp, createSession, getPrincipal, requireCsrf, requirePrincipal } from './security.js'; import { providerFor } from './providers/index.js';
import { hashPassword, verifyPassword } from './password.js';

const durationMinutes = z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240), z.number().int().min(5).max(10_080)]);
const createUserSchema = z.object({ durationMinutes, promptLimit: z.number().int().min(1).max(10_000).default(50), tokenBudget: z.number().int().min(1_000).max(10_000_000).default(100_000) });
const loginSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(512) });
const messageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(30_000) });
const attachmentSchema = z.object({ name: z.string().min(1).max(180), content: z.string().min(1).max(15_000) });
const chatSchema = z.object({ conversationId: z.string().uuid().optional(), model: z.string().min(3).max(200), messages: z.array(messageSchema).min(1).max(80), attachment: attachmentSchema.optional(), stream: z.boolean().optional() });
const limitsSchema = z.object({ promptLimit: z.number().int().min(1).max(10_000).optional(), tokenBudget: z.number().int().min(1_000).max(10_000_000).optional() }).refine(v => v.promptLimit !== undefined || v.tokenBudget !== undefined);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*_-';
const MAX_OUTPUT_TOKENS = 4096;
const password = () => Array.from({ length: 22 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
const username = () => `learner-${crypto.randomUUID().slice(0, 10)}@temporary.local`;
const estimateTokens = (messages: { content: string }[]) => Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 3.5);

function audit(action: AuditAction, input: { adminId?: string; userId?: string; ip?: string; metadata?: object }) { return prisma.auditEvent.create({ data: { action, administratorId: input.adminId, temporaryUserId: input.userId, ip: input.ip, metadata: input.metadata } }); }
function asProvider(value: string): Provider { return value as Provider; }

export function createApp() {
  const app = express(); app.set('trust proxy', 1);
  app.use(helmet()); app.use(cors({ origin: env.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] })); app.use(express.json({ limit: '64kb' })); app.use(cookieParser());
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
  const apiLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

  app.get('/api/auth/csrf', async (req, res) => { const principal = await getPrincipal(req); res.json({ csrfToken: principal?.csrfToken ?? null }); });
  app.post('/api/auth/login', authLimit, async (req, res, next) => {
    try {
      const { username: loginName, password: suppliedPassword } = loginSchema.parse(req.body); const ip = clientIp(req);
      const admin = await prisma.administrator.findUnique({ where: { email: loginName.toLowerCase() } });
      if (admin && await verifyPassword(admin.passwordHash, suppliedPassword)) { const csrfToken = await createSession(res, { role: 'ADMIN', id: admin.id }); await audit(AuditAction.LOGIN, { adminId: admin.id, ip }); return res.json({ role: 'ADMIN', csrfToken }); }
      const user = await prisma.temporaryUser.findUnique({ where: { username: loginName } });
      if (!user || user.status !== AccountStatus.ACTIVE || user.expiresAt <= new Date() || !(await verifyPassword(user.passwordHash, suppliedPassword))) { await audit(AuditAction.DENIED_CHAT, { ip, metadata: { reason: 'invalid_login' } }); return res.status(401).json({ error: 'Invalid or expired credentials.' }); }
      const csrfToken = await createSession(res, { role: 'TEMPORARY_USER', id: user.id, expiresAt: user.expiresAt }); await audit(AuditAction.LOGIN, { userId: user.id, ip }); res.json({
        role: 'TEMPORARY_USER',
        csrfToken,
        username: user.username,
        expiresAt: user.expiresAt,
        promptLimit: user.promptLimit,
        promptCount: user.promptCount,
        tokenBudget: user.tokenBudget,
        tokenUsed: user.tokenUsed,
      });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || !requireCsrf(req, res, principal)) return; await prisma.session.deleteMany({ where: { csrfToken: principal.csrfToken } }); await audit(AuditAction.LOGOUT, { adminId: principal.role === 'ADMIN' ? principal.administratorId : undefined, userId: principal.role === 'TEMPORARY_USER' ? principal.temporaryUserId : undefined, ip: clientIp(req) }); clearSession(res); res.status(204).end(); });
  app.get('/api/auth/me', async (req, res) => { const principal = await getPrincipal(req); if (!principal) return res.status(401).json({ error: 'Not authenticated.' }); if (principal.role === 'ADMIN') return res.json({ role: 'ADMIN', csrfToken: principal.csrfToken }); const user = await prisma.temporaryUser.findUnique({ where: { id: principal.temporaryUserId }, select: { username: true, expiresAt: true, promptLimit: true, promptCount: true, tokenBudget: true, tokenUsed: true } }); res.json({ role: 'TEMPORARY_USER', csrfToken: principal.csrfToken, ...user }); });
  app.get('/api/models', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal) return; const configured = allowedModels.filter(model => (model.provider === 'OPENAI' && env.OPENAI_API_KEY) || (model.provider === 'GEMINI' && env.GEMINI_API_KEY) || (model.provider === 'ANTHROPIC' && env.ANTHROPIC_API_KEY)); res.json(configured.map(model => ({ id: model.id, label: `${model.provider[0]}${model.provider.slice(1).toLowerCase()} · ${model.model}` }))); });

  app.post('/api/admin/users', apiLimit, async (req, res, next) => { try { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN' || !requireCsrf(req, res, principal)) return; const input = createUserSchema.parse(req.body); const rawPassword = password(); const expiresAt = new Date(Date.now() + input.durationMinutes * 60_000); const user = await prisma.temporaryUser.create({ data: { username: username(), passwordHash: await hashPassword(rawPassword), expiresAt, promptLimit: input.promptLimit, tokenBudget: input.tokenBudget, createdById: principal.administratorId } }); await audit(AuditAction.CREATE_USER, { adminId: principal.administratorId, ip: clientIp(req), metadata: { targetId: user.id, durationMinutes: input.durationMinutes } }); res.status(201).json({ id: user.id, username: user.username, password: rawPassword, expiresAt, promptLimit: user.promptLimit, tokenBudget: user.tokenBudget }); } catch (error) { next(error); } });
  app.get('/api/admin/users', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN') return; await prisma.temporaryUser.updateMany({ where: { status: AccountStatus.ACTIVE, expiresAt: { lte: new Date() } }, data: { status: AccountStatus.EXPIRED } }); const users = await prisma.temporaryUser.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, username: true, status: true, expiresAt: true, revokedAt: true, promptLimit: true, promptCount: true, tokenBudget: true, tokenUsed: true, createdAt: true } }); res.json(users); });
  app.post('/api/admin/users/:id/revoke', async (req, res, next) => { try { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN' || !requireCsrf(req, res, principal)) return; const now = new Date(); await prisma.$transaction([prisma.temporaryUser.update({ where: { id: req.params.id }, data: { status: AccountStatus.REVOKED, revokedAt: now } }), prisma.session.deleteMany({ where: { temporaryUserId: req.params.id } })]); await audit(AuditAction.REVOKE_USER, { adminId: principal.administratorId, ip: clientIp(req), metadata: { targetId: req.params.id } }); res.status(204).end(); } catch (error) { next(error); } });
  app.delete('/api/admin/users/:id', async (req, res, next) => { try { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN' || !requireCsrf(req, res, principal)) return; await prisma.temporaryUser.delete({ where: { id: req.params.id } }); await audit(AuditAction.DELETE_USER, { adminId: principal.administratorId, ip: clientIp(req), metadata: { targetId: req.params.id } }); res.status(204).end(); } catch (error) { next(error); } });
  app.patch('/api/admin/users/:id/limits', async (req, res, next) => { try { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN' || !requireCsrf(req, res, principal)) return; const update = limitsSchema.parse(req.body); const user = await prisma.temporaryUser.update({ where: { id: req.params.id }, data: update }); await audit(AuditAction.UPDATE_LIMITS, { adminId: principal.administratorId, ip: clientIp(req), metadata: { targetId: user.id, ...update } }); res.json(user); } catch (error) { next(error); } });
  app.get('/api/admin/usage', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'ADMIN') return; const [aggregate, activeUsers] = await Promise.all([prisma.usageLog.aggregate({ _sum: { inputTokens: true, outputTokens: true }, _count: true }), prisma.temporaryUser.count({ where: { status: AccountStatus.ACTIVE, expiresAt: { gt: new Date() } } })]); res.json({ requests: aggregate._count, inputTokens: aggregate._sum.inputTokens ?? 0, outputTokens: aggregate._sum.outputTokens ?? 0, activeUsers }); });

  app.get('/api/conversations', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'TEMPORARY_USER') return; const conversations = await prisma.conversation.findMany({ where: { temporaryUserId: principal.temporaryUserId }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, updatedAt: true } }); res.json(conversations); });
  app.post('/api/conversations', async (req, res, next) => { try { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'TEMPORARY_USER' || !requireCsrf(req, res, principal)) return; const title = z.object({ title: z.string().min(1).max(120).default('New conversation') }).parse(req.body).title; res.status(201).json(await prisma.conversation.create({ data: { title, temporaryUserId: principal.temporaryUserId } })); } catch (error) { next(error); } });
  app.get('/api/conversations/:id', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'TEMPORARY_USER') return; const conversation = await prisma.conversation.findFirst({ where: { id: req.params.id, temporaryUserId: principal.temporaryUserId }, include: { messages: { orderBy: { createdAt: 'asc' } } } }); if (!conversation) return res.status(404).json({ error: 'Conversation not found.' }); res.json(conversation); });
  app.delete('/api/conversations/:id', async (req, res) => { const principal = await requirePrincipal(req, res); if (!principal || principal.role !== 'TEMPORARY_USER' || !requireCsrf(req, res, principal)) return; const outcome = await prisma.conversation.deleteMany({ where: { id: req.params.id, temporaryUserId: principal.temporaryUserId } }); if (!outcome.count) return res.status(404).json({ error: 'Conversation not found.' }); res.status(204).end(); });

  app.post('/api/chat', apiLimit, async (req, res, next) => {
    try {
      const principal = await requirePrincipal(req, res);
      if (!principal || principal.role !== 'TEMPORARY_USER' || !requireCsrf(req, res, principal)) return;
      const input = chatSchema.parse(req.body);
      const spec = allowedModels.find(model => model.id === input.model);
      if (!spec) return res.status(400).json({ error: 'This model is not enabled.' });
      const providerMessages = input.attachment
        ? input.messages.map((message, index) => index === input.messages.length - 1
          ? { ...message, content: `${message.content}\n\nAttached document: ${input.attachment!.name}\n---\n${input.attachment!.content}\n---` }
          : message)
        : input.messages;
      const estimatedInput = estimateTokens(providerMessages), reserve = estimatedInput + MAX_OUTPUT_TOKENS, now = new Date();
      const reserved = await prisma.$executeRaw`UPDATE "TemporaryUser" SET "promptCount" = "promptCount" + 1, "tokenUsed" = "tokenUsed" + ${reserve} WHERE "id" = ${principal.temporaryUserId}::uuid AND "status" = 'ACTIVE'::"AccountStatus" AND "expiresAt" > ${now} AND "promptCount" < "promptLimit" AND "tokenUsed" + ${reserve} <= "tokenBudget"`;
      if (!reserved) {
        await audit(AuditAction.DENIED_CHAT, { userId: principal.temporaryUserId, ip: clientIp(req), metadata: { reason: 'expired_or_budget_limit' } });
        return res.status(403).json({ error: 'Access expired, revoked, prompt limit, or token budget reached.' });
      }
      const user = await prisma.temporaryUser.findUniqueOrThrow({ where: { id: principal.temporaryUserId } });
      const conversation = input.conversationId
        ? await prisma.conversation.findFirst({ where: { id: input.conversationId, temporaryUserId: user.id } })
        : await prisma.conversation.create({ data: { temporaryUserId: user.id, title: input.messages.find(message => message.role === 'user')?.content.slice(0, 60) || 'New conversation' } });
      if (!conversation) {
        await prisma.temporaryUser.update({ where: { id: user.id }, data: { promptCount: { decrement: 1 }, tokenUsed: { decrement: reserve } } });
        return res.status(404).json({ error: 'Conversation not found.' });
      }

      const wantsStream = input.stream === true || req.headers.accept === 'text/event-stream';
      const provider = providerFor(spec);

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        res.write(`event: start\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`);

        try {
          const chatInput = { model: spec.model, messages: providerMessages, maxOutputTokens: MAX_OUTPUT_TOKENS, system: 'Give complete, well-structured answers. For code, always include the full compilable solution and do not stop partway through a block.' };
          let output: { content: string; inputTokens: number; outputTokens: number };
          if (typeof provider.stream === 'function') {
            output = await provider.stream(chatInput, (chunk) => {
              res.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
            });
          } else {
            output = await provider.complete(chatInput);
            res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: output.content })}\n\n`);
          }

          const actual = output.inputTokens + output.outputTokens;
          await prisma.$transaction([
            prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.USER, content: input.messages.at(-1)?.content || '' } }),
            prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.ASSISTANT, content: output.content, provider: asProvider(spec.provider), model: spec.model, inputTokens: output.inputTokens, outputTokens: output.outputTokens } }),
            prisma.usageLog.create({ data: { temporaryUserId: user.id, provider: asProvider(spec.provider), model: spec.model, inputTokens: output.inputTokens, outputTokens: output.outputTokens } }),
            prisma.temporaryUser.update({ where: { id: user.id }, data: { tokenUsed: { decrement: Math.max(0, reserve - actual) } } }),
            prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
          ]);
          await audit(AuditAction.CHAT, { userId: user.id, ip: clientIp(req), metadata: { model: spec.id } });

          res.write(`event: done\ndata: ${JSON.stringify({ conversationId: conversation.id, message: output.content, usage: { inputTokens: output.inputTokens, outputTokens: output.outputTokens } })}\n\n`);
          res.end();
        } catch (streamError) {
          await prisma.temporaryUser.update({ where: { id: user.id }, data: { promptCount: { decrement: 1 }, tokenUsed: { decrement: reserve } } });
          const errorMessage = streamError instanceof Error ? streamError.message : 'Stream generation failed.';
          res.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`);
          res.end();
        }
      } else {
        const output = await provider.complete({ model: spec.model, messages: providerMessages, maxOutputTokens: MAX_OUTPUT_TOKENS, system: 'Give complete, well-structured answers. For code, always include the full compilable solution and do not stop partway through a block.' });
        const actual = output.inputTokens + output.outputTokens;
        await prisma.$transaction([
          prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.USER, content: input.messages.at(-1)?.content || '' } }),
          prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.ASSISTANT, content: output.content, provider: asProvider(spec.provider), model: spec.model, inputTokens: output.inputTokens, outputTokens: output.outputTokens } }),
          prisma.usageLog.create({ data: { temporaryUserId: user.id, provider: asProvider(spec.provider), model: spec.model, inputTokens: output.inputTokens, outputTokens: output.outputTokens } }),
          prisma.temporaryUser.update({ where: { id: user.id }, data: { tokenUsed: { decrement: Math.max(0, reserve - actual) } } }),
          prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
        ]);
        await audit(AuditAction.CHAT, { userId: user.id, ip: clientIp(req), metadata: { model: spec.id } });
        res.json({ conversationId: conversation.id, message: output.content, usage: { inputTokens: output.inputTokens, outputTokens: output.outputTokens } });
      }
    } catch (error) { next(error); }
  });
   app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => { if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request.', details: error.issues }); console.error(error); res.status(500).json({ error: 'Request failed.' }); }); return app;
}
