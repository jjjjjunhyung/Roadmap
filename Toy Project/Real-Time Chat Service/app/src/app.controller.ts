import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHome(@Res() res: Response) {
    // Serve the chat HTML page
    return res.sendFile('index.html', { root: './public' });
  }

  @Get('status')
  getStatus() {
    return this.appService.getStatus();
  }
}