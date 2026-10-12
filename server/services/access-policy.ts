export type AccessAccount = { status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'; expiresAt: Date; promptCount: number; promptLimit: number; tokenUsed: number; tokenBudget: number };
export function accessDecision(account: AccessAccount, reservationTokens: number, now = new Date()) {
  if (account.status !== 'ACTIVE') return { allowed: false, reason: 'inactive' as const };
  if (account.expiresAt <= now) return { allowed: false, reason: 'expired' as const };
  if (account.promptCount >= account.promptLimit) return { allowed: false, reason: 'prompt_limit' as const };
  if (account.tokenUsed + reservationTokens > account.tokenBudget) return { allowed: false, reason: 'token_budget' as const };
  return { allowed: true as const };
}
