import { apiRequest } from '@/lib/api';

import type { RegisterRequest, User } from './types';

export function register(data: RegisterRequest): Promise<User> {
  return apiRequest<User>('/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
