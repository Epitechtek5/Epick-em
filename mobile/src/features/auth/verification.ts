import { apiRequest } from '@/lib/api';

export function verifyEmail(token: string) {
  return apiRequest<void>('/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function resendVerification(email: string) {
  return apiRequest<void>('/resend-verification-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function enrollEmail(username: string, password: string, email: string) {
  return apiRequest<void>('/enroll-email', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}
