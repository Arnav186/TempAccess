import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIProvider, ChatInput, ChatOutput, StreamChunkHandler } from './types.js';

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  constructor(key: string) {
    this.client = new GoogleGenerativeAI(key);
  }

  async complete(input: ChatInput): Promise<ChatOutput> {
    const model = this.client.getGenerativeModel({
      model: input.model,
      systemInstruction: input.system
    });
    const result = await model.generateContent({
      contents: input.messages.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      })),
      generationConfig: { maxOutputTokens: input.maxOutputTokens }
    });
    return {
      content: result.response.text(),
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0
    };
  }

  async stream(input: ChatInput, onChunk: StreamChunkHandler): Promise<ChatOutput> {
    const model = this.client.getGenerativeModel({
      model: input.model,
      systemInstruction: input.system
    });
    const resultStream = await model.generateContentStream({
      contents: input.messages.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      })),
      generationConfig: { maxOutputTokens: input.maxOutputTokens }
    });
    let content = '';
    for await (const chunk of resultStream.stream) {
      const text = chunk.text();
      if (text) {
        content += text;
        onChunk(text);
      }
    }
    const response = await resultStream.response;
    return {
      content,
      inputTokens: response.usageMetadata?.promptTokenCount ?? Math.ceil(input.messages.reduce((s, m) => s + m.content.length, 0) / 3.5),
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? Math.ceil(content.length / 3.5)
    };
  }
}