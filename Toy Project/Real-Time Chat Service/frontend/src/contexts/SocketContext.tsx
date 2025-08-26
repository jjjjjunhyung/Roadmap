import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQueryClient } from 'react-query';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

// 메시지/방 목록은 React Query로 관리하므로
// 소켓 컨텍스트에 전역 상태로 보관하지 않습니다.
interface Message {
  _id: string;
  content: string;
  sender: string;
  senderUsername?: string;
  room: string;
  type: string;
  createdAt: string;
  readBy: string[];
}

interface OnlineUser {
  userId: string;
  username: string;
  hash?: string;
}

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  roomOnlineUsers: OnlineUser[];
  currentRoom: string | null;
  sendMessage: (content: string, room: string) => void;
  editMessage: (messageId: string, room: string, content: string) => void;
  deleteMessage: (messageId: string, room: string) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
  setCurrentRoom: (roomId: string | null) => void;
  markAsRead: (roomId: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

const WS_URL = process.env.REACT_APP_WS_URL || (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host;

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { user, token, logout } = useAuth();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [roomOnlineUsers, setRoomOnlineUsers] = useState<OnlineUser[]>([]);
  const currentRoomRef = React.useRef<string | null>(null);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  
  

  useEffect(() => {
    if (user && token) {
      const newSocket = io(`${WS_URL}/chat`, {
        auth: {
          token,
        },
        transports: ['websocket'],
      });

      newSocket.on('connect', () => {
        console.log('소켓 연결됨');
        setConnected(true);
      });

      newSocket.on('disconnect', () => {
        console.log('소켓 연결 해제됨');
        setConnected(false);
      });

      // 인증/연결 관련 에러 처리: 만료/서명 오류 시 세션 정리
      newSocket.on('connect_error', (err: any) => {
        console.error('소켓 연결 오류:', err?.message || err);
        if (/unauthorized|jwt|expired|signature/i.test(String(err?.message || ''))) {
          try { logout(); } catch {}
        }
      });

      newSocket.on('error', (err: any) => {
        console.warn('소켓 에러:', err?.message || err);
        if (/unauthorized|jwt|expired|signature/i.test(String(err?.message || ''))) {
          try { logout(); } catch {}
        }
      });

      newSocket.on('exception', (payload: any) => {
        const msg = typeof payload === 'string' ? payload : (payload?.message || '');
        console.warn('서버 예외:', msg);
        if (/unauthorized|jwt|expired|signature/i.test(String(msg))) {
          try { logout(); } catch {}
        }
      });

      newSocket.on('newMessage', (message: any) => {
        // 메시지 리스트 캐시 동기화: 해당 방의 messages 캐시에 새 메시지 선반영
        queryClient.setQueryData(['messages', message.room], (oldData: any) => {
          const prev = Array.isArray(oldData) ? oldData : [];
          const exists = prev.some((m: any) => m._id === message._id);
          if (exists) return prev;
          return [message, ...prev];
        });
        // 방 목록 미리보기 동기화: lastMessage 및 updatedAt 갱신
        queryClient.setQueryData('rooms', (oldData: any) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          const updated = oldData.map((room: any) => {
            if (room._id !== message.room) return room;
            // set full lastMessage with _id to ensure later delete/update checks work
            const lm = {
              _id: message._id,
              content: message.content,
              sender: message.sender,
              senderUsername: message.senderUsername,
              createdAt: message.createdAt,
            };
            return { ...room, lastMessage: lm, updatedAt: message.createdAt || new Date().toISOString() };
          });
          // 최신 메시지가 있는 방이 위로 오도록 정렬
          updated.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          return updated;
        });
      });

      newSocket.on('messageUpdated', (message: any) => {
        // Update specific message in cache
        const roomId = message.room;
        queryClient.setQueryData(['messages', roomId], (oldData: any) => {
          const prev = Array.isArray(oldData) ? oldData : [];
          return prev.map((m: any) => (m._id === message._id ? { ...m, ...message } : m));
        });
        // Update room preview if needed
        queryClient.setQueryData('rooms', (oldData: any) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          const updated = oldData.map((room: any) => {
            if (room._id !== roomId) return room;
            if (room.lastMessage && (room.lastMessage as any)?._id === message._id) {
              return { 
                ...room, 
                lastMessage: { 
                  _id: message._id,
                  content: message.content,
                  sender: message.sender,
                  senderUsername: message.senderUsername,
                  createdAt: message.createdAt,
                },
                updatedAt: message.editedAt || room.updatedAt 
              };
            }
            return room;
          });
          return updated;
        });
      });

      newSocket.on('messageDeleted', ({ messageId, roomId, newLastMessage }: any) => {
        // Remove message from cache
        queryClient.setQueryData(['messages', roomId], (oldData: any) => {
          const prev = Array.isArray(oldData) ? oldData : [];
          return prev.filter((m: any) => m._id !== messageId);
        });
        // If deleted was the lastMessage, conservatively clear preview content
        queryClient.setQueryData('rooms', (oldData: any) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          const updated = oldData.map((room: any) => {
            if (room._id !== roomId) return room;
            const currentLM: any = room.lastMessage || null;
            const shouldReplace = (
              !currentLM ||
              (currentLM && (currentLM as any)._id === messageId) ||
              (newLastMessage && currentLM?.createdAt && new Date(currentLM.createdAt).getTime() <= new Date(newLastMessage.createdAt).getTime())
            );
            if (shouldReplace) {
              if (newLastMessage) {
                return {
                  ...room,
                  lastMessage: { ...newLastMessage },
                  updatedAt: newLastMessage.createdAt || room.updatedAt,
                };
              }
              return { ...room, lastMessage: null, updatedAt: new Date().toISOString() };
            }
            return room;
          });
          // keep rooms ordered by updatedAt desc
          updated.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          return updated;
        });
      });

      // 전역 온라인 사용자 목록은 현재 UI에서 사용하지 않으므로 제거

      newSocket.on('userJoinedRoom', ({ userId, roomId }) => {
        console.log(`User ${userId} joined room ${roomId}`);
      });

      newSocket.on('userLeftRoom', ({ userId, roomId }) => {
        console.log(`User ${userId} left room ${roomId}`);
      });

      newSocket.on('messagesRead', ({ userId, roomId }) => {
        // 해당 방의 메시지 캐시에서 readBy 업데이트
        queryClient.setQueryData(['messages', roomId], (oldData: any) => {
          const prev = Array.isArray(oldData) ? oldData : [];
          return prev.map((msg: Message) => (
            msg.room === roomId && !msg.readBy.includes(userId)
              ? { ...msg, readBy: [...msg.readBy, userId] }
              : msg
          ));
        });
      });
      
      // Per-room online users
      newSocket.on('roomOnlineUsers', ({ roomId, users }: { roomId: string, users: OnlineUser[] }) => {
        if (currentRoomRef.current === roomId) {
          setRoomOnlineUsers(users || []);
        }
      });
      
      // (typing indicator removed)
      

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    } else {
      if (socket) {
        socket.close();
        setSocket(null);
        setConnected(false);
      }
    }
  }, [user, token]);

  const sendMessage = (content: string, room: string) => {
    if (socket && connected) {
      socket.emit('sendMessage', {
        content,
        room,
        type: 'text',
      });
    }
  };

  const editMessage = (messageId: string, room: string, content: string) => {
    if (socket && connected) {
      socket.emit('editMessage', { messageId, roomId: room, content });
    }
  };

  const deleteMessage = (messageId: string, room: string) => {
    if (socket && connected) {
      socket.emit('deleteMessage', { messageId, roomId: room });
    }
  };

  const joinRoom = (roomId: string) => {
    if (socket && connected) {
      socket.emit('joinRoom', { roomId });
    }
    // Optimistically include self until server list arrives
    if (user) {
      setRoomOnlineUsers([{ userId: user.id, username: user.username }]);
    } else {
      setRoomOnlineUsers([]);
    }
  };

  const leaveRoom = (roomId: string) => {
    if (socket && connected) {
      socket.emit('leaveRoom', { roomId });
    }
    // if leaving the current room, reset the per-room list
    if (currentRoomRef.current === roomId) {
      setRoomOnlineUsers([]);
    }
  };

  const markAsRead = (roomId: string) => {
    if (socket && connected) {
      socket.emit('markAsRead', { roomId });
    }
  };

  const value = {
    socket,
    connected,
    roomOnlineUsers,
    currentRoom,
    sendMessage,
    editMessage,
    deleteMessage,
    joinRoom,
    leaveRoom,
    setCurrentRoom,
    markAsRead,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
