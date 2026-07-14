# Login throttling

`functions/api/auth/_middleware.ts` protects `POST /api/auth/login` before the credential handler runs.

## Policy

- Key: SHA-256 of `CF-Connecting-IP` (or first `X-Forwarded-For`) plus normalized username
- Window: 15 minutes
- Threshold: 8 failed credential checks
- Block: 15 minutes
- Success: clears the key immediately
- Response while blocked: HTTP 429, `Retry-After`, `LOGIN_RATE_LIMITED`, and `Cache-Control: no-store`

A different username at the same address and the same username at a different address have independent counters. Raw IP addresses and usernames are not stored in the rate-limit table.

## Deployment

Apply migrations before deploying when possible:

```bash
npm run d1:migrate
```

Fresh schema setup includes `schema/auth-rate-limits.sql` through `npm run d1:schema` and `npm run d1:schema:local`.

If the middleware is deployed before `auth_login_limits` exists, it logs `auth rate-limit migration is missing` and temporarily lets the existing login handler continue. This avoids locking every user out during a staged deployment. Any other D1 lookup failure returns HTTP 503 rather than silently disabling the check.

## Verification

```bash
npm run test:integration:api
```

The integration suite runs real local Cloudflare Pages Functions and D1. It verifies reset on successful login, threshold blocking, `Retry-After`, no-store behavior, blocking before a correct-password attempt reaches the handler, and key isolation.
