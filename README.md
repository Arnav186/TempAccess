# Temporary Access App

A compact Node.js + SQLite application for issuing password-only temporary accounts. It stores an Argon2id or bcrypt hash, never the plaintext password. Temporary users can sign in until their server-enforced expiry; administrators can revoke an account through the API. It uses Node's built-in SQLite module and WebAssembly hashing, avoiding native dependency compilation.

## Run locally

1. Install Node.js 22.5+ (Node 24+ is recommended, because the app uses Node's built-in SQLite module).
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`. For a non-local deployment, set a long random `ADMIN_API_KEY` and set `ALLOW_LOCAL_ADMIN=false`.
4. Run `npm start` and open `http://localhost:3000`.

For the local prototype, localhost may create credentials by default. Before any remote deployment, set `ALLOW_LOCAL_ADMIN=false` and configure a long random `ADMIN_API_KEY`; do not expose a local-admin mode publicly.

## API

- `POST /api/credentials` — administrator-only; creates a credential and returns its plaintext password once.
- `POST /api/login` — verifies an unexpired, non-revoked temporary credential and sets an HTTP-only session cookie.
- `POST /api/revoke/:id` — administrator-only; immediately revokes the credential and deletes its sessions.
- `GET /api/me` — confirms the current temporary session.

The SQLite database is created as `temp-access.db` at first run. Back it up and protect it like any authentication database. Before production deployment, add a proper administrator identity provider, CSRF protection for cookie-authenticated mutating routes, database backups/encryption, audit logging, and a scheduled job to delete expired credentials/resources.
