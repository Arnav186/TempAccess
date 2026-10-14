import { describe, expect, it } from 'vitest';
import type { AIProvider, ChatInput, ChatOutput, StreamChunkHandler } from '../providers/types.js';

class MockStreamingProvider implements AIProvider {
  async complete(input: ChatInput): Promise<ChatOutput> {
    return { content: 'Mock response', inputTokens: 10, outputTokens: 2 };
  }

  async stream(input: ChatInput, onChunk: StreamChunkHandler): Promise<ChatOutput> {
    const chunks = ['Hello', ' ', 'world', '!'];
    for (const chunk of chunks) {
      onChunk(chunk);
    }
    return { content: chunks.join(''), inputTokens: 12, outputTokens: 4 };
  }
}

describe('AIProvider streaming interface', () => {
  it('streams chunks progressively through onChunk callback', async () => {
    const provider = new MockStreamingProvider();
    const collectedChunks: string[] = [];

    const result = await provider.stream!(
      {
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hi' }],
        maxOutputTokens: 100,
      },
      (chunk) => {
        collectedChunks.push(chunk);
      }
    );

    expect(collectedChunks).toEqual(['Hello', ' ', 'world', '!']);
    expect(result.content).toBe('Hello world!');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(4);
  });
});
