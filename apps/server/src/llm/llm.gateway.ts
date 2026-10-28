import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from './llm.types';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { OllamaProvider } from './providers/ollama.provider';

/**
 * 多模型网关：按配置选择 provider，
 * 统一 chat 接口，实现 DeepSeek / 百炼 / Ollama 零代码切换。
 */
@Injectable()
export class LlmGateway {
  private provider: LlmProvider;

  constructor(config: ConfigService) {
    const providerName = config.get<string>('llm.provider') ?? 'deepseek';

    if (providerName === 'ollama') {
      this.provider = new OllamaProvider(config);
    } else {
      this.provider = new OpenAiCompatibleProvider(config);
    }
  }

  get providerName(): string {
    return this.provider.name;
  }

  health(): Promise<boolean> {
    return this.provider.health();
  }

  chat(
    messages: Parameters<LlmProvider['chat']>[0],
    options?: Parameters<LlmProvider['chat']>[1],
  ) {
    return this.provider.chat(messages, options);
  }
}
