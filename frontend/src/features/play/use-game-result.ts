import { useEffect, useState } from "react";
import { parseUserResponse } from "@/api/auth-response";
import { apiRequest } from "@/api/client";
import { ApiError, getErrorMessage } from "@/api/errors";
import { gamesApi } from "@/api/games";
import {
  getSessionRevision,
  getSessionSnapshot,
  subscribeToSession,
  updateSessionUser,
} from "@/stores/session-store";
import type { SavedGameResult } from "@/types/game";

interface ResultState {
  key: string;
  status: "loading" | "ready" | "error";
  game: SavedGameResult | null;
  error: string | null;
  profileRefreshFailed: boolean;
}

const retryDelays = [500, 1000, 2000] as const;

export function useGameResult(gameId: string, userId: string) {
  const key = `${userId}:${gameId}`;
  const [attempt, setAttempt] = useState(0);
  const loading: ResultState = {
    key,
    status: "loading",
    game: null,
    error: null,
    profileRefreshFailed: false,
  };
  const [state, setState] = useState<ResultState>(loading);

  useEffect(() => {
    const controller = new AbortController();
    const revision = getSessionRevision();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const current = () =>
      !controller.signal.aborted &&
      getSessionRevision() === revision &&
      getSessionSnapshot().user?.id === userId;
    const unsubscribe = subscribeToSession(() => {
      if (!current()) {
        controller.abort();
        clearTimeout(retryTimer);
      }
    });

    async function refreshProfile(): Promise<void> {
      try {
        const { user } = parseUserResponse(
          await apiRequest("/auth/me", { signal: controller.signal }),
        );
        if (current() && user.id === userId) updateSessionUser(user);
      } catch {
        if (current())
          setState((previous) =>
            previous.key === key
              ? { ...previous, profileRefreshFailed: true }
              : previous,
          );
      }
    }

    async function load(): Promise<void> {
      if (!current()) return;
      try {
        const game = await gamesApi.result(gameId, userId, controller.signal);
        if (!current()) return;
        setState({
          key,
          status: "ready",
          game,
          error: null,
          profileRefreshFailed: false,
        });

        void refreshProfile();
      } catch (error) {
        if (!current()) return;

        const delay = retryDelays[retries];
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          delay !== undefined
        ) {
          retries += 1;
          retryTimer = setTimeout(() => {
            void load();
          }, delay);
          return;
        }
        const message =
          error instanceof ApiError && error.status === 409
            ? "The rating details are not ready yet. Please try again in a moment."
            : getErrorMessage(
                error,
                "Rating details could not be loaded. Please try again.",
              );
        setState({
          key,
          status: "error",
          game: null,
          error: message,
          profileRefreshFailed: false,
        });
      }
    }

    void load();
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [attempt, gameId, key, userId]);

  function retry(): void {
    setState(loading);
    setAttempt((previous) => previous + 1);
  }

  return { ...(state.key === key ? state : loading), retry };
}
