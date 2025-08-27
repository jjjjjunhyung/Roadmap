import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Put,
  Query, 
  UseGuards, 
  Request,
  Delete,
  ForbiddenException,
  DefaultValuePipe,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';

import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  private validateGuestUser(userId: string) {
    if (!userId || !userId.startsWith('guest_')) {
      throw new ForbiddenException('Only guest users are allowed');
    }
  }

  @Get('rooms')
  async getRooms(
    @Request() req,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('before') before?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    this.validateGuestUser(req.user.sub);
    const rooms = await this.chatService.getRooms(req.user.sub, { limit, before });
    // Expose cursor for clients that opt-in to pagination
    if (Array.isArray(rooms) && rooms.length > 0 && res) {
      const oldest = rooms[rooms.length - 1]?.updatedAt;
      if (oldest) {
        try { res.setHeader('X-Next-Cursor', new Date(oldest).toISOString()); } catch {}
      }
    }
    return rooms;
  }

  @Post('rooms')
  async createRoom(@Body() createRoomDto: CreateRoomDto, @Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.createRoom(createRoomDto, req.user.sub);
  }

  @Post('rooms/:roomId/join')
  async joinRoom(@Param('roomId') roomId: string, @Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.joinRoom(roomId, req.user.sub);
  }

  @Delete('rooms/:roomId/leave')
  async leaveRoom(@Param('roomId') roomId: string, @Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.leaveRoom(roomId, req.user.sub);
  }

  @Get('rooms/:roomId/messages')
  async getRoomMessages(
    @Param('roomId') roomId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('before') before?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const messages = await this.chatService.getRoomMessages(roomId, { page, limit, before });
    // Add cursor header for clients that opt-in; body remains an array (ascending order)
    if (Array.isArray(messages) && messages.length > 0 && res) {
      // messages are sorted asc by createdAt; next cursor is first item's createdAt (fetch older)
      const oldest = messages[0]?.createdAt;
      if (oldest) {
        try { res.setHeader('X-Next-Cursor', new Date(oldest).toISOString()); } catch {}
      }
    }
    return messages;
  }

  @Delete('messages/:messageId')
  async deleteMessage(@Param('messageId') messageId: string, @Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.deleteMessage(messageId, req.user.sub);
  }

  @Put('messages/:messageId')
  async updateMessage(
    @Param('messageId') messageId: string,
    @Body() body: UpdateMessageDto,
    @Request() req,
  ) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.updateMessage(messageId, req.user.sub, body.content);
  }
}
