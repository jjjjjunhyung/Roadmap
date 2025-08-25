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
  Divider,
  Fade,
} from '@mui/material';
import {
  Circle as CircleIcon,
  People as PeopleIcon,
} from '@mui/icons-material';

import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

interface UserListProps {
  roomId: string | null;
}

const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const { roomOnlineUsers } = useSocket();
  const { user } = useAuth();

  const currentUser = user;
  // 현재 방 기준의 온라인 사용자 목록
  const otherOnlineUsers = (roomOnlineUsers || []).filter(
    (u: any) => u.userId !== currentUser?.id
  );
  // 현재 사용자가 목록에 포함되어 오지 않을 수 있으므로 보정
  const isMeInRoom = (roomOnlineUsers || []).some((u: any) => u.userId === currentUser?.id);
  const totalCount = (isMeInRoom ? 1 : 0) + otherOnlineUsers.length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ 
        p: 3, 
        borderBottom: 1, 
        borderColor: 'divider',
        bgcolor: 'background.paper',
        backdropFilter: 'saturate(180%) blur(6px)'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <PeopleIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            온라인 사용자
          </Typography>
        </Box>
        <Chip 
          label={`${totalCount}명 접속 중`} 
          size="small" 
          color="success" 
          variant="outlined"
          sx={{ 
            borderRadius: 2,
            fontWeight: 500
          }}
        />
      </Box>

      {/* User List */}
      <List sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        {/* Current User (현재 방에 있을 때만 표시) */}
        {currentUser && isMeInRoom && (
          <Fade in timeout={300}>
            <ListItem dense sx={{ 
              mb: 1,
              bgcolor: 'primary.light',
              borderRadius: 2,
              color: 'primary.contrastText'
            }}>
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
                        width: 12, 
                        height: 12,
                        color: 'success.main',
                        bgcolor: 'background.paper',
                        borderRadius: '50%'
                      }} 
                    />
                  }
                >
                  <Avatar sx={{ 
                    width: 36, 
                    height: 36,
                    bgcolor: 'primary.dark',
                    color: 'primary.contrastText'
                  }}>
                    {(currentUser.username || 'M')[0].toUpperCase()}
                  </Avatar>
                </Badge>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {currentUser.username || 'Me'}
                    </Typography>
                  </Box>
                }
                secondary={(() => {
                  const me = (roomOnlineUsers || []).find((u: any) => u.userId === currentUser.id);
                  const hash = me?.hash;
                  if (!hash) return null;
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip 
                        label={`#${hash}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.6rem' }}
                      />
                    </Box>
                  );
                })()}
              />
            </ListItem>
          </Fade>
        )}

        {/* Divider if current user exists and there are other users */}
        {currentUser && isMeInRoom && otherOnlineUsers.length > 0 && (
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              다른 사용자
            </Typography>
          </Divider>
        )}

        {/* Other Online Users */}
        {otherOnlineUsers.map((onlineUser: any, index: number) => (
          <Fade in key={onlineUser.userId || onlineUser._id || index} timeout={300} style={{ transitionDelay: `${index * 50}ms` }}>
            <ListItem dense sx={{ 
              mb: 0.5,
              borderRadius: 2,
              '&:hover': {
                bgcolor: 'action.hover'
              }
            }}>
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
                        color: 'success.main'
                      }} 
                    />
                  }
                >
                  <Avatar sx={{ 
                    width: 32, 
                    height: 32,
                    bgcolor: 'secondary.main',
                    fontSize: '0.875rem'
                  }}>
                    {(onlineUser.username || onlineUser.name || 'G')[0].toUpperCase()}
                  </Avatar>
                </Badge>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {(onlineUser as any).username || (onlineUser as any).name || 'Guest'}
                  </Typography>
                }
                secondary={onlineUser.hash ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip 
                      label={`#${onlineUser.hash}`}
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.6rem' }}
                    />
                  </Box>
                ) : null}
              />
            </ListItem>
          </Fade>
        ))}
        
        {/* Empty State */}
        {otherOnlineUsers.length === 0 && !isMeInRoom && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <PeopleIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              온라인 사용자가 없습니다
            </Typography>
            <Typography variant="caption" color="text.secondary">
              다른 사용자가 접속하면 여기에 표시됩니다
            </Typography>
          </Box>
        )}

        {/* Only current user online */}
        {otherOnlineUsers.length === 0 && currentUser && isMeInRoom && (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              현재 혼자 접속 중입니다
            </Typography>
            <Typography variant="caption" color="text.secondary">
              다른 사용자의 접속을 기다리고 있습니다
            </Typography>
          </Box>
        )}
      </List>

      {/* Footer removed: 실시간 사용자 현황 */}
    </Box>
  );
};

export default UserList;
