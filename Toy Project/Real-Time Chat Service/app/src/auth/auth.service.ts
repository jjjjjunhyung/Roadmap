import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';

import { User, UserDocument } from '../schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userModel.findOne({ email }).exec();
    if (user && await bcrypt.compare(password, user.password)) {
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user._id, username: user.username, email: user.email };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userModel.findOne({
      $or: [
        { email: registerDto.email },
        { username: registerDto.username },
      ],
    }).exec();

    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 12);
    const user = new this.userModel({
      ...registerDto,
      password: hashedPassword,
    });

    const savedUser = await user.save();
    const { password, ...result } = savedUser.toObject();

    const payload = { sub: result._id, username: result.username, email: result.email };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: result._id,
        username: result.username,
        email: result.email,
        avatar: result.avatar,
        status: result.status,
      },
    };
  }

  async findUserById(id: string): Promise<UserDocument> {
    // Check if it's a guest user ID (starts with 'guest_')
    if (id.startsWith('guest_')) {
      return null; // Guest users are not stored in database
    }
    return this.userModel.findById(id).exec();
  }

  async createGuestSession(nickname: string) {
    // Generate a unique guest ID
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const payload = { 
      sub: guestId, 
      username: nickname, 
      email: null,
      isGuest: true 
    };
    
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: guestId,
        username: nickname,
        email: null,
        avatar: null,
        status: 'online',
        isGuest: true,
      },
    };
  }

  async validateGuestUser(guestId: string): Promise<any> {
    // For guest users, we just need to validate the JWT payload
    // No database lookup needed
    return {
      _id: guestId,
      username: guestId.split('_')[2] || 'Guest',
      email: null,
      isGuest: true,
    };
  }
}
