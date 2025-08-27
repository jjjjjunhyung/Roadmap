import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    // If handshake middleware already verified and attached the user, allow fast-path
    if ((client as any).data?.user) {
      return true;
    }

    // Fallback: verify once and cache on the socket (no verbose logging)
    const token = client.handshake?.auth?.token || client.handshake?.headers?.authorization?.split(' ')[1];
    if (!token) {
      throw new WsException('Unauthorized');
    }

    try {
      const payload: any = this.jwtService.verify(token);
      const userId = payload?.sub;
      if (!userId || !String(userId).startsWith('guest_')) {
        throw new WsException('Unauthorized');
      }
      (client as any).data = (client as any).data || {};
      (client as any).data.user = payload;
      return true;
    } catch (err) {
      throw new WsException('Unauthorized');
    }
  }
}
