import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(private redisService: RedisService) {}

  async scheduleNotification(data: any): Promise<void> {
    await this.redisService.xAdd('chat:notifications', data);
    this.logger.log('Notification job scheduled');
  }

  async scheduleFileProcessing(data: any): Promise<void> {
    await this.redisService.xAdd('chat:file-processing', data);
    this.logger.log('File processing job scheduled');
  }

  async scheduleAnalytics(data: any): Promise<void> {
    await this.redisService.xAdd('chat:analytics', data);
    this.logger.log('Analytics job scheduled');
  }
}