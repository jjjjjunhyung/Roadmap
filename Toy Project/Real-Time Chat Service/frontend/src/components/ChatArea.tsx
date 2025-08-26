import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from 'react-query';
import {
  Box,
  TextField,
  IconButton,
  Typography,
  Paper,
  Avatar,
  Chip,
  Divider,
  Fade,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Send as SendIcon,
  Refresh as RefreshIcon,
  EmojiEmotions as EmojiIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { format, isToday, isYesterday } from 'date-fns';
import { ko } from 'date-fns/locale';
import axios from 'axios';

import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const PAGE_SIZE = 20;

interface Message {
  _id: string;
  content: string;
  sender: string;
  senderUsername: string;
  senderAvatar?: string;
  room: string;
  type: string;
  createdAt: string;
  edited?: boolean;
  editedAt?: string;
  readBy: string[];
  tempId?: string;
  isPending?: boolean;
}

interface ChatAreaProps {
  room: any;
  roomId?: string;
  messages: Message[];
  onRefresh: () => void;
  loading?: boolean;
  fetching?: boolean;
}

const ChatArea: React.FC<ChatAreaProps> = ({ room, roomId, messages, onRefresh, loading = false, fetching = false }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { socket, sendMessage, markAsRead, editMessage: wsEditMessage, deleteMessage: wsDeleteMessage } = useSocket();
  const [inputValue, setInputValue] = useState('');
  // typing indicator removed
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const activeRoomId = room?._id || roomId;
  const [isSwitching, setIsSwitching] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  // unread/new-message divider removed; lastSeen tracking not used
  const loadCooldownUntilRef = useRef<number>(0);
  const autoScrollRef = useRef<boolean>(true);
  const NEAR_BOTTOM_PX = 120;

  const forceScrollToBottom = () => {
    const doScroll = () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    };
    // Immediate
    doScroll();
    // After layout
    requestAnimationFrame(() => doScroll());
    // After async renders (images/fonts/layout)
    setTimeout(doScroll, 50);
    setTimeout(doScroll, 120);
  };

  const isNearBottomNow = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance < NEAR_BOTTOM_PX;
  };

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToBottomImmediate = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '--:--';
    
    if (isToday(date)) {
      return format(date, 'HH:mm', { locale: ko });
    } else if (isYesterday(date)) {
      return `어제 ${format(date, 'HH:mm', { locale: ko })}`;
    } else {
      return format(date, 'MM/dd HH:mm', { locale: ko });
    }
  };

  // 외부 messages 변경 시 반영: 방 전환 시 초기화되므로 그대로 병합
  useEffect(() => {
    setAllMessages(prev => {
      const map = new Map<string, Message>();
      prev.forEach(m => map.set(m._id, m));
      (messages || []).forEach(m => map.set(m._id, m));
      return Array.from(map.values());
    });
  }, [messages, activeRoomId]);

  // 새 메시지가 있을 때만 하단으로 자동 스크롤(사용자가 위로 스크롤 중이면 유지)
  useEffect(() => {
    if (allMessages.length > 0) {
      const allowAuto = autoScrollRef.current || isNearBottomNow();
      if (allowAuto) {
        setTimeout(() => scrollToBottom(), 50);
      }
    }
  }, [allMessages]);

  // 방이 바뀔 때 상태 초기화 + 읽음 처리 + 하단 정렬
  useEffect(() => {
    if (activeRoomId) {
      setIsSwitching(true);
      autoScrollRef.current = true; // 새로운 방에서는 기본적으로 하단 정렬
      // 캐시된 메시지가 있으면 즉시 표시해 깜빡임 방지
      const cached = (queryClient.getQueryData(['messages', activeRoomId]) as Message[] | undefined) || [];
      setAllMessages(cached);
      setPage(1);
      setHasMore(true);
      setShouldScrollToBottom(true);
      setIsUserScrolling(false);
      markAsRead(activeRoomId);
      // DOM 반영 직후 하단으로 강제 스크롤(여러 번 보장)
      forceScrollToBottom();
    }
    // cleanup 제거: lastSeenAt 미사용
    return () => {};
  }, [activeRoomId, markAsRead, queryClient]);

  // 실시간 삭제/수정 이벤트에 로컬 상태 동기화 (다른 사용자 액션 포함)
  useEffect(() => {
    if (!socket) return;
    const handleDeleted = ({ messageId, roomId }: any) => {
      if (!activeRoomId || roomId !== activeRoomId) return;
      setAllMessages(prev => prev.filter(m => m._id !== messageId));
    };
    const handleUpdated = (message: any) => {
      if (!activeRoomId || message.room !== activeRoomId) return;
      setAllMessages(prev => prev.map(m => (m._id === message._id ? { ...m, ...message } : m)));
    };
    socket.on('messageDeleted', handleDeleted);
    socket.on('messageUpdated', handleUpdated);
    return () => {
      socket.off('messageDeleted', handleDeleted);
      socket.off('messageUpdated', handleUpdated);
    };
  }, [socket, activeRoomId]);

  // 전환이 끝나면 스피너 해제: 첫 로딩이 끝나면 해제
  useEffect(() => {
    if (!loading && !fetching && isSwitching) {
      forceScrollToBottom();
      setIsSwitching(false);
    }
  }, [loading, fetching, isSwitching]);

  // 과거 메시지 로드 함수
  const loadMoreMessages = useCallback(async () => {
    if (!activeRoomId || isLoadingMore || !hasMore) return;
    // 과도한 호출 방지 쿨다운
    const now = Date.now();
    if (loadCooldownUntilRef.current && now < loadCooldownUntilRef.current) return;

    setIsLoadingMore(true);
    try {
      const response = await axios.get(
        `${API_URL}/chat/rooms/${activeRoomId}/messages?page=${page + 1}&limit=${PAGE_SIZE}`
      );
      const olderMessages = response.data;

      if (!Array.isArray(olderMessages)) {
        loadCooldownUntilRef.current = Date.now() + 2000;
      }

      if (olderMessages.length === 0) {
        setHasMore(false);
        loadCooldownUntilRef.current = Date.now() + 2000;
      } else {
        const container = messagesContainerRef.current;
        const previousScrollTop = container?.scrollTop || 0;
        const previousScrollHeight = container?.scrollHeight || 0;
        
        setAllMessages(prevMessages => {
          const existingIds = new Set(prevMessages.map(m => m._id));
          const newOlderMessages = olderMessages.filter((m: Message) => !existingIds.has(m._id));
          return [...newOlderMessages, ...prevMessages];
        });
        
        setPage(prevPage => prevPage + 1);
        // 마지막 페이지 추정: 페이지 크기 미만이면 더 없음
        if (olderMessages.length < PAGE_SIZE) {
          setHasMore(false);
          loadCooldownUntilRef.current = Date.now() + 2000;
        } else {
          loadCooldownUntilRef.current = Date.now() + 500;
        }
        
        // 스크롤 위치 유지
        setTimeout(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            const scrollDifference = newScrollHeight - previousScrollHeight;
            container.scrollTop = previousScrollTop + scrollDifference;
          }
        }, 50);
      }
    } catch (error) {
      console.error('과거 메시지 로드 실패:', error);
      loadCooldownUntilRef.current = Date.now() + 2000;
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeRoomId, page, isLoadingMore, hasMore]);

  // 스크롤 이벤트 핸들러
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    setIsUserScrolling(true);
    
    // 스크롤이 맨 위에 가까워지면 과거 메시지 로드
    if (container.scrollTop < 100 && hasMore && !isLoadingMore) {
      loadMoreMessages();
    }

    // 사용자가 맨 아래 근처에 있으면 새 메시지 시 자동 스크롤
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      setIsUserScrolling(false);
    }
    // 자동 스크롤 여부 갱신(바닥 근처일 때만 자동 스크롤 허용)
    autoScrollRef.current = isNearBottom;
    setShouldScrollToBottom(isNearBottom);
  }, [hasMore, isLoadingMore, loadMoreMessages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  const handleSend = () => {
    if (inputValue.trim() && activeRoomId) {
      sendMessage(inputValue.trim(), activeRoomId);
      setInputValue('');
      setShouldScrollToBottom(true);
      setIsUserScrolling(false);
    }
  };

  const startEdit = (message: any) => {
    setEditingMessageId(message._id);
    setEditingValue(message.content);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingValue('');
  };

  const submitEdit = () => {
    if (!editingMessageId || !activeRoomId) return;
    const content = editingValue.trim();
    if (!content) return;
    wsEditMessage(editingMessageId, activeRoomId, content);
    setEditingMessageId(null);
    setEditingValue('');
  };

  const confirmAndDelete = (message: any) => {
    if (!activeRoomId) return;
    const ok = window.confirm('이 메시지를 삭제하시겠습니까?');
    if (!ok) return;
    // Optimistic removal from local state and query cache
    const id = message._id;
    try {
      setAllMessages(prev => prev.filter((m) => m._id !== id));
      queryClient.setQueryData(['messages', activeRoomId], (oldData: any) => {
        const prev = Array.isArray(oldData) ? oldData : [];
        return prev.filter((m: any) => m._id !== id);
      });
      // Optimistically clear room preview if it points to this message
      queryClient.setQueryData('rooms', (oldData: any) => {
        if (!oldData || !Array.isArray(oldData)) return oldData;
        const updated = oldData.map((room: any) => {
          if (room._id !== activeRoomId) return room;
          if ((room.lastMessage as any)?._id === id) {
            return { ...room, lastMessage: null };
          }
          return room;
        });
        return updated;
      });
    } catch {}
    wsDeleteMessage(id, activeRoomId);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  // typing indicator removed

  // room 메타데이터가 아직 없더라도 메시지 렌더링은 유지

  // 화면에 사용할 소스: allMessages가 있으면 우선 사용, 없으면 props.messages 사용
  const sourceMessages: Message[] = (allMessages && allMessages.length > 0) ? allMessages : (messages || []);

  // 메시지를 시간 순으로 정렬 (오래된 것부터)
  const sortedMessages = [...sourceMessages].sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const groupedMessages = sortedMessages.reduce((groups: any[], message, index) => {
    const prevMessage = sortedMessages[index - 1];
    const shouldGroup = prevMessage && 
      prevMessage.sender === message.sender && 
      new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() < 60000;
    
    if (shouldGroup) {
      groups[groups.length - 1].messages.push(message);
    } else {
      groups.push({
        sender: message.sender,
        senderUsername: message.senderUsername,
        senderAvatar: message.senderAvatar,
        timestamp: message.createdAt,
        messages: [message]
      });
    }
    return groups;
  }, []);

  // 실제 메시지만 사용 - 테스트 메시지 제거
  const displayMessages = sortedMessages;
  const displayGroupedMessages = displayMessages.reduce((groups: any[], message, index) => {
    const prevMessage = displayMessages[index - 1];
    const shouldGroup = prevMessage && 
      prevMessage.sender === message.sender && 
      new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() < 60000;
    
    if (shouldGroup) {
      groups[groups.length - 1].messages.push(message);
    } else {
      groups.push({
        sender: message.sender,
        senderUsername: message.senderUsername,
        senderAvatar: message.senderAvatar,
        timestamp: message.createdAt,
        messages: [message]
      });
    }
    return groups;
  }, []);

  

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Room Header */}
      <Box sx={{ 
        p: 3, 
        borderBottom: 1, 
        borderColor: 'divider', 
        bgcolor: 'background.paper',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 1,
        backdropFilter: 'saturate(180%) blur(6px)'
      }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ 
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              width: 48,
              height: 48
            }}>
              {(room?.name?.[0] || '?').toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {room?.name || '채팅방'}
              </Typography>
              {room?.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {room?.description}
                </Typography>
              )}
            </Box>
          </Box>
          <Tooltip title="새로고침">
            <IconButton onClick={onRefresh} sx={{ color: 'text.secondary' }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Messages Area - 첫 메시지를 하단에 표시하고 스크롤바 표시 */}
      <Box 
        ref={messagesContainerRef}
        sx={{ 
          flex: 1, 
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          // 스크롤바 스타일링
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: '#f1f1f1',
            borderRadius: '10px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#888',
            borderRadius: '10px',
            '&:hover': {
              background: '#555',
            },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: '#888 #f1f1f1',
        }}
      >
        {((isSwitching || loading) && displayMessages.length === 0) || (fetching && displayMessages.length === 0) ? (
          <Box sx={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }}>
            <CircularProgress size={28} />
          </Box>
        ) : displayMessages.length === 0 ? (
          // 빈 상태 - 중앙 정렬
          <Box sx={{ 
            flex: 1,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            textAlign: 'center',
            p: 3
          }}>
            <Box>
              <EmojiIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                대화를 시작해보세요!
              </Typography>
              <Typography variant="body2" color="text.secondary">
                첫 번째 메시지를 보내서 채팅을 시작하세요
              </Typography>
            </Box>
          </Box>
        ) : (
          <>
            {/* 로딩 인디케이터 - 상단에 고정 */}
            {isLoadingMore && (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 2, gap: 1 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  과거 메시지를 불러오는 중...
                </Typography>
              </Box>
            )}

            {/* 상단 여백 (첫 메시지를 하단으로 밀어내기 위함) */}
            <Box sx={{ flex: 1 }} />

            {/* 메시지 목록 - 하단에 정렬 */}
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(() => {
                  const nodes: React.ReactNode[] = [];
                  let prevDayKey: string | null = null;
                  displayGroupedMessages.forEach((group: any, groupIndex: number) => {
                    const day = new Date(group.timestamp);
                    const dayKey = day.toDateString();
                    if (dayKey !== prevDayKey) {
                      nodes.push(
                        <Box key={`day-${group.timestamp}-${groupIndex}`} sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
                          <Chip label={
                            isToday(day)
                              ? '오늘'
                              : isYesterday(day)
                                ? '어제'
                                : format(day, 'yyyy.MM.dd', { locale: ko })
                          } size="small" />
                        </Box>
                      );
                      prevDayKey = dayKey;
                    }

                    nodes.push(
                      <Fade in key={`${group.sender}-${groupIndex}`} timeout={300}>
                        <Box sx={{ 
                          display: 'flex', 
                          flexDirection: group.sender === user?.id ? 'row-reverse' : 'row',
                          alignItems: 'flex-start',
                          gap: 1.5
                        }}>
                          {group.sender !== user?.id && (
                            <Avatar sx={{ 
                              width: 36, 
                              height: 36,
                              bgcolor: 'secondary.main',
                              fontSize: '0.875rem',
                              flexShrink: 0
                            }}>
                              {(group.senderUsername || 'G')[0].toUpperCase()}
                            </Avatar>
                          )}
                          
                          <Box sx={{ 
                            maxWidth: '70%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: group.sender === user?.id ? 'flex-end' : 'flex-start'
                          }}>
                            {/* Sender info */}
                            {group.sender !== user?.id && (
                              <Box sx={{ mb: 0.5, ml: 0.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                  {group.senderUsername || 'Guest'}
                                </Typography>
                              </Box>
                            )}
                            
                            {/* Messages */}
                            {group.messages.map((message: any, msgIndex: number) => (
                              <Paper
                                key={message._id || message.tempId}
                                elevation={0}
                                sx={{
                                  p: 2,
                                  mb: msgIndex < group.messages.length - 1 ? 0.5 : 1,
                                  maxWidth: '100%',
                                  bgcolor: group.sender === user?.id ? 'primary.main' : 'background.paper',
                                  opacity: message.isPending ? 0.7 : 1,
                                  color: group.sender === user?.id ? 'primary.contrastText' : 'text.primary',
                                  borderRadius: 2,
                                  boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
                                  border: group.sender !== user?.id ? '1px solid' : 'none',
                                  borderColor: 'divider',
                                  position: 'relative',
                                  '& .message-actions': {
                                    opacity: 0,
                                    visibility: 'hidden',
                                    transition: 'opacity .15s ease',
                                  },
                                  '&:hover .message-actions': {
                                    opacity: 1,
                                    visibility: 'visible',
                                  },
                                  '&:hover': {
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                                  }
                                }}
                              >
                                {editingMessageId === message._id ? (
                                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                                    <TextField
                                      fullWidth
                                      multiline
                                      maxRows={6}
                                      value={editingValue}
                                      onChange={(e) => setEditingValue(e.target.value)}
                                      variant="standard"
                                      InputProps={{
                                        sx: {
                                          color: group.sender === user?.id ? 'primary.contrastText' : 'text.primary',
                                        }
                                      }}
                                    />
                                    <IconButton size="small" onClick={submitEdit} aria-label="저장" sx={{ color: group.sender === user?.id ? 'primary.contrastText' : 'text.primary' }}>
                                      <CheckIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton size="small" onClick={cancelEdit} aria-label="취소" sx={{ color: group.sender === user?.id ? 'primary.contrastText' : 'text.primary' }}>
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Box>
                                ) : (
                                  <>
                                    <Typography 
                                      variant="body1" 
                                      sx={{ 
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        lineHeight: 1.5
                                      }}
                                    >
                                      {message.content}
                                    </Typography>
                                    {message.edited && (
                                      <Typography variant="caption" sx={{ opacity: 0.8 }}>
                                        (수정됨)
                                      </Typography>
                                    )}
                                    {/* My message actions */}
                                    {group.sender === user?.id && (
                              <Box className="message-actions" sx={{ position: 'absolute', top: 4, right: 6, display: 'flex', gap: 0.5 }}>
                                <Tooltip title="수정">
                                  <IconButton size="small" onClick={() => startEdit(message)} sx={{ color: group.sender === user?.id ? 'primary.contrastText' : 'text.secondary' }}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="삭제">
                                  <IconButton size="small" onClick={() => confirmAndDelete(message)} sx={{ color: group.sender === user?.id ? 'primary.contrastText' : 'text.secondary' }}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            )}
                          </>
                        )}
                      </Paper>
                    ))}
                            
                            {/* Timestamp */}
                            <Box sx={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 1,
                              mt: 0.5,
                              ml: group.sender === user?.id ? 0 : 0.5,
                              mr: group.sender === user?.id ? 0.5 : 0
                            }}>
                              <Typography variant="caption" color="text.secondary">
                                {formatMessageTime(group.timestamp)}
                              </Typography>
                            </Box>
                          </Box>
                        </Box>
                      </Fade>
                    );
                  });
                  return nodes;
                })()}

                {/* 스크롤 앵커 */}
                <div ref={messagesEndRef} style={{ height: '1px' }} />
              </Box>
            </Box>
            
          </>
        )}
      </Box>

      <Divider />

      {/* Input Area */}
      <Box sx={{ 
        p: 3, 
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        flexShrink: 0
      }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            variant="outlined"
            placeholder="메시지를 입력하세요..."
            value={inputValue}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3,
                bgcolor: 'background.default',
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                },
              },
            }}
          />
          <IconButton
            color="primary"
            onClick={handleSend}
            disabled={!inputValue.trim()}
            sx={{ 
              mb: 0.5,
              bgcolor: inputValue.trim() ? 'primary.main' : 'action.disabled',
              color: 'white',
              width: 48,
              height: 48,
              flexShrink: 0,
              '&:hover': {
                bgcolor: inputValue.trim() ? 'primary.dark' : 'action.disabled',
              },
              '&:disabled': {
                bgcolor: 'action.disabled',
                color: 'action.disabled',
              }
            }}
          >
            <SendIcon />
          </IconButton>
        </Box>
        {/* typing indicator removed */}
      </Box>
    </Box>
  );
};

export default ChatArea;
