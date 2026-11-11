import { revokePushToken } from '@/features/preferences/api';

let registeredToken: string | null = null;

export function rememberPushToken(token: string) {
  registeredToken = token;
}

export async function revokeCurrentPushToken() {
  const token = registeredToken;
  registeredToken = null;
  if (token) await revokePushToken(token);
}
