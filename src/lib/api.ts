export type Me =
  | { role: 'ADMIN'; csrfToken: string }
  | {
      role: 'TEMPORARY_USER';
      csrfToken: string;
      username: string;
      expiresAt: string;
      promptLimit: number;
      promptCount: number;
      tokenBudget: number;
      tokenUsed: number;
    };

let csrfToken = '';
export const setCsrf = (value?: string | null) => {
  csrfToken = value || '';
};

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(csrfToken && init.method && init.method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}),
      ...init.headers,
    },
    ...init,
  });
  const payload = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(payload?.error || 'Request failed.');
  return payload as T;
}

export type ChatStreamHandlers = {
  onStart?: (data: { conversationId: string }) => void;
  onChunk: (chunk: string) => void;
  onDone?: (data: { conversationId: string; message: string; usage?: ChatUsage }) => void;
  onError?: (err: Error) => void;
};

export type ChatUsage = { inputTokens: number; outputTokens: number };

export async function streamChat(
  params: { conversationId?: string; model: string; messages: { role: string; content: string }[]; attachment?: { name: string; content: string } | null; signal?: AbortSignal },
  handlers: ChatStreamHandlers
): Promise<{ conversationId: string; message: string; usage?: ChatUsage }> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    signal: params.signal,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: JSON.stringify({
      conversationId: params.conversationId,
      model: params.model,
      messages: params.messages,
      attachment: params.attachment || undefined,
      stream: true,
    }),
  });

  if (!response.ok) {
    let errMessage = 'Request failed.';
    try {
      const errJson = await response.json();
      errMessage = errJson.error || errMessage;
    } catch {
      // fallback to statusText
      errMessage = response.statusText || errMessage;
    }
    throw new Error(errMessage);
  }

  if (!response.body) {
    throw new Error('Readable stream not supported by browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulatedMessage = '';
  let activeConversationId = params.conversationId || '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const eventBlock of events) {
        if (!eventBlock.trim()) continue;
        let eventType = 'message';
        let dataStr = '';

        for (const line of eventBlock.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            dataStr = line.replace('data:', '').trim();
          }
        }

        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          if (eventType === 'start') {
            if (parsed.conversationId) {
              activeConversationId = parsed.conversationId;
              handlers.onStart?.(parsed);
            }
          } else if (eventType === 'chunk') {
            if (parsed.chunk) {
              accumulatedMessage += parsed.chunk;
              handlers.onChunk(parsed.chunk);
            }
          } else if (eventType === 'done') {
            activeConversationId = parsed.conversationId || activeConversationId;
            handlers.onDone?.(parsed);
            return {
              conversationId: activeConversationId,
              message: parsed.message || accumulatedMessage,
              usage: parsed.usage,
            };
          } else if (eventType === 'error') {
            throw new Error(parsed.error || 'Streaming error');
          }
        } catch (e) {
          if (eventType === 'error') throw e;
        }
      }
    }
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      return { conversationId: activeConversationId, message: accumulatedMessage };
    }
    const err = error instanceof Error ? error : new Error(String(error));
    handlers.onError?.(err);
    throw err;
  }

  return { conversationId: activeConversationId, message: accumulatedMessage };
}
