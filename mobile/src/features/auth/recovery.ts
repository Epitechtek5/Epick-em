import { apiRequest } from '@/lib/api';

export function forgotPassword(email: string): Promise<void> {
  return apiRequest<void>('/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string): Promise<void> {
  return apiRequest<void>('/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}
