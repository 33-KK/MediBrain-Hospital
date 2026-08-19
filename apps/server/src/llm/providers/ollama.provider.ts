import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMessage, LlmProvider } from '../llm.types';

/**
 * Ollama 本地模型适配器（私有化部署兜底）。
 * 使用 /api/chat 流式协议。
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger = new Logger(OllamaProvider.name);

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('llm.ollamaBaseUrl') ?? 'http://localhost:11434';
    this.model = config.get<string>('llm.ollamaModel') ?? 'qwen2.5:7b';
  }

  async chat(
    messages: ChatMessage[],
    options: { temperature?: number } = {},
  ): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: { temperature: options.temperature ?? 0.7 },
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
}
