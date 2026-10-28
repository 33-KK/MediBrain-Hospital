import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // 兜底：第三方 SDK（如 Milvus gRPC）的内部异步 rejection 不允许崩进程
  process.on('unhandledRejection', (reason) => {
    logger.warn(
      `捕获未处理 Promise 拒绝（不影响服务）: ${(reason as Error)?.message ?? reason}`,
    );
  });

  app.setGlobalPrefix('api');
  const trustProxy = config.get<string[]>('app.trustProxy') ?? [];
  app.set('trust proxy', trustProxy.length ? trustProxy : false);
  app.enableCors({
    origin: config.get<boolean | string[]>('app.corsOrigins') ?? false,
    credentials: true,
  });
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
void bootstrap().catch((error: Error) => {
  Logger.error(error.message, 'Bootstrap');
  process.exitCode = 1;
});
