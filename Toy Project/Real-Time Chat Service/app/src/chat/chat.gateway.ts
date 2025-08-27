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

      // 로비 룸에 조인: 참가하지 않은 방 목록 업데이트(roomUpdated)를 로비 범위로만 브로드캐스트
      try {
        client.join('lobby');
      } catch {}

      // 각 사용자별 전용 룸에 조인 (다중 인스턴스에서도 유저 타겟 전송용)
      try {
        client.join(`user:${userId}`);
      } catch {}

      // 사용자 프로필(닉네임)을 Redis에 저장하여 방 목록 전송 시 활용
      try {
        const profileKey = `user:profile:${userId}`;
        await this.redisService.hSet(profileKey, 'username', username);
        await this.redisService.expire(profileKey, 60 * 60 * 24 * 2); // 2일 TTL
      } catch (e) {
        this.logger.warn(`Failed to cache user profile: ${e?.message || e}`);
      }

      // 글로벌 온라인 사용자 상태를 Redis로 집계 (탭/연결 수 카운트)
      const onlineCountKey = `online:user:${userId}:count`;
      const onlineCount = await this.redisService.incr(onlineCountKey);
      if (onlineCount === 1) {
        await this.redisService.sAdd('online_users', userId);
      }

      this.logger.log(`Guest user ${username} (${userId}) connected`);

      // 전역 온라인 사용자 이벤트/목록은 UI에서 사용하지 않으므로 송신하지 않음
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
      });

      // 글로벌 온라인 사용자 상태 업데이트
      const onlineCountKey = `online:user:${userInfo.userId}:count`;
      const next = await this.redisService.decr(onlineCountKey);
      if (next <= 0) {
        await this.redisService.sRem('online_users', userInfo.userId);
        await this.redisService.del(onlineCountKey);
      }

      // Also notify per-room listeners that the user left (on disconnect)
      try {
        joinedRooms.forEach((roomId: string) => {
          this.server.to(roomId).emit('userLeftRoom', {
            userId: userInfo.userId,
            roomId,
          });
        });
      } catch (e) {
        this.logger.warn(`Failed to emit userLeftRoom on disconnect: ${e?.message || e}`);
      }
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

      // Broadcast room last message update to all clients (for lobby/room list)
      try {
        this.server.to('lobby').emit('roomUpdated', {
          roomId: createMessageDto.room,
          lastMessage: {
            _id: (message as any)._id,
            content: (message as any).content,
            sender: (message as any).sender,
            senderUsername: (message as any).senderUsername,
            createdAt: (message as any).createdAt,
          },
        });
      } catch {}

      return { status: 'success', data: message };
    } catch (error) {
      this.logger.error('Send message error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @MessageBody() data: { messageId: string; content: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      const updated = await this.chatService.updateMessage(data.messageId, userId, data.content);
      // broadcast to room
      if (data.roomId) {
        this.server.to(data.roomId).emit('messageUpdated', updated);
      } else if ((updated as any)?.room) {
        this.server.to((updated as any).room).emit('messageUpdated', updated);
      }
      return { status: 'success', data: updated };
    } catch (error: any) {
      this.logger.error('Edit message error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('deleteMessage')
  async handleDeleteMessage(
    @MessageBody() data: { messageId: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.user?.sub;
      if (!userId || !userId.startsWith('guest_')) {
        return { status: 'error', message: 'Only guest users are allowed' };
      }

      const result = await this.chatService.deleteMessage(data.messageId, userId);
      // broadcast deletion to room with new last message info
      if (data.roomId) {
        this.server.to(data.roomId).emit('messageDeleted', { 
          messageId: data.messageId, 
          roomId: data.roomId,
          newLastMessage: result?.newLastMessage ? {
            _id: (result.newLastMessage as any)._id,
            content: (result.newLastMessage as any).content,
            sender: (result.newLastMessage as any).sender,
            senderUsername: (result.newLastMessage as any).senderUsername,
            createdAt: (result.newLastMessage as any).createdAt,
          } : null,
        });
        // Also notify all clients to refresh the room preview
        try {
          this.server.to('lobby').emit('roomUpdated', {
            roomId: data.roomId,
            lastMessage: result?.newLastMessage ? {
              _id: (result.newLastMessage as any)._id,
              content: (result.newLastMessage as any).content,
              sender: (result.newLastMessage as any).sender,
              senderUsername: (result.newLastMessage as any).senderUsername,
              createdAt: (result.newLastMessage as any).createdAt,
            } : null,
          });
        } catch {}
      }
      return { status: 'success', data: result };
    } catch (error: any) {
      this.logger.error('Delete message error (WS):', error);
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

      const username = client.data.user?.username || (userId?.split('_')[2]) || 'Guest';
      await this.incrementRoomMemberRedis(data.roomId, userId, username);
      
      client.to(data.roomId).emit('userJoinedRoom', {
        userId,
        roomId: data.roomId,
        username,
        hash: this.extractHashFromUserId(userId),
      });

      // 입장한 당사자에게만 현재 방 사용자 전체 목록을 전달 (기존 참가자는 증분 이벤트로 동기화)
      await this.emitRoomOnlineUsersToClient(client, data.roomId);

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

      // 나머지 참가자는 증분 이벤트로만 동기화

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
    const users = await this.hydrateUsersWithProfile(members);
    this.server.to(roomId).emit('roomOnlineUsers', { roomId, users });
  }

  // 특정 사용자에게만 현재 방 사용자 전체 목록을 전달
  private async emitRoomOnlineUsersToClient(client: Socket, roomId: string) {
    const members = await this.redisService.sMembers(`room:${roomId}:members`);
    const users = await this.hydrateUsersWithProfile(members);
    client.emit('roomOnlineUsers', { roomId, users });
  }

  private async hydrateUsersWithProfile(userIds: string[]) {
    const results = await Promise.all(
      (userIds || []).map(async (uid) => {
        try {
          const profileKey = `user:profile:${uid}`;
          const username = (await this.redisService.hGet(profileKey, 'username')) || this.extractUsernameFromUserId(uid);
          return {
            userId: uid,
            username,
            hash: this.extractHashFromUserId(uid),
          };
        } catch {
          return {
            userId: uid,
            username: this.extractUsernameFromUserId(uid),
            hash: this.extractHashFromUserId(uid),
          };
        }
      })
    );
    return results;
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
