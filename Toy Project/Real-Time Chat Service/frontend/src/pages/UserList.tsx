import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Badge,
  Chip,
} from '@mui/material';
import {
  Circle as CircleIcon,
} from '@mui/icons-material';
import { useQuery } from 'react-query';
import axios from 'axios';

import { useSocket } from '../contexts/SocketContext';

const API_URL = process.env.REACT_APP_API_URL || '/api';

interface UserListProps {
  roomId: string | null;
}

const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const { roomOnlineUsers } = useSocket();

  const { data: allOnlineUsers = [] } = useQuery(
    'onlineUsers',
    () => axios.get(`${API_URL}/users/online`).then(res => res.data),
    {
      refetchInterval: 30000, // Refetch every 30 seconds
    }
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" gutterBottom>
          온라인 사용자
        </Typography>
        <Chip 
          label={`${roomOnlineUsers.length}명 온라인`} 
          size="small" 
          color="success" 
          variant="outlined"
        />
      </Box>

      <List sx={{ flex: 1, overflow: 'auto' }}>
        {allOnlineUsers.map((user: any) => (
          <ListItem key={user._id} dense>
            <ListItemAvatar>
              <Badge
                overlap="circular"
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'right',
                }}
                badgeContent={
                  <CircleIcon 
                    sx={{ 
                      width: 10, 
                      height: 10,
                      color: roomOnlineUsers.some((u: any) => u.userId === user._id) ? 'success.main' : 'grey.400'
                    }} 
                  />
                }
              >
                <Avatar sx={{ width: 32, height: 32 }}>
                  {user.username[0].toUpperCase()}
                </Avatar>
              </Badge>
            </ListItemAvatar>
            <ListItemText
              primary={user.username}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {roomOnlineUsers.some((u: any) => u.userId === user._id) ? '온라인' : '오프라인'}
                </Typography>
              }
            />
          </ListItem>
        ))}
        
        {allOnlineUsers.length === 0 && (
          <ListItem>
            <ListItemText
              primary={
                <Typography color="text.secondary" align="center">
                  온라인 사용자가 없습니다
                </Typography>
              }
            />
          </ListItem>
        )}
      </List>
    </Box>
  );
};

export default UserList;