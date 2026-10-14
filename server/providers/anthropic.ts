import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, ChatInput, ChatOutput, StreamChunkHandler } from './types.js';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  constructor(key: string) {
    this.client = new Anthropic({ apiKey: key });
  }

  async complete(input: ChatInput): Promise<ChatOutput> {
    const response = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxOutputTokens,
      system: input.system,
      messages: input.messages
    });
    const content = response.content.find(block => block.type === 'text');
    if (!content || content.type !== 'text') throw new Error('Claude returned an empty response.');
    return {
      content: content.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    };
  }

  async stream(input: ChatInput, onChunk: StreamChunkHandler): Promise<ChatOutput> {
    const stream = this.client.messages.stream({
      model: input.model,
      max_tokens: input.maxOutputTokens,
      system: input.system,
      messages: input.messages
    });
    stream.on('text', (delta) => {
      if (delta) onChunk(delta);
    });
    const final = await stream.finalMessage();
    const content = final.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('');
    return {
      content,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens
    };
  }
}

