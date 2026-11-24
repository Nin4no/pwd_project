export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'user_already_exists'
  | 'weak_password'
  | 'over_request_rate_limit'
  | 'network_error'
  | 'user_cancelled'
  | 'redirect_uri_mismatch'
  | 'oauth_provider_error'
  | 'code_exchange_failed'
  | 'session_expired'
  | 'mfa_invalid_code'
  | 'mfa_step_up_required'
  | 'mfa_enrollment_failed'
  | 'unknown_error';

export interface AuthErrorInfo {
  code: AuthErrorCode;
  title: string;
  message: string;
  retryable: boolean;
}

const AUTH_ERROR_TABLE: Record<AuthErrorCode, AuthErrorInfo> = {
  invalid_credentials: {
    code: 'invalid_credentials',
    title: '이메일 또는 비밀번호를 확인해 주세요',
    message: '입력하신 이메일이나 비밀번호가 올바르지 않습니다.',
    retryable: true,
  },
  email_not_confirmed: {
    code: 'email_not_confirmed',
    title: '이메일 인증이 필요합니다',
    message: '받은 인증 메일을 확인한 뒤 로그인해 주세요.',
    retryable: false,
  },
  user_already_exists: {
    code: 'user_already_exists',
    title: '이미 가입된 이메일입니다',
    message: '로그인 탭에서 기존 계정으로 로그인해 주세요.',
    retryable: false,
  },
  weak_password: {
    code: 'weak_password',
    title: '비밀번호 형식을 확인해 주세요',
    message: '비밀번호는 6자 이상으로 입력해 주세요.',
    retryable: true,
  },
  over_request_rate_limit: {
    code: 'over_request_rate_limit',
    title: '요청이 너무 많습니다',
    message: '잠시 기다린 뒤 다시 시도해 주세요.',
    retryable: true,
  },
  network_error: {
    code: 'network_error',
    title: '네트워크 연결이 원활하지 않습니다',
    message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    retryable: true,
  },
  user_cancelled: {
    code: 'user_cancelled',
    title: '로그인이 취소되었습니다',
    message: '원하시면 다시 시도해 주세요.',
    retryable: true,
  },
  redirect_uri_mismatch: {
    code: 'redirect_uri_mismatch',
    title: '인증 연결 설정에 문제가 있습니다',
    message: '리다이렉트 주소가 일치하지 않습니다.',
    retryable: false,
  },
  oauth_provider_error: {
    code: 'oauth_provider_error',
    title: '소셜 로그인 중 오류가 발생했습니다',
    message: '잠시 후 다시 시도해 주세요.',
    retryable: true,
  },
  code_exchange_failed: {
    code: 'code_exchange_failed',
    title: '로그인 정보를 확인하지 못했습니다',
    message: '인증 코드 확인에 실패했어요. 다시 로그인해 주세요.',
    retryable: true,
  },
  session_expired: {
    code: 'session_expired',
    title: '로그인 유효 시간이 만료되었습니다',
    message: '인증 시간이 지났습니다. 다시 로그인해 주세요.',
    retryable: true,
  },
  mfa_invalid_code: {
    code: 'mfa_invalid_code',
    title: '인증 코드를 확인해 주세요',
    message: '인증 앱의 6자리 숫자가 올바르지 않거나 만료되었습니다. 다시 입력해 주세요.',
    retryable: true,
  },
  mfa_step_up_required: {
    code: 'mfa_step_up_required',
    title: '2단계 인증 확인이 필요합니다',
    message: '보안을 위해 인증 앱의 6자리 코드를 먼저 확인해 주세요.',
    retryable: true,
  },
  mfa_enrollment_failed: {
    code: 'mfa_enrollment_failed',
    title: '2단계 인증 설정에 실패했습니다',
    message: '2단계 인증을 등록하거나 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    retryable: true,
  },
  unknown_error: {
    code: 'unknown_error',
    title: '로그인에 실패했습니다',
    message: '일시적인 오류예요. 잠시 후 다시 시도해 주세요.',
    retryable: true,
  },
};

export function getAuthErrorInfo(code: AuthErrorCode): AuthErrorInfo {
  return AUTH_ERROR_TABLE[code];
}

