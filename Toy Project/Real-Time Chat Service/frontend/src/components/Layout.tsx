import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Badge,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Notifications as NotificationsIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const { connected, roomOnlineUsers } = useSocket();

  const handleLogout = () => {
    logout();
  };

  return (
    <Box sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar>
          <ChatIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            실시간 채팅
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Badge
              variant="dot"
              color={connected ? 'success' : 'error'}
              sx={{ mr: 1 }}
            >
              <Typography variant="body2">
                {connected ? '연결됨' : '연결 안됨'}
              </Typography>
            </Badge>
            
            <Typography variant="body2">
              방 참여자: {roomOnlineUsers.length}
            </Typography>
            
            <IconButton color="inherit">
              <NotificationsIcon />
            </IconButton>
            
            <IconButton color="inherit">
              <SettingsIcon />
            </IconButton>
            
            <Typography variant="body2" sx={{ ml: 2 }}>
              {user?.username}
            </Typography>
            
            <Button color="inherit" onClick={handleLogout}>
              로그아웃
            </Button>
          </Box>
        </Toolbar>
      </AppBar>
      
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </Box>
    </Box>
  );
};

export default Layout;