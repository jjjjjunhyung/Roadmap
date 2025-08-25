import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Message } from './message.schema';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true })
export class Room {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: 'public', enum: ['public', 'private'] })
  type: string;

  @Prop({ type: String, default: null }) // Not used for guest-only system
  owner: string;

  @Prop({ type: [String], default: [] }) // Guest user IDs (not used in simplified system)
  members: string[];

  @Prop({ required: true }) // Guest owner ID (e.g., "guest_1755710410004_k7x4cb4ua")
  guestOwner: string;

  @Prop({ required: true }) // Guest owner username
  guestOwnerUsername: string;

  @Prop({ default: null })
  avatar: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: Message.name, default: null })
  lastMessage: Types.ObjectId | Message | null;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
