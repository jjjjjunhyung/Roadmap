import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findById(id: string): Promise<UserDocument> {
    // Check if it's a guest user ID (starts with 'guest_')
    if (id.startsWith('guest_')) {
      return null; // Guest users are not stored in database
    }
    return this.userModel.findById(id).select('-password').exec();
  }

  async findByEmail(email: string): Promise<UserDocument> {
    return this.userModel.findOne({ email }).exec();
  }

  async updateStatus(userId: string, status: string): Promise<void> {
    // Skip database update for guest users
    if (userId.startsWith('guest_')) {
      return;
    }
    await this.userModel.findByIdAndUpdate(userId, { 
      status, 
      lastSeen: new Date() 
    }).exec();
  }

  async findOnlineUsers(): Promise<UserDocument[]> {
    return this.userModel.find({ 
      status: { $ne: 'offline' } 
    }).select('-password').exec();
  }

  async searchUsers(query: string): Promise<UserDocument[]> {
    return this.userModel.find({
      $or: [
        { username: new RegExp(query, 'i') },
        { email: new RegExp(query, 'i') },
      ],
    }).select('-password').limit(20).exec();
  }
}