import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Message } from './message.schema';

export type RoomDocument = Room & Document;

@Schema({ _id: false })
export class LastMessageSummary {
  @Prop({ type: String })
  _id: string; // Message ID as string

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({ type: String })
  sender: string;

  @Prop({ type: String })
  senderUsername: string;

  @Prop({ type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' })
  type: string;

  @Prop({ type: Date })
  createdAt: Date;

  @Prop({ type: Boolean, default: false })
  edited?: boolean;

  @Prop({ type: Date, default: null })
  editedAt?: Date | null;
}

export const LastMessageSummarySchema = SchemaFactory.createForClass(LastMessageSummary);

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

  @Prop({ type: LastMessageSummarySchema, default: null })
  lastMessageSummary: LastMessageSummary | null;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
// Indexes for filtering and ordering rooms
RoomSchema.index({ type: 1, updatedAt: -1 });
RoomSchema.index({ updatedAt: -1 });
