/** Bounds the response even when an upstream client ignores its own timeout. */
export async function withinDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('请求处理超时');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('请求处理超时')), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
