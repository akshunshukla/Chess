import { getApiUrl } from "@/lib/env";
import { waitForServer } from "@/lib/server-wake";
import { ApiError } from "./errors";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

const requestTimeoutMs = 15_000;
const serverMessages: Record<string, string> = {
  "Invalid registration input": "Check your account details and try again.",
  "Invalid login input": "Check your email and password and try again.",
  "Invalid refresh input": "Your session has expired. Please sign in again.",
  "Invalid logout input":
    "Your session could not be signed out. Please try again.",
  "Invalid email or password": "The email or password is incorrect.",
  "Username or email already in use":
    "That username or email is already in use.",
  "Invalid analysis request":
    "Check the game or position you supplied and try again.",
  "Invalid FEN characters":
    "The FEN contains unsupported characters. Paste a standard chess position.",
  "Invalid standard-chess FEN":
    "That FEN is invalid. Check all six fields of the position.",
  "Invalid castling rights": "The FEN has invalid castling rights.",
  "Invalid FEN counters": "The FEN has invalid move counters.",
  "FEN counters are too large": "The move counters in that FEN are too large.",
  "Invalid FEN empty-square count":
    "The FEN has an invalid number of empty squares.",
  "FEN has too many pieces or pawns":
    "That position contains too many pieces or pawns.",
  "The nonmoving king cannot be in check":
    "That position is illegal: the king of the side that just moved is in check.",
  "A king cannot face more than two checks":
    "That position is illegal: a king cannot be checked by more than two pieces.",
  "Castling rights require the original king and rook squares":
    "The FEN castling rights do not match the king and rook positions.",
  "En-passant target is inconsistent with a double pawn move":
    "The FEN en passant square does not match a double pawn move.",
  "Invalid PGN header":
    "A PGN header is malformed. Check its name and quoted value.",
  "Duplicate or excessive PGN headers":
    "The PGN has duplicate headers or too many headers.",
  "PGN variations are nested too deeply":
    "The PGN has too many nested variations. Paste the main line instead.",
  "Unbalanced PGN variation": "A PGN variation has mismatched parentheses.",
  "Unterminated PGN comment or variation":
    "A PGN comment or variation is missing its closing bracket.",
  "PGN exceeds 600 moves":
    "That PGN is too long. Import at most 600 half-moves.",
  "PGN exceeds 600 plies":
    "That PGN is too long. Import at most 600 half-moves.",
  "PGN contains moves after a terminal position":
    "The PGN continues after the game has already ended.",
  "PGN must be 1 to 131072 bytes": "Paste a PGN no larger than 128 KB.",
  "Normalized PGN exceeds 131072 bytes":
    "That PGN is too large after formatting. Use a smaller game record.",
  "PGN contains control characters":
    "The PGN contains unsupported characters. Paste a plain text game record.",
  "Only standard chess is supported":
    "Only standard chess is supported. Import a game without a variant.",
  "Invalid PGN SetUp header": "The PGN SetUp header must be 0 or 1.",
  "PGN SetUp requires a FEN header":
    "This PGN needs a FEN header for its starting position.",
  "PGN FEN conflicts with SetUp":
    "The PGN starting position conflicts with its SetUp header.",
  "Invalid PGN result": "The PGN result must be 1-0, 0-1, 1/2-1/2, or *.",
  "PGN result header and marker disagree":
    "The PGN result header and final result do not match.",
  "PGN result must match checkmate":
    "The PGN result does not match the checkmate position.",
  "PGN result conflicts with a drawn terminal position":
    "The PGN result does not match the drawn final position.",
  "Invalid PGN or FEN: moves must be legal standard chess":
    "The game or position is invalid. Check that its moves are legal standard chess.",
  "You already have three unfinished analyses":
    "You already have three analyses waiting or running. Wait for one to finish before starting another.",
  "A saved completed game is required":
    "Analysis requires a completed game with a saved move record.",
  "Only failed analyses can be retried":
    "This analysis is no longer failed. Refresh its status to continue.",
  "Analysis engine is unavailable":
    "Analysis is temporarily unavailable. Please try again later.",
  "A completed game PGN is not available":
    "A PGN record is not available for this game.",
};

function responseMessage(status: number, data?: unknown): string {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    const knownMessage = Object.hasOwn(serverMessages, data.error)
      ? serverMessages[data.error]
      : undefined;
    if (knownMessage) return knownMessage;
  }

  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "That request could not be found.";
  if (status === 413)
    return "That request is too large. Please reduce its size.";
  if (status >= 500)
    return "The server is unavailable. Please try again shortly.";
  return "The request could not be completed. Please check your details and try again.";
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    : undefined;
}

async function requestOnce(
  path: string,
  options: RequestOptions,
  format: "json" | "text",
): Promise<unknown> {
  let url: URL;
  try {
    const base = new URL(`${getApiUrl().replace(/\/+$/, "")}/`);
    url = new URL(path.replace(/^\/+/, ""), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error("Request escaped the API base URL");
    }
  } catch {
    throw new ApiError(
      "The app cannot connect right now. Please try again later.",
      0,
    );
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);

  try {
    const headers = new Headers({
      Accept:
        format === "text"
          ? "application/x-chess-pgn, text/plain"
          : "application/json",
    });
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });

    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
      const message =
        retryAfter === undefined
          ? "Too many requests. Please wait a moment before trying again."
          : `Too many requests. Try again in ${Math.max(1, retryAfter)} seconds.`;
      throw new ApiError(message, 429, retryAfter);
    }
    if (response.status === 204) return undefined;

    if (response.ok && format === "text") return await response.text();

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ApiError(
        response.ok
          ? "The server sent an unreadable response. Please try again."
          : responseMessage(response.status),
        response.ok ? 502 : response.status,
      );
    }

    if (!response.ok)
      throw new ApiError(
        responseMessage(response.status, data),
        response.status,
      );
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut)
      throw new ApiError("The request timed out. Please try again.", 0);
    if (options.signal?.aborted)
      throw new ApiError("The request was cancelled.", 0);
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function request(
  path: string,
  options: RequestOptions,
  format: "json" | "text",
): Promise<unknown> {
  const readOnly = !options.method || options.method === "GET";
  try {
    if (!readOnly) await waitForServer(options.signal);
  } catch (error) {
    throw new ApiError(
      options.signal?.aborted
        ? "The request was cancelled."
        : error instanceof Error
          ? error.message
          : "Could not reach the server. Please try again.",
      0,
    );
  }

  try {
    return await requestOnce(path, options, format);
  } catch (error) {
    if (
      !readOnly ||
      !(error instanceof ApiError) ||
      error.status !== 0 ||
      options.signal?.aborted
    )
      throw error;
    try {
      await waitForServer(options.signal);
    } catch (wakeError) {
      throw new ApiError(
        options.signal?.aborted
          ? "The request was cancelled."
          : wakeError instanceof Error
            ? wakeError.message
            : "Could not reach the server. Please try again.",
        0,
      );
    }
    return requestOnce(path, options, format);
  }
}

export function requestJson(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return request(path, options, "json");
}

export async function requestText(
  path: string,
  options: RequestOptions = {},
): Promise<string> {
  const value = await request(path, options, "text");
  if (typeof value !== "string")
    throw new ApiError(
      "The server sent an unreadable export. Please try again.",
      502,
    );
  return value;
}
