import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];

    console.log('🔐 WS Guard - Checking token...');
    console.log('📋 WS Guard - Auth object:', JSON.stringify(client.handshake.auth, null, 2));
    console.log('🎫 WS Guard - Token found:', token ? 'Yes' : 'No');

    if (!token) {
      console.log('❌ WS Guard - No token, throwing unauthorized');
      throw new WsException('Unauthorized');
    }

    try {
      const payload = this.jwtService.verify(token);
      console.log('✅ WS Guard - JWT verified successfully');
      console.log('👤 WS Guard - Payload:', JSON.stringify(payload, null, 2));
      client.data.user = payload;
      console.log('💾 WS Guard - User data stored in client.data');
      return true;
    } catch (err) {
      console.log('❌ WS Guard - JWT verification failed:', err.message);
      throw new WsException('Unauthorized');
    }
  }
}