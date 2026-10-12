import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), PORT: z.coerce.number().default(3001),
  APP_ORIGIN: z.string().url(), DATABASE_URL: z.string().url(), SESSION_SECRET: z.string().min(32),
  MODEL_ALLOWLIST: z.string().default(''), OPENAI_API_KEY: z.string().optional(), GEMINI_API_KEY: z.string().optional(), ANTHROPIC_API_KEY: z.string().optional()
});
export const env = schema.parse(process.env);
export type ModelSpec = { provider: 'OPENAI' | 'GEMINI' | 'ANTHROPIC'; model: string; id: string };
export const allowedModels: ModelSpec[] = env.MODEL_ALLOWLIST.split(',').filter(Boolean).map(item => {
  const [provider, ...model] = item.trim().split(':'); const upper = provider.toUpperCase();
  if (!['OPENAI', 'GEMINI', 'ANTHROPIC'].includes(upper) || !model.join(':')) throw new Error(`Invalid MODEL_ALLOWLIST entry: ${item}`);
  return { provider: upper as ModelSpec['provider'], model: model.join(':'), id: `${provider.toLowerCase()}:${model.join(':')}` };
});
