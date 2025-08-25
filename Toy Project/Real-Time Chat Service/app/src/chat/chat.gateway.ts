import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

import { ChatService } from './chat.service';
import { RedisService } from '../redis/redis.service';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { CreateMessageDto } from './dto/create-message.dto';

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001', 'https://www.junhyung.xyz'],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private connectedUsers = new Map<string, { userId: string; username: string }>(); // socketId -> user info

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private redisService: RedisService,
  ) {}

  // Socket.IO 미들웨어: 핸드셰이크 단계에서 1회 JWT 검증 및 게스트 정책 적용
  afterInit(server: Server) {
    server.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token || (socket.handshake.headers?.authorization?.split(' ')[1]);
        if (!token) return next(new Error('Unauthorized: missing token'));

        const payload: any = this.jwtService.verify(token);
        const userId = payload?.sub;
        if (!userId || !String(userId).startsWith('guest_')) {
          return next(new Error('Unauthorized: guest only'));
        }
        // 검증된 사용자 정보를 소켓에 저장
        socket.data.user = payload;
        return next();
      } catch (err: any) {
        return next(new Error(`Unauthorized: ${err?.message || 'jwt error'}`));
      }
    });
  }

  async handleConnection(client: Socket) {
    try {
      // 미들웨어에서 검증·주입된 사용자 정보 사용
      const userId = client.data.user?.sub;
      if (!userId || !String(userId).startsWith('guest_')) {
        this.logger.warn('Unauthorized connection (missing/invalid user)');
        client.disconnect();
        return;
      }

      const username = client.data.user?.username || (userId?.split('_')[2]) || 'Guest';
      this.connectedUsers.set(client.id, { userId, username });
      if (!client.data.rooms) client.data.rooms = new Set<string>();

      // 각 사용자별 전용 룸에 조인 (다중 인스턴스에서도 유저 타겟 전송용)
      try {
        client.join(`user:${userId}`);
      } catch {}

      // 글로벌 온라인 사용자 상태를 Redis로 집계 (탭/연결 수 카운트)
      const onlineCountKey = `online:user:${userId}:count`;
      const onlineCount = await this.redisService.incr(onlineCountKey);
      if (onlineCount === 1) {
        await this.redisService.sAdd('online_users', userId);
      }

      this.logger.log(`Guest user ${username} (${userId}) connected`);

      // 전체 온라인 사용자 목록을 Redis에서 취득해 전달
      const allOnline = await this.redisService.getOnlineUsers();
      const currentOnlineUsers = allOnline.map((uid) => ({
        userId: uid,
        username: this.extractUsernameFromUserId(uid),
      }));
      client.emit('onlineUsers', currentOnlineUsers);

      client.broadcast.emit('userOnline', {
        userId,
        username,
        status: 'online',
        isGuest: true,
      });
    } catch (error) {
      this.logger.error('Connection error:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userInfo = this.connectedUsers.get(client.id);
    if (userInfo) {
      this.connectedUsers.delete(client.id);

      this.logger.log(`Guest user ${userInfo.username} (${userInfo.userId}) disconnected`);

      // Update all rooms this client has joined
      const joinedRooms: Set<string> = client.data.rooms || new Set<string>();
      joinedRooms.forEach((roomId: string) => {
        this.decrementRoomMemberRedis(roomId, userInfo.userId, userInfo.username);
        this.emitRoomOnlineUsers(roomId);
      });

      // 글로벌 온라인 사용자 상태 업데이트
      const onlineCountKey = `online:user:${userInfo.userId}:count`;
      const next = await this.redisService.decr(onlineCountKey);
      if (next <= 0) {
        await this.redisService.sRem('online_users', userInfo.userId);
        await this.redisService.del(onlineCountKey);
      }

      // Broadcast user offline status (global)
      client.broadcast.emit('userOffline', {
        userId: userInfo.userId,
        username: userInfo.username,
        status: 'offline',
        isGuest: true,
      });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() createMessageDto: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      const message = await this.chatService.createMessage(createMessageDto, userId);

      // Send message to room members
      this.server.to(createMessageDto.room).emit('newMessage', message);

      return { status: 'success', data: message };
    } catch (error) {
      this.logger.error('Send message error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      const room = await this.chatService.joinRoom(data.roomId, userId);

      client.join(data.roomId);
      // track membership in memory (per socket + per room)
      if (!client.data.rooms) client.data.rooms = new Set<string>();
      client.data.rooms.add(data.roomId);

      await this.incrementRoomMemberRedis(data.roomId, userId, client.data.user?.username || (userId?.split('_')[2]) || 'Guest');

      client.to(data.roomId).emit('userJoinedRoom', {
        userId,
        roomId: data.roomId,
      });

      // emit fresh room user list to all in the room (including self)
      await this.emitRoomOnlineUsers(data.roomId);

      return { status: 'success', data: room };
    } catch (error) {
      this.logger.error('Join room error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      await this.chatService.leaveRoom(data.roomId, userId);

      client.leave(data.roomId);
      if (client.data.rooms) client.data.rooms.delete(data.roomId);
      await this.decrementRoomMemberRedis(data.roomId, userId, client.data.user?.username || (userId?.split('_')[2]) || 'Guest');

      client.to(data.roomId).emit('userLeftRoom', {
        userId,
        roomId: data.roomId,
      });

      // emit fresh room user list to all in the room
      await this.emitRoomOnlineUsers(data.roomId);

      return { status: 'success' };
    } catch (error) {
      this.logger.error('Leave room error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      await this.chatService.markMessagesAsRead(data.roomId, userId);

      client.to(data.roomId).emit('messagesRead', {
        userId,
        roomId: data.roomId,
      });

      return { status: 'success' };
    } catch (error) {
      this.logger.error('Mark as read error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { roomId: string, isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user?.sub;
    
    if (!userId || !userId.startsWith('guest_') || !data?.roomId) {
      return;
    }

    // 사용자가 해당 룸에 조인되지 않은 경우(예외 상황) 방에 조인 처리
    try {
      if (data.roomId && !client.rooms.has(data.roomId)) {
        client.join(data.roomId);
      }
    } catch (e) {
      this.logger.warn(`Typing join fallback failed: ${e?.message || e}`);
    }

    // 동일 방의 다른 사용자에게만 브로드캐스트
    client.broadcast.to(data.roomId).emit('userTyping', {
      userId,
      roomId: data.roomId,
      isTyping: data.isTyping,
    });
  }

  // Method to send message to specific room (called from other services)
  sendToRoom(roomId: string, event: string, data: any) {
    this.server.to(roomId).emit(event, data);
  }

  // Method to send message to specific user (cluster-safe via user room)
  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Track and broadcast room online users using Redis (cluster-safe)
  private async incrementRoomMemberRedis(roomId: string, userId: string, username: string) {
    const key = `room:${roomId}:user:${userId}:count`;
    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.sAdd(`room:${roomId}:members`, userId);
    }
  }

  private async decrementRoomMemberRedis(roomId: string, userId: string, username: string) {
    const key = `room:${roomId}:user:${userId}:count`;
    const next = await this.redisService.decr(key);
    if (next <= 0) {
      await this.redisService.sRem(`room:${roomId}:members`, userId);
      await this.redisService.del(key);
    }
  }

  private async emitRoomOnlineUsers(roomId: string) {
    const members = await this.redisService.sMembers(`room:${roomId}:members`);
    const users = members.map((uid) => ({
      userId: uid,
      username: this.extractUsernameFromUserId(uid),
      hash: this.extractHashFromUserId(uid),
    }));
    this.server.to(roomId).emit('roomOnlineUsers', { roomId, users });
  }

  private extractHashFromUserId(userId: string): string {
    try {
      const parts = (userId || '').split('_');
      return parts[2] || 'Guest';
    } catch {
      return 'Guest';
    }
  }

  private extractUsernameFromUserId(userId: string): string {
    return this.extractHashFromUserId(userId);
  }
}
