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

    // Update room's last message + denormalized summary
    await this.updateRoomLastMessage(createMessageDto.room, savedMessage);

    // Publish to Redis for real-time delivery
    await this.redisService.publishMessage('chat_messages', {
      type: 'new_message',
      data: savedMessage,
    });

    return savedMessage;
  }

  async getRoomMessages(
    roomId: string,
    options: { page?: number; limit?: number; before?: string } = {}
  ): Promise<any[]> {
    const { limit = 50, before } = options; // page ignored (cursor-based)

    const query: any = { room: roomId };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    const effectiveLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    // Fetch latest N in descending order, then return ascending to avoid client-side sorting
    const docs = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(effectiveLimit)
      .select('_id content sender senderUsername senderAvatar room type createdAt edited editedAt readBy')
      .lean()
      .exec();

    return docs.reverse();
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

  async getRooms(
    userId: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<any[]> {
    // Cursor-based pagination using updatedAt
    const { limit = 50, before } = options;
    const effectiveLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    const query: any = { type: 'public' };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.updatedAt = { $lt: beforeDate };
      }
    }

    // Return only fields the UI uses (+ fallbacks)
    const rooms = await this.roomModel
      .find(query)
      .select('name description type members lastMessage lastMessageSummary updatedAt')
      .sort({ updatedAt: -1 })
      .limit(effectiveLimit)
      .lean()
      .exec();

    const filtered = rooms.filter((room: any) => room && room.name);

    // Fallback: batch-fetch missing summaries by lastMessage IDs to keep compatibility
    const missingIds = filtered
      .filter((r: any) => r.lastMessage && !r.lastMessageSummary)
      .map((r: any) => String(r.lastMessage));

    let fallbackMap: Record<string, any> = {};
    if (missingIds.length > 0) {
      const msgs = await this.messageModel
        .find({ _id: { $in: missingIds } })
        .select('_id content sender senderUsername createdAt type edited editedAt')
        .lean()
        .exec();
      fallbackMap = msgs.reduce((acc: any, m: any) => {
        acc[String(m._id)] = m;
        return acc;
      }, {} as Record<string, any>);
    }

    return filtered.map((room: any) => {
      const fallback = room.lastMessage && fallbackMap[String(room.lastMessage)]
        ? {
            _id: String(fallbackMap[String(room.lastMessage)]._id),
            content: fallbackMap[String(room.lastMessage)].content,
            sender: fallbackMap[String(room.lastMessage)].sender,
            senderUsername: fallbackMap[String(room.lastMessage)].senderUsername,
            createdAt: fallbackMap[String(room.lastMessage)].createdAt,
            type: fallbackMap[String(room.lastMessage)].type,
            edited: fallbackMap[String(room.lastMessage)].edited || false,
            editedAt: fallbackMap[String(room.lastMessage)].editedAt || null,
          }
        : null;
      return {
        ...room,
        lastMessage: room.lastMessageSummary || fallback,
      };
    });
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

  private async updateRoomLastMessage(roomId: string, message: MessageDocument): Promise<void> {
    await this.roomModel.findByIdAndUpdate(roomId, {
      lastMessage: message._id,
      lastMessageSummary: {
        _id: String(message._id),
        content: message.content,
        sender: message.sender,
        senderUsername: (message as any).senderUsername,
        createdAt: (message as any).createdAt,
        type: (message as any).type,
        edited: (message as any).edited || false,
        editedAt: (message as any).editedAt || null,
      },
      updatedAt: (message as any).createdAt || new Date(),
    });
  }

  async deleteMessage(messageId: string, userId: string): Promise<{ roomId: string; newLastMessage: any | null }> {
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
      .lean()
      .exec();

    await this.roomModel.findByIdAndUpdate(message.room, {
      lastMessage: latest ? (latest as any)._id : null,
      lastMessageSummary: latest
        ? {
            _id: String((latest as any)._id),
            content: (latest as any).content,
            sender: (latest as any).sender,
            senderUsername: (latest as any).senderUsername,
            createdAt: (latest as any).createdAt,
            type: (latest as any).type,
            edited: (latest as any).edited || false,
            editedAt: (latest as any).editedAt || null,
          }
        : null,
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

    // If edited message is the last message of the room, sync summary
    try {
      await this.roomModel.updateOne(
        { _id: (saved as any).room, 'lastMessageSummary._id': String((saved as any)._id) },
        {
          $set: {
            lastMessageSummary: {
              _id: String((saved as any)._id),
              content: (saved as any).content,
              sender: (saved as any).sender,
              senderUsername: (saved as any).senderUsername,
              createdAt: (saved as any).createdAt,
              type: (saved as any).type,
              edited: true,
              editedAt: (saved as any).editedAt || new Date(),
            },
          },
        }
      );
    } catch {}

    return saved;
  }
}
