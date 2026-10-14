export type ChatInput = { system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; model: string; maxOutputTokens: number };
export type ChatOutput = { content: string; inputTokens: number; outputTokens: number };
export type StreamChunkHandler = (chunk: string) => void;
export interface AIProvider {
  complete(input: ChatInput): Promise<ChatOutput>;
  stream?(input: ChatInput, onChunk: StreamChunkHandler): Promise<ChatOutput>;
}

