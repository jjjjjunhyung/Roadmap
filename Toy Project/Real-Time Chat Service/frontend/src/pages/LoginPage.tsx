import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  Card,
  CardContent,
  Fade,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Person as PersonIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { loginAsGuest } = useAuth();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const trimmedLength = nickname.trim().length;
  const nameFieldError = nickname.length > 0 && trimmedLength < 2 ? '닉네임은 2자 이상 입력하세요.' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setError('닉네임을 입력해주세요.');
      return;
    }
    if (name.length < 2) {
      setError('닉네임은 2자 이상 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await loginAsGuest(name);
      navigate('/chat');
    } catch (err: any) {
      setError(err.message || '입장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 1, sm: 2 },
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        overflow: 'auto',
      }}
    >
      <Container maxWidth="sm" sx={{ my: 'auto' }}>
        <Fade in timeout={800}>
          <Paper
            elevation={24}
            sx={{
              borderRadius: 4,
              bgcolor: 'background.paper',
              maxHeight: { xs: 'calc(100dvh - 32px)', sm: 'none' },
              overflow: { xs: 'auto', sm: 'hidden' },
            }}
          >
            {/* Header */}
            <Box
              sx={{
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                p: { xs: 3, sm: 4 },
                textAlign: 'center',
              }}
            >
              <ChatIcon sx={{ fontSize: { xs: 48, sm: 64 }, mb: 2 }} />
              <Typography variant="h3" sx={{ fontWeight: 700, mb: 1, fontSize: { xs: '1.8rem', sm: '3rem' } }}>
                채팅 서비스
              </Typography>
              <Typography variant="h6" sx={{ opacity: 0.9, mb: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                실시간으로 소통하세요
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.8, fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                닉네임만 입력하면 바로 시작할 수 있습니다
              </Typography>
            </Box>

            <Box sx={{ p: { xs: 3, sm: 4 } }}>
              {/* 제거: "빠른 시작" 카드 */}

              {error && (
                <Alert 
                  severity="error" 
                  sx={{ 
                    mb: 3, 
                    borderRadius: 2,
                    '& .MuiAlert-message': {
                      fontWeight: 500
                    }
                  }}
                >
                  {error}
                </Alert>
              )}

              {/* Login Form */}
              <Box component="form" onSubmit={handleSubmit}>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, color: 'text.primary' }}>
                  채팅방 입장하기
                </Typography>
                
                <TextField
                  fullWidth
                  label="닉네임"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onBlur={() => setNickname((v) => v.trim())}
                  variant="outlined"
                  placeholder="채팅에서 사용할 닉네임을 입력하세요"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonIcon color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: nickname ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setNickname('')} aria-label="닉네임 지우기">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  }}
                  sx={{ 
                    mb: 4,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 3,
                      fontSize: '1.1rem',
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                  inputProps={{ 
                    maxLength: 20,
                    style: { fontSize: '1.1rem' }
                  }}
                  error={!!nameFieldError}
                  helperText={nameFieldError || `2-20자, 공백만 불가 • ${trimmedLength}/20`}
                  autoFocus
                  required
                />

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  disabled={loading || !nickname.trim()}
                  size="large"
                  sx={{
                    py: { xs: 1.5, sm: 2 },
                    borderRadius: 3,
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: { xs: '1rem', sm: '1.2rem' },
                    mb: { xs: 2, sm: 3 },
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                    '&:hover': {
                      boxShadow: '0 6px 16px rgba(102, 126, 234, 0.6)',
                    },
                    '&:disabled': {
                      opacity: 0.7,
                    }
                  }}
                >
                  {loading ? '입장 중...' : '채팅방 입장하기'}
                </Button>

                {/* Tips */}
                <Card variant="outlined" sx={{ bgcolor: 'grey.50', borderColor: 'grey.200' }}>
                  <CardContent sx={{ py: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                      💡 이용 안내
                    </Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary' }}>
                      <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        닉네임은 2-20자까지 입력 가능합니다
                      </Typography>
                      <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        여러 채팅방에 자유롭게 참여할 수 있습니다
                      </Typography>
                      <Typography component="li" variant="body2">
                        실시간으로 다른 사용자들과 대화를 나눠보세요
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Box>
            </Box>
          </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

export default LoginPage;
