import HttpError from "../utils/httpError";

export async function geminiFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      console.error("[AI] Gemini request timed out", { timeoutMs });
      throw new HttpError(504, "AI service timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
