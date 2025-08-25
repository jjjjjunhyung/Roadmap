import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { RedisModule } from '../redis/redis.module';
import { WorkerService } from './worker.service';
import databaseConfig from '../config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/chatdb?authSource=admin',
      }),
    }),
    RedisModule,
  ],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}