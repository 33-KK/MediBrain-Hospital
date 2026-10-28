import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatMessage, ChatOptions, LlmProvider } from '../llm.types';

/**
 * OpenAI 兼容协议适配器：DeepSeek 官方 / 阿里云百炼 共用。
 * 仅通过 baseUrl 与 apiKey 区分，符合多模型网关设计。
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  constructor(config: ConfigService) {
    const provider = config.get<string>('llm.provider') ?? 'deepseek';
    const apiKey = config.get<string>('llm.apiKey');
    const baseUrl = config.get<string>('llm.baseUrl');

    this.name = provider;
    this.model = config.get<string>('llm.model') ?? 'deepseek-chat';

    if (!apiKey) {
      this.logger.warn(
        `LLM provider=${provider} 未配置 API Key，仅可返回占位内容`,
      );
    }

    this.client = new OpenAI({
      apiKey: apiKey ?? 'sk-not-configured',
      baseURL: baseUrl,
      timeout: config.get<number>('llm.timeoutMs') ?? 40_000,
      maxRetries: 0,
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<string> {
    if (!this.client.apiKey || this.client.apiKey === 'sk-not-configured') {
      throw new UnauthorizedException('LLM API Key 未配置');
    }

    const res = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
      },
      { timeout: options.timeoutMs ?? this.client.timeout },
    );

    return res.choices[0]?.message?.content ?? '';
  }

  async health(): Promise<boolean> {
    if (this.client.apiKey === 'sk-not-configured') return false;
    try {
      const models = await this.client.models.list({ timeout: 3000 });
      return models.data.some((model) => model.id === this.model);
    } catch {
      return false;
    }
  }
}
