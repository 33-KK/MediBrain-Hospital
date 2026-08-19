import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 兜底：第三方 SDK（如 Milvus gRPC）的内部异步 rejection 不允许崩进程
  process.on('unhandledRejection', (reason) => {
    logger.warn(`捕获未处理 Promise 拒绝（不影响服务）: ${(reason as Error)?.message ?? reason}`);
  });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`MediBrain-Hospital API 已启动: http://localhost:${port}/api`);
}
bootstrap();
