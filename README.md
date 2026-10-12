# Temporary AI Platform

Temporary, credential-only access to a multi-provider AI workspace. Admins issue time-limited accounts with prompt quotas and token budgets. Passwords are shown once and stored as Argon2id hashes.

## Stack

- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS
- **Backend:** Express 5, TypeScript, Node.js 22+
- **Database:** PostgreSQL via Prisma 6 (Neon-compatible)
- **AI:** OpenAI, Google Gemini, Anthropic (official SDKs)
- **Security:** Helmet, CORS, HTTP-only sessions, CSRF, rate limiting, Argon2id

## Setup

```bash
npm install
cp .env.example .env          # fill in values (see below)
npm run prisma:generate
npm run prisma:deploy
npm run bootstrap:admin
npm run dev                   # open http://localhost:5173
```

## Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port (default `3001`) |
| `APP_ORIGIN` | Frontend origin (e.g. `http://localhost:5173`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 32+ char random string |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap admin credentials |
| `MODEL_ALLOWLIST` | e.g. `gemini:gemini-3.8-flash,openai:gpt-4o-mini` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | Provider keys (set only what you use) |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API + frontend (concurrent) |
| `npm run build` | Production frontend build |
| `npm start` | Run API only |
| `npm test` | Run Vitest tests |
| `npm run prisma:migrate` | Create + apply new migration (dev) |
| `npm run prisma:deploy` | Apply migrations (production) |
| `npm run bootstrap:admin` | Create admin account from env vars |

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login (admin or temp user) |
| `GET` | `/api/auth/me` | Current user info + CSRF token |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/models` | List available AI models |
| `POST` | `/api/admin/users` | Issue new credentials |
| `GET` | `/api/admin/users` | List all accounts |
| `POST` | `/api/admin/users/:id/revoke` | Revoke access |
| `DELETE` | `/api/admin/users/:id` | Delete account |
| `PATCH` | `/api/admin/users/:id/limits` | Update prompt/token limits |
| `GET` | `/api/admin/usage` | Aggregate usage stats |
| `POST` | `/api/chat` | Send message, get AI reply |
| `GET` | `/api/conversations` | List conversations |
| `GET/DELETE` | `/api/conversations/:id` | Get or delete a conversation |

Mutations require `X-CSRF-Token` header (returned at login).

## Security

- Passwords hashed with **Argon2id**, shown once, never stored in plaintext
- Sessions stored in PostgreSQL with hashed tokens; invalidated on login
- **HTTP-only, SameSite=Strict** cookies; CSRF header required for mutations
- **10 login attempts / 15 min**, 30 API calls / min rate limits
- Token quotas enforced with **atomic SQL reservation** before provider calls
- AI keys are **server-only** — never sent to the browser

## Production

```bash
npm run build && npm run prisma:deploy && NODE_ENV=production npm start
```

Serve `dist/` behind TLS. Set `APP_ORIGIN` to your HTTPS origin. Use a secrets manager for `SESSION_SECRET` and API keys — **never commit `.env`**.
