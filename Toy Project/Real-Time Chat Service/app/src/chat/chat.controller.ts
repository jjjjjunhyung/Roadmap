import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  UseGuards, 
  Request,
  Delete,
  ForbiddenException,
} from '@nestjs/common';

import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';

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
  async getRooms(@Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.getRooms(req.user.sub);
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
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
  ) {
    return this.chatService.getRoomMessages(roomId, page, limit);
  }

  @Delete('messages/:messageId')
  async deleteMessage(@Param('messageId') messageId: string, @Request() req) {
    this.validateGuestUser(req.user.sub);
    return this.chatService.deleteMessage(messageId, req.user.sub);
  }
}