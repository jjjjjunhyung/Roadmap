import React, { useState } from 'react';
import {
  List,
  ListItem,
  ListItemButton,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Avatar,
  Fade,
  Badge,
} from '@mui/material';
import { 
  Add as AddIcon, 
  Group as GroupIcon
} from '@mui/icons-material';
import { useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { formatDistance } from 'date-fns';
import { ko } from 'date-fns/locale';

const API_URL = process.env.REACT_APP_API_URL || '/api';

interface Room {
  _id: string;
  name: string;
  description?: string;
  type: string;
  members: any[];
  lastMessage?: { content?: string } | any;
  updatedAt: string;
}

interface RoomListProps {
  rooms: Room[];
  onRoomSelect: (room: Room) => void;
  selectedRoomId: string | null;
}

const RoomList: React.FC<RoomListProps> = ({ rooms, onRoomSelect, selectedRoomId }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomDescription, setRoomDescription] = useState('');
  // 방 타입은 게스트 모드에서 공개만 지원하므로 입력 제거
  const queryClient = useQueryClient();

  const createRoomMutation = useMutation(
    (roomData: any) => axios.post(`${API_URL}/chat/rooms`, roomData),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('rooms');
        setDialogOpen(false);
        setRoomName('');
        setRoomDescription('');
      },
    }
  );

  const handleCreateRoom = () => {
    if (roomName.trim()) {
      // 서버는 공개방만 반환하므로 항상 public로 생성
      createRoomMutation.mutate({
        name: roomName,
        description: roomDescription,
        type: 'public',
      });
    }
  };

  const formatLastActivity = (dateString: string) => {
    if (!dateString || isNaN(new Date(dateString).getTime())) {
      return '방금 전';
    }
    return formatDistance(new Date(dateString), new Date(), { 
      addSuffix: true, 
      locale: ko 
    });
  };

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
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          채팅방
        </Typography>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => setDialogOpen(true)}
          fullWidth
          sx={{ 
            borderRadius: 2,
            textTransform: 'none',
            fontWeight: 500,
            py: 1.5
          }}
        >
          새 채팅방 만들기
        </Button>
      </Box>

      {/* Room List */}
      <List sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        {rooms.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <GroupIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              아직 채팅방이 없습니다
            </Typography>
            <Typography variant="caption" color="text.secondary">
              첫 번째 채팅방을 만들어보세요
            </Typography>
          </Box>
        ) : (
          rooms.map((room, index) => (
            <Fade in key={room._id} timeout={300} style={{ transitionDelay: `${index * 50}ms` }}>
              <ListItem disablePadding sx={{ mb: 1 }}>
                <ListItemButton
                  selected={selectedRoomId === room._id}
                  onClick={() => onRoomSelect(room)}
                  sx={{ 
                    borderRadius: 2,
                    p: 2,
                    transition: 'background-color .2s ease, transform .06s ease',
                    '&.Mui-selected': {
                      bgcolor: 'primary.light',
                      color: 'primary.contrastText',
                      '&:hover': {
                        bgcolor: 'primary.main',
                      }
                    },
                    '&:hover': {
                      bgcolor: 'action.hover',
                      transform: 'translateY(-1px)'
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 2 }}>
                    <Badge
                      badgeContent={room.members.length}
                      color="secondary"
                      max={99}
                      showZero={false}
                      sx={{
                        '& .MuiBadge-badge': {
                          fontSize: '0.6rem',
                          height: 16,
                          minWidth: 16,
                        }
                      }}
                    >
                      <Avatar sx={{ 
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        width: 44,
                        height: 44
                      }}>
                        {(room.name?.[0] || '?').toUpperCase()}
                      </Avatar>
                    </Badge>
                    
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography 
                          variant="subtitle2" 
                          noWrap 
                          sx={{ 
                            fontWeight: 600,
                            color: selectedRoomId === room._id ? 'inherit' : 'text.primary'
                          }}
                        >
                          {room.name}
                        </Typography>
                      </Box>
                      
                      <Typography 
                        variant="body2" 
                        color={selectedRoomId === room._id ? 'inherit' : 'text.secondary'}
                        noWrap
                        sx={{ mb: 0.5, opacity: 0.8 }}
                      >
                        {room.lastMessage?.content?.trim() || '메시지가 없습니다'}
                      </Typography>
                      
                      <Typography 
                        variant="caption" 
                        color={selectedRoomId === room._id ? 'inherit' : 'text.secondary'}
                        sx={{ opacity: 0.7 }}
                      >
                        {formatLastActivity(room.updatedAt)}
                      </Typography>
                    </Box>
                  </Box>
                </ListItemButton>
              </ListItem>
            </Fade>
          ))
        )}
      </List>

      {/* Create Room Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => setDialogOpen(false)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3 }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            새 채팅방 만들기
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            autoFocus
            margin="dense"
            label="방 이름"
            fullWidth
            variant="outlined"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            sx={{ mb: 3 }}
            placeholder="채팅방 이름을 입력하세요"
          />
          <TextField
            margin="dense"
            label="방 설명 (선택사항)"
            fullWidth
            multiline
            rows={2}
            variant="outlined"
            value={roomDescription}
            onChange={(e) => setRoomDescription(e.target.value)}
            sx={{ mb: 3 }}
            placeholder="채팅방에 대한 간단한 설명"
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button 
            onClick={() => setDialogOpen(false)}
            variant="outlined"
            sx={{ borderRadius: 2 }}
          >
            취소
          </Button>
          <Button 
            onClick={handleCreateRoom}
            disabled={!roomName.trim() || createRoomMutation.isLoading}
            variant="contained"
            sx={{ borderRadius: 2, minWidth: 100 }}
          >
            {createRoomMutation.isLoading ? '생성 중...' : '만들기'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RoomList;
