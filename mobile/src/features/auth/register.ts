import { apiRequest } from '@/lib/api';

import type { RegisterRequest, RegisterResponse } from './types';

export function register(data: RegisterRequest): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
