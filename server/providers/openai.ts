import OpenAI from 'openai';
import type { AIProvider, ChatInput, ChatOutput, StreamChunkHandler } from './types.js';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  constructor(key: string) {
    this.client = new OpenAI({ apiKey: key });
  }

  async complete(input: ChatInput): Promise<ChatOutput> {
    const completion = await this.client.chat.completions.create({
      model: input.model,
      max_tokens: input.maxOutputTokens,
      messages: [...(input.system ? [{ role: 'system' as const, content: input.system }] : []), ...input.messages]
    });
    const choice = completion.choices[0]?.message.content;
    if (!choice) throw new Error('OpenAI returned an empty response.');
    return {
      content: choice,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0
    };
  }

  async stream(input: ChatInput, onChunk: StreamChunkHandler): Promise<ChatOutput> {
    const stream = await this.client.chat.completions.create({
      model: input.model,
      max_tokens: input.maxOutputTokens,
      messages: [...(input.system ? [{ role: 'system' as const, content: input.system }] : []), ...input.messages],
      stream: true,
      stream_options: { include_usage: true }
    });
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        content += delta;
        onChunk(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }
    if (!inputTokens) inputTokens = Math.ceil(input.messages.reduce((sum, m) => sum + m.content.length, 0) / 3.5);
    if (!outputTokens) outputTokens = Math.ceil(content.length / 3.5);
    return { content, inputTokens, outputTokens };
  }
}

