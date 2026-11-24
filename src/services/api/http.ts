import axios from 'axios';
import { supabase } from './supabase';

const baseURL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const publicApi = axios.create({ baseURL, timeout: 60000, withCredentials: false });
export const authApi = axios.create({ baseURL, timeout: 60000, withCredentials: false });

for (const client of [publicApi, authApi]) {
  client.interceptors.request.use((config) => {
    if (!baseURL) throw new Error('VITE_API_BASE_URL을 확인하고 Vite를 다시 시작하세요.');
    return config;
  });
}

authApi.interceptors.request.use(async (config) => {
  const { data, error } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
    error: null,
  };
  if (error) throw error;
  if (data.session) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  return config;
});

export function messageOf(error: unknown): string {
  if (axios.isAxiosError<{ message?: string; error?: { message?: string } }>(error)) {
    return (
      error.response?.data?.message ??
      error.response?.data?.error?.message ??
      error.message
    );
  }
  return error instanceof Error ? error.message : '요청에 실패했습니다. 다시 시도하세요.';
}
