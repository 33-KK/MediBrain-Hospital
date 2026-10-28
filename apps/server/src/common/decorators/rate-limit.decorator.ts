import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions } from '../guards/rate-limit.guard';

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata('rateLimit', options);
