export type ChatInput = { system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; model: string; maxOutputTokens: number };
export type ChatOutput = { content: string; inputTokens: number; outputTokens: number };
export interface AIProvider { complete(input: ChatInput): Promise<ChatOutput>; }
