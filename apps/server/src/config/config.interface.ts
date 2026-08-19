export interface AppConfig {
  port: number;
  env: string;
  jwtSecret: string;
  jwtExpires: string;
}

export interface DatabaseConfig {
  mongoUri: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
}

export interface LlmConfig {
  provider: 'deepseek' | 'bailian' | 'ollama';
  model: string;
  apiKey?: string;
  baseUrl: string;
  ollamaModel?: string;
}

export interface EmbeddingConfig {
  model: string;
  dashscopeApiKey?: string;
}

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
}

export interface MinioConfig {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
}
