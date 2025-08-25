import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const logger = new Logger('Worker');
  
  // Health check for Docker
  if (process.argv.includes('--health-check')) {
    process.exit(0);
  }

  const app = await NestFactory.create(WorkerModule);
  
  const redisService = app.get(RedisService);
  
  // Initialize worker streams and consumer groups
  await initializeStreams(redisService);
  
  // Start processing jobs
  startJobProcessing(redisService, logger);
  
  logger.log('🔧 Worker started and listening for jobs...');
  
  // Keep the process running
  process.on('SIGINT', async () => {
    logger.log('Worker shutting down...');
    await app.close();
    process.exit(0);
  });
}

async function initializeStreams(redisService: RedisService) {
  const streams = [
    'chat:notifications',
    'chat:file-processing',
    'chat:analytics',
  ];
  
  for (const stream of streams) {
    await redisService.xGroupCreate(stream, 'workers', '$');
  }
}

function startJobProcessing(redisService: RedisService, logger: Logger) {
  // Process notification jobs
  processStream('chat:notifications', redisService, logger, async (data) => {
    // Process notification jobs (email, push notifications, etc.)
    logger.log(`Processing notification: ${JSON.stringify(data)}`);
    // Add your notification logic here
  });
  
  // Process file processing jobs
  processStream('chat:file-processing', redisService, logger, async (data) => {
    // Process file uploads, image resizing, etc.
    logger.log(`Processing file: ${JSON.stringify(data)}`);
    // Add your file processing logic here
  });
  
  // Process analytics jobs
  processStream('chat:analytics', redisService, logger, async (data) => {
    // Process analytics data
    logger.log(`Processing analytics: ${JSON.stringify(data)}`);
    // Add your analytics logic here
  });
}

async function processStream(
  streamName: string, 
  redisService: RedisService, 
  logger: Logger,
  handler: (data: any) => Promise<void>
) {
  const groupName = 'workers';
  const consumerName = `worker-${process.pid}`;
  
  while (true) {
    try {
      const messages = await redisService.xReadGroup(
        groupName,
        consumerName,
        { [streamName]: '>' },
        1
      );
      
      if (messages && messages.length > 0) {
        for (const streamMessages of messages) {
          const [stream, streamData] = streamMessages;
          
          for (const [messageId, fields] of streamData) {
            try {
              // Process the job
              await handler(fields);
              
              // Acknowledge the message
              await redisService.xAck(stream, groupName, messageId);
              
              logger.log(`Processed job ${messageId} from ${stream}`);
            } catch (error) {
              logger.error(`Error processing job ${messageId}: ${error.message}`);
              // In a production system, you might want to:
              // 1. Retry the job
              // 2. Move to dead letter queue
              // 3. Send alerts
            }
          }
        }
      } else {
        // No messages, wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error(`Error reading from stream ${streamName}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

bootstrap().catch(error => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});