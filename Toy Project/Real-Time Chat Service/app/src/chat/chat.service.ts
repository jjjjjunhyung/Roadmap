import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Message, MessageDocument } from '../schemas/message.schema';
import { Room, RoomDocument } from '../schemas/room.schema';
import { RedisService } from '../redis/redis.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateRoomDto } from './dto/create-room.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    private redisService: RedisService,
  ) {}

  async createMessage(createMessageDto: CreateMessageDto, senderId: string): Promise<MessageDocument> {
    // Extract username from guest ID (format: guest_timestamp_username)
    const usernameFromId = senderId.split('_')[2] || 'Guest';
    
    // Create message in MongoDB for persistence
    const message = new this.messageModel({
      ...createMessageDto,
      sender: senderId,
      senderUsername: usernameFromId,
      senderAvatar: null, // Could be enhanced later
    });

    const savedMessage = await message.save();

    // Update room's last message
    await this.updateRoomLastMessage(createMessageDto.room, savedMessage._id.toString());

    // Publish to Redis for real-time delivery
    await this.redisService.publishMessage('chat_messages', {
      type: 'new_message',
      data: savedMessage,
    });

    return savedMessage;
  }

  async getRoomMessages(roomId: string, page: number = 1, limit: number = 50): Promise<MessageDocument[]> {
    const skip = (page - 1) * limit;
    
    return this.messageModel
      .find({ room: roomId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();
  }

  async createRoom(createRoomDto: CreateRoomDto, ownerId: string): Promise<RoomDocument> {
    const ownerUsername = ownerId.split('_')[2] || 'Guest';
    
    const room = new this.roomModel({
      ...createRoomDto,
      owner: null, // No database owner reference for guests
      members: [], // No members array for guest-only system
      guestOwner: ownerId,
      guestOwnerUsername: ownerUsername,
    });

    const savedRoom = await room.save();
    return savedRoom;
  }

  async getRooms(userId: string): Promise<RoomDocument[]> {
    // Return all public rooms for guest users
    const rooms = await this.roomModel
      .find({ type: 'public' })
      .populate({ path: 'lastMessage', select: 'content createdAt sender senderUsername' })
      .sort({ updatedAt: -1 })
      .exec();

    return rooms.filter(room => room && room.name);
  }

  async joinRoom(roomId: string, userId: string): Promise<RoomDocument> {
    const room = await this.roomModel.findById(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Publish join event to Redis for real-time updates
    await this.redisService.publishMessage('chat_messages', {
      type: 'user_joined',
      data: { roomId, userId },
    });
    
    return room;
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    // Publish leave event to Redis for real-time updates
    await this.redisService.publishMessage('chat_messages', {
      type: 'user_left',
      data: { roomId, userId },
    });
  }

  async markMessagesAsRead(roomId: string, userId: string): Promise<void> {
    await this.messageModel.updateMany(
      { room: roomId, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );
  }

  private async updateRoomLastMessage(roomId: string, messageId: string): Promise<void> {
    await this.roomModel.findByIdAndUpdate(roomId, {
      lastMessage: messageId,
      updatedAt: new Date(),
    });
  }

  async deleteMessage(messageId: string, userId: string): Promise<{ roomId: string; newLastMessage: MessageDocument | null }> {
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.sender !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.messageModel.findByIdAndDelete(messageId);

    await this.redisService.publishMessage('chat_messages', {
      type: 'message_deleted',
      data: { messageId, roomId: message.room },
    });

    // Update room's last message to the latest remaining message
    const latest = await this.messageModel
      .findOne({ room: message.room })
      .sort({ createdAt: -1 })
      .exec();

    await this.roomModel.findByIdAndUpdate(message.room, {
      lastMessage: latest ? latest._id : null,
      updatedAt: (latest as any)?.createdAt || new Date(),
    });

    return { roomId: message.room as any, newLastMessage: latest || null };
  }

  async updateMessage(messageId: string, userId: string, content: string) {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      throw new ForbiddenException('Content cannot be empty');
    }

    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.sender !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    message.content = trimmed;
    (message as any).edited = true;
    (message as any).editedAt = new Date();
    const saved = await message.save();

    await this.redisService.publishMessage('chat_messages', {
      type: 'message_edited',
      data: saved,
    });

    return saved;
  }
}
