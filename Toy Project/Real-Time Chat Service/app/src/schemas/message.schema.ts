import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true })
  sender: string; // Guest user ID string (e.g., "guest_1755710410004_k7x4cb4ua")

  @Prop({ required: true })
  senderUsername: string; // Display name for the guest user

  @Prop({ default: null })
  senderAvatar: string; // Avatar URL for the guest user

  @Prop({ required: true })
  content: string;

  @Prop({ required: true })
  room: string;

  @Prop({ default: 'text', enum: ['text', 'image', 'file', 'system'] })
  type: string;

  @Prop({ default: null })
  fileUrl: string;

  @Prop({ default: null })
  fileName: string;

  @Prop({ default: null })
  fileSize: number;

  @Prop({ default: false })
  edited: boolean;

  @Prop({ type: Date, default: null })
  editedAt: Date;

  @Prop({ type: [String], default: [] })
  readBy: string[]; // Array of guest user IDs who have read the message
}

export const MessageSchema = SchemaFactory.createForClass(Message);
// Indexes for common query patterns
MessageSchema.index({ room: 1, createdAt: -1 });