interface ExtractedErrorFields {
  code: string;
  message: string;
  status?: number;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractErrorFields(error: unknown): ExtractedErrorFields {
  if (typeof error === 'string') {
    const text = error.trim();
    return { code: text, message: text };
  }
  if (!error || typeof error !== 'object') {
    return { code: '', message: '' };
  }

  const record = error as Record<string, unknown>;
  const response =
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : undefined;
  const responseData =
    response?.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : undefined;
  const responseError =
    responseData?.error && typeof responseData.error === 'object'
      ? (responseData.error as Record<string, unknown>)
      : undefined;

  const code =
    asString(responseData?.code) ||
    asString(responseError?.code) ||
    asString(record.code) ||
    asString(record.error_code) ||
    asString(record.error);
  const message =
    asString(responseData?.message) ||
    asString(responseError?.message) ||
    asString(record.message) ||
    asString(record.error_description) ||
    asString(record.msg);
  const status =
    typeof response?.status === 'number'
      ? response.status
      : typeof record.status === 'number'
        ? record.status
        : typeof record.statusCode === 'number'
          ? record.statusCode
          : undefined;

  return { code, message, status };
}

export function classifyAuthError(error: unknown): AuthErrorInfo {
  const { code, message, status } = extractErrorFields(error);
  const codeLower = code.toLowerCase();
  const msgLower = message.toLowerCase();
  const combined = `${codeLower} ${msgLower}`.trim();

  if (!combined && status === undefined) {
    return AUTH_ERROR_TABLE.unknown_error;
  }

  if (
    codeLower === 'user_cancelled' ||
    codeLower === 'access_denied' ||
    combined.includes('user_cancelled') ||
    combined.includes('access_denied') ||
    combined.includes('sign in was cancelled') ||
    combined.includes('user denied')
  ) {
    return AUTH_ERROR_TABLE.user_cancelled;
  }

  if (
    codeLower === 'redirect_uri_mismatch' ||
    combined.includes('redirect_uri_mismatch') ||
    combined.includes('redirect uri') ||
    combined.includes('mismatching redirect')
  ) {
    return AUTH_ERROR_TABLE.redirect_uri_mismatch;
  }

  if (
    codeLower === 'invalid_credentials' ||
    codeLower === 'invalid_login_credentials' ||
    combined.includes('invalid login credentials') ||
    combined.includes('invalid email or password') ||
    combined.includes('invalid_credentials') ||
    message.includes('등록되지 않은 이메일이거나 비밀번호가 올바르지 않습니다')
  ) {
    return AUTH_ERROR_TABLE.invalid_credentials;
  }

  if (
    codeLower === 'email_not_confirmed' ||
    combined.includes('email not confirmed') ||
    combined.includes('email_not_confirmed')
  ) {
    return AUTH_ERROR_TABLE.email_not_confirmed;
  }

  if (
    codeLower === 'user_already_exists' ||
    codeLower === 'email_exists' ||
    combined.includes('user already registered') ||
    combined.includes('already been registered') ||
    combined.includes('user_already_exists') ||
    combined.includes('email_exists') ||
    message.includes('이미 등록된 이메일')
  ) {
    return AUTH_ERROR_TABLE.user_already_exists;
  }

  if (
    codeLower === 'weak_password' ||
    codeLower === 'password_too_short' ||
    codeLower === 'same_password' ||
    combined.includes('weak_password') ||
    combined.includes('password should be at least') ||
    combined.includes('password is too weak') ||
    combined.includes('new password should be different')
  ) {
    return AUTH_ERROR_TABLE.weak_password;
  }

  if (
    status === 429 ||
    codeLower === 'over_request_rate_limit' ||
    codeLower === 'over_email_send_rate_limit' ||
    codeLower === 'over_sms_send_rate_limit' ||
    codeLower === 'too_many_requests' ||
    combined.includes('over_request_rate_limit') ||
    combined.includes('rate limit') ||
    combined.includes('too many requests') ||
    combined.includes('only request this after')
  ) {
    return AUTH_ERROR_TABLE.over_request_rate_limit;
  }

  if (
    codeLower === 'mfa_step_up_required' ||
    codeLower === 'insufficient_aal' ||
    combined.includes('mfa_step_up_required') ||
    combined.includes('insufficient_aal') ||
    combined.includes('aal2 required') ||
    (combined.includes('aal2') && combined.includes('required'))
  ) {
    return AUTH_ERROR_TABLE.mfa_step_up_required;
  }

  if (
    codeLower === 'mfa_invalid_code' ||
    codeLower === 'invalid_totp' ||
    codeLower === 'mfa_verification_failed' ||
    codeLower === 'mfa_challenge_expired' ||
    combined.includes('mfa_invalid_code') ||
    combined.includes('invalid_totp') ||
    combined.includes('invalid totp') ||
    combined.includes('mfa_verification_failed') ||
    combined.includes('mfa_challenge_expired') ||
    combined.includes('invalid mfa code') ||
    message.includes('6자리 숫자')
  ) {
    return AUTH_ERROR_TABLE.mfa_invalid_code;
  }

  if (
    codeLower === 'mfa_enrollment_failed' ||
    codeLower === 'mfa_factor_name_conflict' ||
    codeLower === 'mfa_factor_not_found' ||
    codeLower === 'mfa_verified_factor_exists' ||
    codeLower === 'too_many_enrolled_mfa_factors' ||
    codeLower === 'mfa_totp_enroll_disabled' ||
    codeLower === 'mfa_totp_verify_disabled' ||
    combined.includes('mfa_enrollment_failed') ||
    combined.includes('mfa_factor_name_conflict') ||
    combined.includes('mfa_factor_not_found') ||
    combined.includes('too_many_enrolled_mfa_factors') ||
    (combined.includes('friendly name') && combined.includes('already exists'))
  ) {
    return AUTH_ERROR_TABLE.mfa_enrollment_failed;
  }

  if (
    codeLower === 'session_expired' ||
    codeLower === 'flow_state_expired' ||
    codeLower === 'otp_expired' ||
    codeLower === 'token_expired' ||
    codeLower === 'refresh_token_not_found' ||
    codeLower === 'invalid_refresh_token' ||
    codeLower === 'session_not_found' ||
    combined.includes('session_expired') ||
    combined.includes('flow_state_expired') ||
    combined.includes('session expired') ||
    combined.includes('token has expired') ||
    combined.includes('jwt expired') ||
    combined.includes('otp expired') ||
    (combined.includes('flow state') && combined.includes('expired'))
  ) {
    return AUTH_ERROR_TABLE.session_expired;
  }

  if (
    codeLower === 'code_exchange_failed' ||
    codeLower === 'bad_oauth_callback' ||
    codeLower === 'bad_oauth_state' ||
    codeLower === 'flow_state_not_found' ||
    codeLower === 'invalid_grant' ||
    codeLower === 'pkce_code_verifier_not_found' ||
    combined.includes('code_exchange_failed') ||
    combined.includes('authentication could not be verified') ||
    combined.includes('code verifier') ||
    combined.includes('invalid grant') ||
    combined.includes('bad_oauth')
  ) {
    return AUTH_ERROR_TABLE.code_exchange_failed;
  }

  if (
    codeLower === 'network_error' ||
    codeLower === 'err_network' ||
    codeLower === 'econnaborted' ||
    codeLower === 'econnrefused' ||
    codeLower === 'etimedout' ||
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('network request failed') ||
    combined.includes('network error') ||
    combined.includes('load failed') ||
    combined.includes('fetch failed') ||
    combined.includes('timeout')
  ) {
    return AUTH_ERROR_TABLE.network_error;
  }

  if (
    codeLower === 'oauth_provider_error' ||
    codeLower === 'provider_disabled' ||
    codeLower === 'oauth_error' ||
    codeLower === 'server_error' ||
    codeLower === 'temporarily_unavailable' ||
    codeLower === 'unauthorized_client' ||
    codeLower === 'invalid_scope' ||
    codeLower === 'unsupported_provider' ||
    codeLower === 'unexpected_failure' ||
    combined.includes('oauth_provider_error') ||
    combined.includes('unable to exchange external code') ||
    combined.includes('provider is not enabled') ||
    message.includes('Supabase 인증이 설정되지 않았습니다')
  ) {
    return AUTH_ERROR_TABLE.oauth_provider_error;
  }

  return AUTH_ERROR_TABLE.unknown_error;
}

export function isAuthCancelled(error: unknown): boolean {
  return classifyAuthError(error).code === 'user_cancelled';
}
