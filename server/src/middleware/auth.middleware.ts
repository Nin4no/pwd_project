import { getSupabase, throwDatabaseError } from "../config/supabase";
import { profileResponse, type AuthAal } from "../types/auth.types";
import HttpError from "../utils/httpError";
import asyncHandler from "../utils/asyncHandler";

function decodeJwtAal(token: string): AuthAal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as { aal?: unknown };
    if (payload.aal === "aal1" || payload.aal === "aal2") {
      return payload.aal;
    }
    return null;
  } catch {
    return null;
  }
}

function detectVerifiedMfa(factors: unknown): boolean | null {
  if (!Array.isArray(factors)) return null;
  return factors.some(
    (factor: unknown) =>
      factor !== null &&
      typeof factor === "object" &&
      (factor as { status?: unknown }).status === "verified",
  );
}

export const isAuthenticated = asyncHandler(async (req, _res, next) => {
  const match = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new HttpError(401, "로그인이 필요합니다.");
  const token = match[1];
  const db = getSupabase();
  const { data, error } = await db.auth.getUser(token);
  if (error) {
    if (!error.status || error.status >= 500)
      throw new HttpError(503, "인증 서버에 연결할 수 없습니다.");
    throw new HttpError(401, "로그인이 만료되었거나 유효하지 않습니다.");
  }
  if (!data.user) throw new HttpError(401, "로그인이 필요합니다.");
  const result = await db
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (result.error) throwDatabaseError(result.error);
  if (!result.data)
    throw new HttpError(
      403,
      "사용자 프로필이 없습니다. Supabase 스키마 설정을 확인하세요.",
    );
  if (!result.data.is_active)
    throw new HttpError(403, "비활성화된 계정입니다.");
  req.auth = profileResponse(result.data);
  req.authContext = {
    token,
    aal: decodeJwtAal(token),
    hasVerifiedMfa: detectVerifiedMfa(
      (data.user as { factors?: unknown }).factors,
    ),
  };
  next();
});

export const requireMfaStepUp = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, "로그인이 필요합니다.");

  let hasVerifiedMfa = req.authContext?.hasVerifiedMfa ?? null;
  if (hasVerifiedMfa === null) {
    const db = getSupabase() as unknown as {
      auth?: {
        admin?: {
          mfa?: {
            listFactors?: (params: {
              userId: string;
            }) => Promise<{ data?: { factors?: unknown }; error?: unknown }>;
          };
        };
      };
    };
    const mfaAdmin = db.auth?.admin?.mfa;
    if (mfaAdmin && typeof mfaAdmin.listFactors === "function") {
      const { data, error } = await mfaAdmin.listFactors({ userId: req.auth.id });
      if (error) {
        console.error("[Auth] Failed to inspect user MFA factors", error);
        throw new HttpError(503, "인증 상태를 확인할 수 없습니다.");
      }
      hasVerifiedMfa = detectVerifiedMfa(data?.factors) ?? false;
    } else {
      hasVerifiedMfa = false;
    }
  }

  if (!hasVerifiedMfa) return next();

  if (req.authContext?.aal !== "aal2") {
    throw new HttpError(
      403,
      "2단계 인증(OTP) 확인 후 다시 시도해 주세요.",
      "MFA_STEP_UP_REQUIRED",
    );
  }

  next();
});

/** Optional authentication for public reads. Invalid tokens and auth outages
 * never make public showroom reads fail; auth outages are logged for diagnosis. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const match = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return next();

  try {
    const db = getSupabase();
    const { data, error } = await db.auth.getUser(match[1]);
    if (error) {
      if (!error.status || error.status >= 500)
        console.error("[Auth] Optional token validation failed", error.message);
      return next();
    }
    if (!data.user) return next();

    const result = await db
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    if (result.error) {
      console.error("[Auth] Optional profile lookup failed", result.error.message);
      return next();
    }
    if (result.data?.is_active) req.auth = profileResponse(result.data);
  } catch (error) {
    console.error("[Auth] Optional authentication failed", error);
  }
  next();
});
