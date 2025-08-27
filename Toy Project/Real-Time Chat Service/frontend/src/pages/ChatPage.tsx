import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Drawer,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
  Chat as ChatIcon,
} from '@mui/icons-material';
import { useInfiniteQuery, useQuery } from 'react-query';
import axios from 'axios';

import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import RoomList from '../components/RoomList';
import ChatArea from '../components/ChatArea';
import UserList from '../components/UserList';

const API_URL = process.env.REACT_APP_API_URL || '/api';

const ChatPage: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { currentRoom, setCurrentRoom, joinRoom, leaveRoom } = useSocket();
  const { user, logout } = useAuth();
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(!isMobile);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);

  const ROOMS_PAGE_SIZE = 50;
  const {
    data: roomsPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchRooms,
  } = useInfiniteQuery(
    'rooms',
    async ({ pageParam }): Promise<{ items: any[]; nextCursor: string | null }> => {
      const url = pageParam
        ? `${API_URL}/chat/rooms?limit=${ROOMS_PAGE_SIZE}&before=${encodeURIComponent(pageParam)}`
        : `${API_URL}/chat/rooms?limit=${ROOMS_PAGE_SIZE}`;
      const res = await axios.get(url);
      const nextCursor = (res.headers && (res.headers['x-next-cursor'] as string)) || null;
      return { items: res.data || [], nextCursor };
    },
    {
      getNextPageParam: (lastPage) => {
        if (!lastPage || !Array.isArray(lastPage.items)) return undefined;
        if (lastPage.items.length < ROOMS_PAGE_SIZE) return undefined;
        return lastPage.nextCursor || undefined;
      },
      refetchOnWindowFocus: true,
    }
  );

  const rooms: any[] = React.useMemo(() => {
    const flat = roomsPages?.pages.flatMap((p: any) => p.items) || [];
    const seen = new Set<string>();
    const dedup: any[] = [];
    for (const r of flat) {
      const id = r?._id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      dedup.push(r);
    }
    return dedup;
  }, [roomsPages]);

  const { data: messages = [], isLoading: messagesLoading, isFetching: messagesFetching } = useQuery(
    ['messages', currentRoom],
    () => currentRoom ? 
      axios.get(`${API_URL}/chat/rooms/${currentRoom}/messages?limit=20`).then(res => res.data) :
      Promise.resolve([]),
    {
      enabled: !!currentRoom,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      staleTime: 10000,
    }
  );

  useEffect(() => {
    if (currentRoom && rooms.length > 0) {
      const room = rooms.find((r: any) => r._id === currentRoom);
      setSelectedRoom(room);
    }
  }, [currentRoom, rooms]);

  useEffect(() => {
    if (isMobile) {
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    } else {
      setLeftDrawerOpen(true);
    }
  }, [isMobile]);

  const handleRoomSelect = (room: any) => {
    if (currentRoom && currentRoom !== room._id) {
      leaveRoom(currentRoom);
    }
    setCurrentRoom(room._id);
    setSelectedRoom(room);
    joinRoom(room._id);
    if (isMobile) {
      setLeftDrawerOpen(false);
    }
  };

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = () => {
    logout();
    handleUserMenuClose();
  };

  const drawerWidth = 280;
  const userListWidth = 240;

  const roomListContent = (
    <Box sx={{ width: drawerWidth, height: '100%' }}>
      <RoomList 
        rooms={rooms} 
        onRoomSelect={handleRoomSelect}
        selectedRoomId={currentRoom}
        loadMore={() => fetchNextPage()}
        hasNextPage={!!hasNextPage}
        fetchingNextPage={!!isFetchingNextPage}
      />
    </Box>
  );

  const userListContent = (
    <Box sx={{ width: userListWidth, height: '100%' }}>
      <UserList roomId={currentRoom} />
    </Box>
  );

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* 상단 네비게이션 바 */}
      <AppBar position="static" elevation={0} sx={{ 
        bgcolor: 'rgba(255,255,255,0.75)',
        color: 'text.primary',
        borderBottom: 1,
        borderColor: 'divider',
        backdropFilter: 'saturate(180%) blur(8px)'
      }}>
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
          
          <ChatIcon sx={{ mr: 2, color: 'primary.main' }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
            채팅 서비스
          </Typography>
          
          {!isMobile && currentRoom && (
            <IconButton
              onClick={() => setRightDrawerOpen(!rightDrawerOpen)}
              sx={{ mr: 1 }}
            >
              <PersonIcon />
            </IconButton>
          )}
          
          <IconButton onClick={handleUserMenuOpen} sx={{ ml: 1 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
              {user?.username?.[0]?.toUpperCase() || 'G'}
            </Avatar>
          </IconButton>
          
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
          >
            <MenuItem disabled>
              <Typography variant="body2" color="text.secondary">
                {user?.username || 'Guest'}
              </Typography>
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              <LogoutIcon sx={{ mr: 1 }} />
              로그아웃
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* 왼쪽 사이드바 - 채팅방 목록 */}
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={leftDrawerOpen}
            onClose={() => setLeftDrawerOpen(false)}
            ModalProps={{ keepMounted: true }}
          >
            {roomListContent}
          </Drawer>
        ) : (
          <Drawer
            variant="persistent"
            open={leftDrawerOpen}
            sx={{
              width: leftDrawerOpen ? drawerWidth : 0,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: drawerWidth,
                boxSizing: 'border-box',
                position: 'relative',
                height: '100%',
                border: 'none',
                borderRight: 1,
                borderColor: 'divider',
              },
            }}
          >
            {roomListContent}
          </Drawer>
        )}

        {/* 중앙 채팅 영역 */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {!currentRoom ? (
            <Box sx={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              bgcolor: 'background.default'
            }}>
              <Box sx={{ textAlign: 'center', p: 4 }}>
                <ChatIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h5" color="text.primary" gutterBottom>
                  채팅방을 선택하세요
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  왼쪽에서 채팅방을 선택하거나 새로운 채팅방을 만들어보세요
                </Typography>
              </Box>
            </Box>
          ) : (
            <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 0, minHeight: 0 }}>
              <ChatArea 
                key={currentRoom || 'no-room'}
                room={selectedRoom}
                roomId={currentRoom || undefined}
                messages={messages}
                loading={messagesLoading}
                fetching={messagesFetching}
                onRefresh={() => refetchRooms()}
              />
            </Paper>
          )}
        </Box>

        {/* 오른쪽 사이드바 - 사용자 목록 (데스크톱만) */}
        {!isMobile && currentRoom && (
          <Drawer
            variant="persistent"
            anchor="right"
            open={rightDrawerOpen}
            sx={{
              width: rightDrawerOpen ? userListWidth : 0,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: userListWidth,
                boxSizing: 'border-box',
                position: 'relative',
                height: '100%',
                border: 'none',
                borderLeft: 1,
                borderColor: 'divider',
              },
            }}
          >
            {userListContent}
          </Drawer>
        )}
      </Box>
    </Box>
  );
};

export default ChatPage;
