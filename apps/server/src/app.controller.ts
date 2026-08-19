import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { LlmGateway } from './llm/llm.gateway';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly llm: LlmGateway,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** 临时 LLM 连通性测试接口 */
  @Post('chat-test')
  async chatTest(@Body() body: { message: string }) {
    const reply = (await this.llm.chat(
      [
        { role: 'system', content: '你是医疗助手，请用中文简洁回答。' },
        { role: 'user', content: body.message ?? '你好' },
      ],
    )) as string;
    return { provider: this.llm.providerName, reply };
  }
}