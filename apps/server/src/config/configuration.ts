import { registerAs } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { httpSettings } from './http-settings';

export const appConfig = registerAs('app', () => {
  const env = process.env.NODE_ENV ?? 'development';
  const configuredSecret = process.env.JWT_SECRET;
  const unsafeSecret =
    !configuredSecret ||
    ['please-change-me', 'change-me'].includes(configuredSecret) ||
    configuredSecret.startsWith('REPLACE_');
  if (env === 'production' && (unsafeSecret || configuredSecret.length < 32)) {
    throw new Error('生产环境必须配置至少 32 字符的独立 JWT_SECRET');
  }
  return {
    ...httpSettings(),
    port: parseInt(process.env.PORT ?? '3000', 10),
    env,
    jwtSecret: unsafeSecret
      ? randomBytes(32).toString('hex')
      : configuredSecret,
    jwtExpires: process.env.JWT_EXPIRES ?? '7d',
  };
});

export const databaseConfig = registerAs('database', () => ({
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/medibrain',
  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD,
}));

export const llmConfig = registerAs('llm', () => {
  const provider = process.env.LLM_PROVIDER ?? 'ollama';
  if (!['deepseek', 'bailian', 'ollama'].includes(provider)) {
    throw new Error('LLM_PROVIDER 必须是 deepseek、bailian 或 ollama');
  }
  const bailian = provider === 'bailian';
  return {
    provider,
    model:
      process.env.LLM_MODEL ??
      (provider === 'ollama'
        ? (process.env.OLLAMA_MODEL ?? 'qwen2.5:7b')
        : bailian
          ? 'qwen-plus'
          : 'deepseek-chat'),
    apiKey: bailian
      ? process.env.BAILIAN_API_KEY
      : process.env.DEEPSEEK_API_KEY,
    baseUrl:
      process.env.LLM_BASE_URL ??
      (bailian
        ? process.env.BAILIAN_BASE_URL
        : process.env.DEEPSEEK_BASE_URL) ??
      (bailian
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : 'https://api.deepseek.com'),
    timeoutMs: 40_000,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
  };
});

export const embeddingConfig = registerAs('embedding', () => ({
  model: process.env.EMBEDDING_MODEL ?? 'bge-m3',
  baseUrl: process.env.EMBEDDING_BASE_URL ?? 'http://localhost:11434',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
  milvusUri: process.env.MILVUS_URI ?? 'localhost:19540',
  collection: process.env.MILVUS_COLLECTION ?? 'entities',
  topK: parseInt(process.env.EMBEDDING_TOP_K ?? '5', 10),
  threshold: parseFloat(process.env.EMBEDDING_THRESHOLD ?? '0.6'),
}));

export const neo4jConfig = registerAs('neo4j', () => {
  const password = process.env.NEO4J_PASSWORD;
  if (!password || password === 'change-me' || password.startsWith('REPLACE_'))
    throw new Error('必须配置真实 NEO4J_PASSWORD');
  return {
    uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: process.env.NEO4J_USER ?? 'neo4j',
    password,
  };
});

export const minioConfig = registerAs('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'medibrain',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'medibrain-secret',
}));
