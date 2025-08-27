import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { VariableSizeList as List } from 'react-window';
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
  // keyset pagination: we use 'before' cursor instead of page/skip
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const listRef = useRef<List>(null);
  const containerRef = useRef<HTMLDivElement>(null); // measures available size
  const listOuterRef = useRef<HTMLDivElement>(null); // scrollable element from react-window
  const [listHeight, setListHeight] = useState<number>(0);
  const [listWidth, setListWidth] = useState<number>(0);
  const listHeightObserver = useRef<any>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const activeRoomId = room?._id || roomId;
  const [isSwitching, setIsSwitching] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const editingInputRef = useRef<HTMLInputElement | null>(null);
  const editingValueRef = useRef<string>('');
  // unread/new-message divider removed; lastSeen tracking not used
  const loadCooldownUntilRef = useRef<number>(0);
  const autoScrollRef = useRef<boolean>(true);
  const NEAR_BOTTOM_PX = 120;
  // Cursor-based pagination support: server-provided cursor header
  const nextCursorRef = useRef<string | null>(null);

  const initScrolledRoomsRef = useRef<Record<string, boolean>>({});
  const forceScrollToBottom = () => {
    const toBottom = () => {
      try {
        const rowsLen = virtualRows.length;
        if (rowsLen > 0) {
          const roomKey = String(activeRoomId || '');
          const firstTime = roomKey && !initScrolledRoomsRef.current[roomKey];
          listRef.current?.scrollToItem(rowsLen - 1, firstTime ? 'end' : 'auto');
          if (firstTime) initScrolledRoomsRef.current[roomKey] = true;
        }
      } catch {}
    };
    toBottom();
    requestAnimationFrame(() => toBottom());
    setTimeout(toBottom, 50);
    setTimeout(toBottom, 120);
  };

  const isNearBottomNow = () => {
    const container = listOuterRef.current;
    if (!container) return true;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance < NEAR_BOTTOM_PX;
  };

  const scrollToBottom = () => {
    try {
      const rowsLen = virtualRows.length;
      if (rowsLen > 0) listRef.current?.scrollToItem(rowsLen - 1, 'auto');
    } catch {}
  };

  const scrollToBottomImmediate = () => {
    const rowsLen = virtualRows.length;
    if (rowsLen > 0) listRef.current?.scrollToItem(rowsLen - 1, 'end');
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
      // reset keyset paging state
      setHasMore(true);
      setShouldScrollToBottom(true);
      setIsUserScrolling(false);
      nextCursorRef.current = null; // reset server cursor on room change
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
      // 커서 기반 페이지네이션: 서버가 제공하는 X-Next-Cursor를 우선 사용
      let cursor = nextCursorRef.current;
      if (!cursor) {
        // 최초 호출 또는 헤더 미수신 시, 클라이언트에서 보유 중인 데이터로 추정 커서 계산
        const current: Message[] = (allMessages && allMessages.length > 0) ? allMessages : (messages || []);
        if (current.length > 0) {
          const oldest = current.reduce((min, m) => (new Date(m.createdAt).getTime() < new Date(min.createdAt).getTime() ? m : min), current[0]);
          cursor = oldest?.createdAt;
        }
      }

      const url = cursor
        ? `${API_URL}/chat/rooms/${activeRoomId}/messages?before=${encodeURIComponent(cursor)}&limit=${PAGE_SIZE}`
        : `${API_URL}/chat/rooms/${activeRoomId}/messages?limit=${PAGE_SIZE}`;
      const response = await axios.get(url);
      const olderMessages = response.data;
      const nextHeader = (response.headers && (response.headers['x-next-cursor'] as string)) || '';
      if (nextHeader) {
        nextCursorRef.current = nextHeader;
      }

      if (!Array.isArray(olderMessages)) {
        loadCooldownUntilRef.current = Date.now() + 2000;
      }

      if (olderMessages.length === 0) {
        setHasMore(false);
        loadCooldownUntilRef.current = Date.now() + 2000;
      } else {
        // prepend 전 스크롤 보정 정보 캡쳐
        captureBeforePrepend();
        setAllMessages(prevMessages => {
          const existingIds = new Set(prevMessages.map(m => m._id));
          const newOlderMessages = olderMessages.filter((m: Message) => !existingIds.has(m._id));
          return [...newOlderMessages, ...prevMessages];
        });
        // 헤더가 비어있다면, 이번 응답을 기준으로 다음 커서를 추정
        if (!nextHeader) {
          const last = olderMessages[olderMessages.length - 1];
          if (last?.createdAt) {
            nextCursorRef.current = last.createdAt;
          }
        }
        // 마지막 페이지 추정: 페이지 크기 미만이면 더 없음
        if (olderMessages.length < PAGE_SIZE) {
          setHasMore(false);
          loadCooldownUntilRef.current = Date.now() + 2000;
        } else {
          loadCooldownUntilRef.current = Date.now() + 500;
        }
      }
    } catch (error) {
      console.error('과거 메시지 로드 실패:', error);
      loadCooldownUntilRef.current = Date.now() + 2000;
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeRoomId, isLoadingMore, hasMore, allMessages, messages]);

  // react-window 스크롤 이벤트 핸들러
  const handleListScroll = useCallback(({ scrollOffset }: { scrollOffset: number }) => {
    const outer = listOuterRef.current;
    if (!outer) return;
    setIsUserScrolling(true);
    // 상단 근접 시 과거 메시지 로드
    if (scrollOffset < 100 && hasMore && !isLoadingMore) {
      loadMoreMessages();
    }
    // 하단 근접 여부 계산
    const distance = outer.scrollHeight - (outer.scrollTop + outer.clientHeight);
    const nearBottom = distance < 100;
    if (nearBottom) setIsUserScrolling(false);
    autoScrollRef.current = nearBottom;
    setShouldScrollToBottom(nearBottom);
  }, [hasMore, isLoadingMore, loadMoreMessages]);

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
    editingValueRef.current = message.content || '';
    // 포커스는 렌더 후 적용
    setTimeout(() => {
      try { editingInputRef.current?.focus(); } catch {}
    }, 0);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    editingValueRef.current = '';
  };

  const submitEdit = () => {
    if (!editingMessageId || !activeRoomId) return;
    const content = (editingInputRef.current?.value || '').trim();
    if (!content) return;
    wsEditMessage(editingMessageId, activeRoomId, content);
    setEditingMessageId(null);
    editingValueRef.current = '';
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

  // 메시지를 시간 순으로 정렬 (오래된 것부터) - 메모이즈
  const sortedMessages = useMemo(() => {
    return [...sourceMessages].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [sourceMessages]);

  // 실제 메시지만 사용 - 테스트 메시지 제거(현재는 그대로 사용)
  const displayMessages = sortedMessages;

  // 연속 메시지 그룹핑 계산 - 메모이즈
  const displayGroupedMessages = useMemo(() => {
    return displayMessages.reduce((groups: any[], message, index) => {
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
    }, [] as any[]);
  }, [displayMessages]);

  // 가상화용 플랫 로우 구성: 날짜 칩(row type 'day'), 그룹(row type 'group')
  type GroupRow = {
    type: 'group';
    key: string;
    group: any;
  };
  type DayRow = {
    type: 'day';
    key: string;
    day: Date;
  };
  type RowItem = GroupRow | DayRow;

  const virtualRows: RowItem[] = useMemo(() => {
    const rows: RowItem[] = [];
    let prevDayKey: string | null = null;
    displayGroupedMessages.forEach((group: any, idx: number) => {
      const day = new Date(group.timestamp);
      const dayKey = day.toDateString();
      if (dayKey !== prevDayKey) {
        rows.push({ type: 'day', key: `day-${dayKey}`, day });
        prevDayKey = dayKey;
      }
      rows.push({ type: 'group', key: `grp-${group.sender}-${group.timestamp}-${idx}`, group });
    });
    return rows;
  }, [displayGroupedMessages]);

  // List 크기 측정 (컨테이너 채우기)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const RO: any = (window as any).ResizeObserver;
    const onResize = () => {
      setListHeight(el.clientHeight);
      setListWidth(el.clientWidth);
    };
    if (RO) {
      const ro = new RO(() => onResize());
      listHeightObserver.current = ro;
      ro.observe(el);
      onResize();
      return () => {
        try { ro.disconnect(); } catch {}
        listHeightObserver.current = null;
      };
    } else {
      window.addEventListener('resize', onResize);
      onResize();
      return () => window.removeEventListener('resize', onResize);
    }
  }, []);

  // Row 높이 측정 맵과 사이즈 함수
  const sizeMapRef = useRef<Map<number, number>>(new Map());
  const setRowSize = useCallback((index: number, size: number) => {
    const prev = sizeMapRef.current.get(index);
    if (prev !== size) {
      sizeMapRef.current.set(index, size);
      // 리스트에 사이즈 변경 알리기
      listRef.current?.resetAfterIndex(index, false);
    }
  }, []);

  const getItemSize = useCallback((index: number) => {
    return sizeMapRef.current.get(index) || (virtualRows[index]?.type === 'day' ? 40 : 100);
  }, [virtualRows]);

  // 새 메시지나 방 전환 시 하단 정렬 유지
  useEffect(() => {
    if (virtualRows.length > 0 && (autoScrollRef.current || isNearBottomNow())) {
      const t = setTimeout(() => scrollToBottom(), 30);
      return () => clearTimeout(t);
    }
  }, [virtualRows]);

  // 과거 메시지 로드 시 스크롤 위치 유지 (scrollHeight 차이)
  const preserveScrollOnPrepend = useRef<{ top: number; height: number } | null>(null);
  useEffect(() => {
    // capture before
    const outer = listOuterRef.current;
    if (!outer) return;
    const before = preserveScrollOnPrepend.current;
    if (before) {
      // after render, adjust
      const adj = () => {
        const newHeight = outer.scrollHeight;
        const delta = newHeight - before.height;
        outer.scrollTop = before.top + delta;
        preserveScrollOnPrepend.current = null;
      };
      requestAnimationFrame(adj);
      setTimeout(adj, 30);
    }
  });

  // loadMoreMessages 훅에서 prepend 전 상태 저장
  const captureBeforePrepend = () => {
    const outer = listOuterRef.current;
    if (!outer) return;
    preserveScrollOnPrepend.current = { top: outer.scrollTop, height: outer.scrollHeight };
  };

  // react-window Row wrapper: 동적 높이 측정
  const MeasuredRow: React.FC<{ index: number; style: React.CSSProperties; setRowSize: (i: number, s: number) => void; children: React.ReactNode }> = ({ index, style, setRowSize, children }) => {
    const rowRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      const el = rowRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const h = Math.ceil(el.getBoundingClientRect().height);
        setRowSize(index, h);
      });
      ro.observe(el);
      // 초기 측정
      const initial = Math.ceil(el.getBoundingClientRect().height);
      setRowSize(index, initial);
      return () => ro.disconnect();
    }, [index, setRowSize]);
    return (
      <div style={style}>
        <div ref={rowRef} style={{ overflow: 'visible' }}>
          {children}
        </div>
      </div>
    );
  };

  // 메시지 리스트 가상화 뷰를 메모이즈하여 입력 타이핑 시 재렌더/재애니메이션 방지
  const listView = useMemo(() => {
    if (displayMessages.length === 0) return null;
    if (listHeight <= 0) return null;
    return (
      <List
        ref={listRef}
        height={listHeight}
        width={listWidth}
        itemCount={virtualRows.length}
        itemSize={getItemSize}
        outerRef={listOuterRef}
        overscanCount={6}
        onScroll={handleListScroll}
        itemKey={(index) => virtualRows[index]?.key || index}
      >
        {({ index, style }: { index: number; style: React.CSSProperties }) => {
          const row = virtualRows[index];
          return (
            <MeasuredRow index={index} style={style} setRowSize={setRowSize}>
              {row.type === 'day' ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
                  <Chip label={isToday(row.day) ? '오늘' : isYesterday(row.day) ? '어제' : format(row.day, 'yyyy.MM.dd', { locale: ko })} size="small" />
                </Box>
              ) : (
                <Fade in appear={false} timeout={0}>
                  <Box sx={{ display: 'flex', flexDirection: row.group.sender === user?.id ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 1.5, px: 2, py: 1 }}>
                    {row.group.sender !== user?.id && (
                      <Avatar sx={{ width: 36, height: 36, bgcolor: 'secondary.main', fontSize: '0.875rem', flexShrink: 0 }}>
                        {(row.group.senderUsername || 'G')[0].toUpperCase()}
                      </Avatar>
                    )}
                    <Box sx={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: row.group.sender === user?.id ? 'flex-end' : 'flex-start' }}>
                      {row.group.sender !== user?.id && (
                        <Box sx={{ mb: 0.5, ml: 0.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
                            {row.group.senderUsername || 'Guest'}
                          </Typography>
                        </Box>
                      )}
                      {row.group.messages.map((message: any, msgIndex: number) => (
                        <Paper key={message._id || message.tempId} elevation={0} sx={{ p: 2, mb: msgIndex < row.group.messages.length - 1 ? 0.5 : 1, maxWidth: '100%', bgcolor: row.group.sender === user?.id ? 'primary.main' : 'background.paper', opacity: message.isPending ? 0.7 : 1, color: row.group.sender === user?.id ? 'primary.contrastText' : 'text.primary', borderRadius: 2, boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)', border: row.group.sender !== user?.id ? '1px solid' : 'none', borderColor: 'divider', position: 'relative', overflow: 'visible',
                          '& .message-actions': {
                            opacity: 0,
                            visibility: 'hidden',
                            transition: 'opacity .15s ease',
                            zIndex: 2,
                          },
                          '&:hover .message-actions': {
                            opacity: 1,
                            visibility: 'visible',
                          },
                          '& .message-actions:hover': {
                            opacity: 1,
                            visibility: 'visible',
                          },
                          '&:before': {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: '-28px',
                            width: '28px',
                            pointerEvents: 'auto',
                          },
                        }}>
                          {editingMessageId === message._id ? (
                            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                              <TextField
                                fullWidth
                                multiline
                                maxRows={6}
                                defaultValue={editingValueRef.current || message.content}
                                inputRef={(el) => { editingInputRef.current = el; }}
                                onChange={(e) => { editingValueRef.current = e.target.value; }}
                                variant="standard"
                                InputProps={{ sx: { color: row.group.sender === user?.id ? 'primary.contrastText' : 'text.primary' } }}
                              />
                              <IconButton size="small" onClick={submitEdit} aria-label="저장" sx={{ color: row.group.sender === user?.id ? 'primary.contrastText' : 'text.primary' }}>
                                <CheckIcon fontSize="small" />
                              </IconButton>
                              <IconButton size="small" onClick={cancelEdit} aria-label="취소" sx={{ color: row.group.sender === user?.id ? 'primary.contrastText' : 'text.primary' }}>
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : (
                            <>
                              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                                {message.content}
                              </Typography>
                              {message.edited && (
                                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                                  (수정됨)
                                </Typography>
                              )}
                              {row.group.sender === user?.id && (
                                <Box className="message-actions" sx={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 'calc(100% + 8px)', display: 'flex', gap: 0.25, alignItems: 'center' }}>
                                  <Tooltip title="수정">
                                    <IconButton size="small" onClick={() => startEdit(message)} sx={{ color: 'primary.main' }}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="삭제">
                                    <IconButton size="small" onClick={() => confirmAndDelete(message)} sx={{ color: 'primary.main' }}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              )}
                            </>
                          )}
                        </Paper>
                      ))}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, ml: row.group.sender === user?.id ? 0 : 0.5, mr: row.group.sender === user?.id ? 0.5 : 0 }}>
                        <Typography variant="caption" color="text.secondary">{formatMessageTime(row.group.timestamp)}</Typography>
                      </Box>
                    </Box>
                  </Box>
                </Fade>
              )}
            </MeasuredRow>
          );
        }}
      </List>
    );
  }, [displayMessages.length, listHeight, listWidth, virtualRows, getItemSize, handleListScroll, setRowSize, user?.id, editingMessageId]);


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

      {/* Messages Area - react-window 가상화 적용 */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.default',
          position: 'relative'
        }}
      >
        {((loading || fetching) && virtualRows.length === 0) ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : displayMessages.length === 0 ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3 }}>
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
            {isLoadingMore && (
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', p: 1, gap: 1, zIndex: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="caption" color="text.secondary">과거 메시지를 불러오는 중...</Typography>
              </Box>
            )}
            {listView}
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
