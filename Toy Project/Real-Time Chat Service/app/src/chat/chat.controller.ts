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
} from '@nestjs/common';

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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('before') before?: string,
  ) {
    return this.chatService.getRoomMessages(roomId, { page, limit, before });
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
