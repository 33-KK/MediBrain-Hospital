import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMessage, ChatOptions, LlmProvider } from '../llm.types';

/**
 * Ollama 本地模型适配器（私有化部署兜底）。
 * 使用 /api/chat 流式协议。
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly logger = new Logger(OllamaProvider.name);

  constructor(config: ConfigService) {
    this.baseUrl =
      config.get<string>('llm.ollamaBaseUrl') ?? 'http://localhost:11434';
    this.model = config.get<string>('llm.ollamaModel') ?? 'qwen2.5:7b';
    this.timeoutMs = config.get<number>('llm.timeoutMs') ?? 40_000;
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          keep_alive: '30m',
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens ?? 256,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama 返回 ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? '';
    } catch (err) {
      this.logger.error(`Ollama 调用失败: ${(err as Error).message}`);
      throw err;
    }
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: { name: string }[] };
      return !!data.models?.some(
        (model) =>
          model.name.replace(/:latest$/, '') ===
          this.model.replace(/:latest$/, ''),
      );
    } catch {
      return false;
    }
  }
}
