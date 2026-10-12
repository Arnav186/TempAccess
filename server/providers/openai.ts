import OpenAI from 'openai'; import type { AIProvider, ChatInput, ChatOutput } from './types.js';
export class OpenAIProvider implements AIProvider { private client: OpenAI; constructor(key: string) { this.client = new OpenAI({ apiKey: key }); }
  async complete(input: ChatInput): Promise<ChatOutput> { const completion = await this.client.chat.completions.create({ model: input.model, max_tokens: input.maxOutputTokens, messages: [...(input.system ? [{ role: 'system' as const, content: input.system }] : []), ...input.messages] }); const choice = completion.choices[0]?.message.content; if (!choice) throw new Error('OpenAI returned an empty response.'); return { content: choice, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 }; }
}
