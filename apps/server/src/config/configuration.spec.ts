import { appConfig, llmConfig, neo4jConfig } from './configuration';

describe('配置安全和模型切换', () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
  });

  it.each([
    '',
    'please-change-me',
    'short-secret',
    'REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARS',
  ])('生产模式拒绝不安全 JWT 密钥：%s', (secret) => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = secret;
    expect(() => appConfig()).toThrow('JWT_SECRET');
  });

  it('开发模式无配置时使用随机密钥', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const first = appConfig().jwtSecret;
    expect(first).toHaveLength(64);
    expect(appConfig().jwtSecret).not.toBe(first);
  });

  it('百炼选择对应的 key、地址与默认模型', () => {
    process.env.LLM_PROVIDER = 'bailian';
    process.env.BAILIAN_API_KEY = 'test-bailian';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek';
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.BAILIAN_BASE_URL;
    expect(llmConfig()).toMatchObject({
      apiKey: 'test-bailian',
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  });
  it('缺省使用本地 Ollama 模型', () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.OLLAMA_MODEL;
    expect(llmConfig()).toMatchObject({
      provider: 'ollama',
      model: 'qwen2.5:7b',
    });
  });
  it.each(['', 'change-me', 'REPLACE_WITH_NEO4J_PASSWORD'])(
    '拒绝缺失或占位 Neo4j 密码：%s',
    (password) => {
      process.env.NEO4J_PASSWORD = password;
      expect(() => neo4jConfig()).toThrow('NEO4J_PASSWORD');
    },
  );
});
