import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'please-change-me',
  jwtExpires: process.env.JWT_EXPIRES ?? '7d',
}));

export const databaseConfig = registerAs('database', () => ({
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/medibrain',
  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD,
}));

export const llmConfig = registerAs('llm', () => ({
  provider: (process.env.LLM_PROVIDER ?? 'deepseek') as
    | 'deepseek'
    | 'bailian'
    | 'ollama',
  model: process.env.LLM_MODEL ?? 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl:
    process.env.LLM_BASE_URL ??
    process.env.DEEPSEEK_BASE_URL ??
    'https://api.deepseek.com',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
}));

export const embeddingConfig = registerAs('embedding', () => ({
  model: process.env.EMBEDDING_MODEL ?? 'bge-m3',
  baseUrl: process.env.EMBEDDING_BASE_URL ?? 'http://localhost:11434',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
  milvusUri: process.env.MILVUS_URI ?? 'localhost:19540',
  collection: process.env.MILVUS_COLLECTION ?? 'entities',
  topK: parseInt(process.env.EMBEDDING_TOP_K ?? '5', 10),
  threshold: parseFloat(process.env.EMBEDDING_THRESHOLD ?? '0.6'),
}));

export const neo4jConfig = registerAs('neo4j', () => ({
  uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  user: process.env.NEO4J_USER ?? 'neo4j',
  password: process.env.NEO4J_PASSWORD ?? 'medibrain-secret',
}));

export const minioConfig = registerAs('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'medibrain',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'medibrain-secret',
}));
