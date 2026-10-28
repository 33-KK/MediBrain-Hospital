import { isIP } from 'node:net';

/** Keep proxy trust explicit: never accept every forwarded client address. */
export function httpSettings(env: NodeJS.ProcessEnv = process.env) {
  const configuredOrigins = env.CORS_ORIGINS?.trim();
  const corsOrigins = configuredOrigins
    ? configuredOrigins.split(',').map((value) => {
        const origin = value.trim();
        let parsed: URL;
        try {
          parsed = new URL(origin);
        } catch {
          throw new Error('CORS_ORIGINS 必须是用逗号分隔的完整 HTTP(S) 来源');
        }
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.origin !== origin
        ) {
          throw new Error('CORS_ORIGINS 不能包含通配符、路径或账号信息');
        }
        return origin;
      })
    : env.NODE_ENV === 'production'
      ? false
      : true;

  const trustProxy = (env.TRUST_PROXY_CIDRS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const address of trustProxy) {
    const [ip, prefix, extra] = address.split('/');
    const version = isIP(ip);
    if (
      !version ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) === 0 ||
          Number(prefix) > (version === 4 ? 32 : 128)))
    ) {
      throw new Error('TRUST_PROXY_CIDRS 必须是可信代理的 IP 或具体 CIDR 网段');
    }
  }
  return { corsOrigins, trustProxy };
}
