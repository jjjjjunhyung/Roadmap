import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly startTime = new Date();

  getStatus() {
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    
    return {
      application: 'chat-service-nestjs',
      status: 'running',
      version: '1.0.0',
      framework: 'NestJS',
      environment: process.env.ENVIRONMENT || 'production',
      port: process.env.PORT || 3000,
      timestamp: new Date().toISOString(),
      uptime_seconds: uptime,
      started_at: this.startTime.toISOString(),
    };
  }
}