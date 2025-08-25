import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  // Enable CORS for frontend
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['https://www.junhyung.xyz', 'http://localhost:3001'];
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  // Use Redis adapter for Socket.IO (multi-instance scaling)
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // Set global prefix for API routes (exclude health and root)
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET }, 
      { path: '/health', method: RequestMethod.GET }
    ],
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  
  console.log(`💬 채팅 서버가 포트 ${port}에서 시작되었습니다...`);
  console.log(`🌐 서버 주소: http://localhost:${port}`);
  console.log(`🔗 WebSocket 네임스페이스: /chat`);
}

bootstrap();
