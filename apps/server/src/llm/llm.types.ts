export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<AsyncGenerator<string | null, void, unknown>> | Promise<string>;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}