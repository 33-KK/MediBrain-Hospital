import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { GraphService } from './graph.service';
import { NEO4J_DRIVER } from './neo4j.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: NEO4J_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Driver => {
        const uri = config.get<string>('neo4j.uri') ?? 'bolt://localhost:7687';
        const user = config.get<string>('neo4j.user') ?? 'neo4j';
        const password = config.get<string>('neo4j.password');
        if (!password) throw new Error('必须配置真实 NEO4J_PASSWORD');

        return neo4j.driver(uri, neo4j.auth.basic(user, password), {
          maxConnectionPoolSize: 20,
          connectionTimeout: 10_000,
          connectionAcquisitionTimeout: 10_000,
          maxTransactionRetryTime: 0,
        });
      },
    },
    GraphService,
  ],
  exports: [NEO4J_DRIVER, GraphService],
})
export class Neo4jModule {}
