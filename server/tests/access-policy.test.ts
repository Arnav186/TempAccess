import { describe, expect, it } from 'vitest'; import { accessDecision } from '../services/access-policy.js';
const base = { status: 'ACTIVE' as const, expiresAt: new Date('2030-01-01T00:00:00Z'), promptCount: 0, promptLimit: 2, tokenUsed: 0, tokenBudget: 100 };
describe('temporary AI access policy', () => {
  it('allows an active account within its limits', () => expect(accessDecision(base, 50, new Date('2029-01-01'))).toEqual({ allowed: true }));
  it('denies an expired account even when the client still has a session', () => expect(accessDecision({ ...base, expiresAt: new Date('2020-01-01') }, 1, new Date('2029-01-01'))).toEqual({ allowed: false, reason: 'expired' }));
  it('denies a revoked account', () => expect(accessDecision({ ...base, status: 'REVOKED' }, 1)).toEqual({ allowed: false, reason: 'inactive' }));
  it('denies prompt-limit bypass attempts', () => expect(accessDecision({ ...base, promptCount: 2 }, 1)).toEqual({ allowed: false, reason: 'prompt_limit' }));
  it('denies token-limit bypass attempts', () => expect(accessDecision({ ...base, tokenUsed: 90 }, 11)).toEqual({ allowed: false, reason: 'token_budget' }));
});
