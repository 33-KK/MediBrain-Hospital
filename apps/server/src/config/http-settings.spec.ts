import { httpSettings } from './http-settings';

describe('公网 HTTP 配置', () => {
  it('生产默认仅同源且不信任转发头，开发保留跨域调试', () => {
    expect(httpSettings({ NODE_ENV: 'production' })).toEqual({
      corsOrigins: false,
      trustProxy: [],
    });
    expect(httpSettings({ NODE_ENV: 'development' }).corsOrigins).toBe(true);
  });

  it('读取明确的来源列表和代理网段', () => {
    expect(
      httpSettings({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com, https://app.example.com',
        TRUST_PROXY_CIDRS: '127.0.0.1, 172.28.0.0/24, ::1/128',
      }),
    ).toEqual({
      corsOrigins: ['https://example.com', 'https://app.example.com'],
      trustProxy: ['127.0.0.1', '172.28.0.0/24', '::1/128'],
    });
  });

  it.each([
    '*',
    'https://example.com/path',
    'https://user:password@example.com',
    'https://example.com/',
    'file:///example',
    'https://example.com,',
  ])('拒绝无效跨域配置：%s', (origin) => {
    expect(() => httpSettings({ CORS_ORIGINS: origin })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it.each(['true', '2', '0.0.0.0/0', '::/0', '10.0.0.0/33', '::1/129', 'bad'])(
    '拒绝过宽或无效代理配置：%s',
    (proxy) => {
      expect(() => httpSettings({ TRUST_PROXY_CIDRS: proxy })).toThrow(
        'TRUST_PROXY_CIDRS',
      );
    },
  );
});
