import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('online')
  async getOnlineUsers() {
    return this.usersService.findOnlineUsers();
  }

  @Get('search')
  async searchUsers(@Query('q') query: string) {
    return this.usersService.searchUsers(query);
  }

  @Get('me')
  async getCurrentUser(@Request() req) {
    // Handle guest users
    if (req.user.isGuest) {
      return {
        id: req.user.sub,
        username: req.user.username,
        email: req.user.email,
        avatar: null,
        status: 'online',
        isGuest: true,
      };
    }
    return this.usersService.findById(req.user.sub);
  }
}