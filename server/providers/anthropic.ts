import Anthropic from '@anthropic-ai/sdk'; import type { AIProvider, ChatInput, ChatOutput } from './types.js';
export class AnthropicProvider implements AIProvider { private client: Anthropic; constructor(key: string) { this.client = new Anthropic({ apiKey: key }); }
  async complete(input: ChatInput): Promise<ChatOutput> { const response = await this.client.messages.create({ model: input.model, max_tokens: input.maxOutputTokens, system: input.system, messages: input.messages }); const content = response.content.find(block => block.type === 'text'); if (!content || content.type !== 'text') throw new Error('Claude returned an empty response.'); return { content: content.text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }; }
}
