import type { User } from '@/features/auth/types';
import { apiRequest } from '@/lib/api';

export type UserRole = User['role'];

export interface UpdateAccountRequest {
  username?: string;
  password?: string;
}

export interface UpdateUserRequest extends UpdateAccountRequest {
  role?: UserRole;
}

export interface UsersQuery {
  limit?: number;
  offset?: number;
}

export function authenticatedHeaders(token: string): HeadersInit {
  if (!token.trim()) {
    throw new Error('Authentication is required');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function listUsers(
  token: string,
  query: UsersQuery = {},
): Promise<User[]> {
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  return apiRequest<User[]>(`/users?${params.toString()}`, {
    headers: authenticatedHeaders(token),
  });
}

export function getUser(token: string, id: string): Promise<User> {
  return apiRequest<User>(`/user/${id}`, {
    headers: authenticatedHeaders(token),
  });
}

export function updateMe(
  token: string,
  changes: UpdateAccountRequest,
): Promise<User> {
  return apiRequest<User>('/me/update', {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteMe(token: string): Promise<void> {
  return apiRequest<void>('/me/delete', {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function updateUser(
  token: string,
  id: string,
  changes: UpdateUserRequest,
): Promise<User> {
  return apiRequest<User>(`/user/${id}/update`, {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteUser(token: string, id: string): Promise<void> {
  return apiRequest<void>(`/user/${id}/delete`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}
