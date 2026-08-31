import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LocalLibrarySnapshot } from "@fuse-launcher/contracts";
import type { LibraryGame } from "../../lib/merge-library";
import { TauriClientError } from "../../lib/tauri-client";
import { LOCAL_LIBRARY_QUERY_KEY } from "../local-library/use-local-library";
import { LAUNCH_HISTORY_QUERY_KEY } from "../launch-history/use-launch-history";
import {
  useGameActions,
  type GameActionsClientLike,
  type UseGameActionsResult,
} from "./use-game-actions";

const INSTALLED_CS2: LibraryGame = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  installState: "installed",
};

const REMOTE_CS2: LibraryGame = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  installState: "not-installed",
};

const EMPTY_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

function tauriClient(
  overrides: Partial<GameActionsClientLike> = {},
): GameActionsClientLike {
  return {
    launch: vi.fn().mockResolvedValue({ accepted: true }),
    install: vi.fn().mockResolvedValue({ accepted: true }),
    getInstallStatus: vi.fn().mockResolvedValue({ state: "unknown" }),
    ...overrides,
  };
}

/** One game's action row; `namePrefix` disambiguates a second game's row. */
function GameActionsRow({
  actions,
  game,
  namePrefix = "",
}: {
  actions: UseGameActionsResult;
  game: LibraryGame;
  namePrefix?: string;
}) {
  return (
    <div>
      <button onClick={() => void actions.launch(game)}>
        {namePrefix}Jogar
      </button>
      <button onClick={() => void actions.install(game)}>
        {namePrefix}Instalar
      </button>
      <button onClick={() => void actions.refreshInstallStatus(game)}>
        {namePrefix}Atualizar estado
      </button>
    </div>
  );
}

function ActionsProbe({
  tauri,
  openUrl,
  game,
  secondGame,
}: {
  tauri: GameActionsClientLike;
  openUrl?: (url: string) => Promise<void>;
  game: LibraryGame;
  secondGame?: LibraryGame;
}) {
  const actions = useGameActions({ tauri, openUrl });
  return (
    <div>
      <GameActionsRow actions={actions} game={game} />
      {secondGame !== undefined && (
        <GameActionsRow actions={actions} game={secondGame} namePrefix="outro " />
      )}
      <button onClick={() => void actions.openSteamDownloads()}>
        Verificar na Steam
      </button>
      <button onClick={() => void actions.retry()}>Tentar novamente</button>
      {actions.error !== null && <p role="alert">{actions.error}</p>}
    </div>
  );
}

interface RenderProbeOptions {
  openUrl?: (url: string) => Promise<void>;
  game?: LibraryGame;
  secondGame?: LibraryGame;
}

function renderProbe(
  tauri: GameActionsClientLike,
  { openUrl, game = INSTALLED_CS2, secondGame }: RenderProbeOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, EMPTY_SNAPSHOT);
  render(
    <QueryClientProvider client={queryClient}>
      <ActionsProbe tauri={tauri} openUrl={openUrl} game={game} secondGame={secondGame} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("useGameActions", () => {
  it("launches an installed steam game by its numeric app id", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri);

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    await waitFor(() => expect(tauri.launch).toHaveBeenCalledWith(730));
    expect(tauri.install).not.toHaveBeenCalled();
  });

  it("refreshes the local history query after a successful launch", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    const queryClient = renderProbe(tauri);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    await waitFor(() => expect(tauri.launch).toHaveBeenCalledWith(730));
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: LAUNCH_HISTORY_QUERY_KEY },
      { throwOnError: false },
    );
  });

  it("keeps the history query untouched when the launch fails", async () => {
    const tauri = tauriClient({
      launch: vi.fn().mockRejectedValue({
        code: "open-failed",
        message: "could not open the steam url",
      }),
    });
    const user = userEvent.setup();
    const queryClient = renderProbe(tauri);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    await waitFor(() => expect(tauri.launch).toHaveBeenCalledWith(730));
    expect(invalidate).not.toHaveBeenCalledWith(
      { queryKey: LAUNCH_HISTORY_QUERY_KEY },
      expect.anything(),
    );
  });

  it("refuses to launch a game that is not installed", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: REMOTE_CS2 });

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    expect(tauri.launch).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este jogo não está instalado no computador.",
    );
  });

  it("keeps retry meaningful after a launch guard refusal", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: REMOTE_CS2 });

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este jogo não está instalado no computador.",
    );
    // Retry re-runs the guarded action: the same honest message, never a
    // dead button — and never a native call for a game that cannot run.
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(tauri.launch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este jogo não está instalado no computador.",
    );
  });

  it("maps a native launch failure to human copy and retries the action", async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new TauriClientError("game-not-installed", "native"))
      .mockResolvedValueOnce({ accepted: true });
    const tauri = tauriClient({ launch });
    const user = userEvent.setup();
    renderProbe(tauri);

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este jogo não está instalado no computador.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("ignores duplicate action clicks while the action is pending", async () => {
    let resolveLaunch!: (value: { accepted: boolean }) => void;
    const launch = vi.fn(
      () =>
        new Promise<{ accepted: boolean }>((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    const tauri = tauriClient({ launch });
    const user = userEvent.setup();
    renderProbe(tauri);

    await user.click(screen.getByRole("button", { name: "Jogar" }));
    await user.click(screen.getByRole("button", { name: "Jogar" }));

    expect(launch).toHaveBeenCalledTimes(1);

    resolveLaunch({ accepted: true });
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Jogar" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  });

  it("lets an action on another game proceed while one is pending", async () => {
    let resolveLaunch!: (value: { accepted: boolean }) => void;
    const launch = vi.fn(
      () =>
        new Promise<{ accepted: boolean }>((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    const install = vi.fn().mockResolvedValue({ accepted: true });
    const tauri = tauriClient({ launch, install });
    const user = userEvent.setup();
    const DOTA2: LibraryGame = {
      provider: "steam",
      externalGameId: "570",
      name: "Dota 2",
      installState: "not-installed",
    };
    renderProbe(tauri, { game: INSTALLED_CS2, secondGame: DOTA2 });

    // Game A's launch is still in flight when the user clicks game B's
    // install: the pending guard is per game, so the click is not dropped.
    await user.click(screen.getByRole("button", { name: "Jogar" }));
    await user.click(screen.getByRole("button", { name: "outro Instalar" }));

    expect(launch).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(570);

    resolveLaunch({ accepted: true });
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  });

  it("requests installation for a steam remote game by its numeric app id", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: REMOTE_CS2 });

    await user.click(screen.getByRole("button", { name: "Instalar" }));

    await waitFor(() => expect(tauri.install).toHaveBeenCalledWith(730));
    expect(tauri.launch).not.toHaveBeenCalled();
  });

  it("refuses to install a remote entry without a numeric app id", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: { ...REMOTE_CS2, externalGameId: "dota-2" } });

    await user.click(screen.getByRole("button", { name: "Instalar" }));

    expect(tauri.install).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível identificar este jogo na Steam.",
    );
  });

  it("refuses to install a non-steam remote entry", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: { ...REMOTE_CS2, provider: "epic" } });

    await user.click(screen.getByRole("button", { name: "Instalar" }));

    expect(tauri.install).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("keeps retry meaningful after an install guard refusal", async () => {
    const tauri = tauriClient();
    const user = userEvent.setup();
    renderProbe(tauri, { game: INSTALLED_CS2 });

    await user.click(screen.getByRole("button", { name: "Instalar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível iniciar a instalação deste jogo.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(tauri.install).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível iniciar a instalação deste jogo.",
    );
  });

  it("invalidates the local query, marks the game installing, and polls until installed", async () => {
    vi.useFakeTimers();
    try {
      const getInstallStatus = vi
        .fn()
        .mockResolvedValueOnce({ state: "installing" })
        .mockResolvedValueOnce({ state: "installed" });
      const tauri = tauriClient({ getInstallStatus });
      const queryClient = renderProbe(tauri, { game: REMOTE_CS2 });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
      await act(async () => {});

      expect(tauri.install).toHaveBeenCalledWith(730);
      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: LOCAL_LIBRARY_QUERY_KEY },
        { throwOnError: false },
      );

      const snapshot = () =>
        queryClient.getQueryData<LocalLibrarySnapshot>(LOCAL_LIBRARY_QUERY_KEY);
      expect(snapshot()?.games).toContainEqual(
        expect.objectContaining({ externalGameId: 730, state: "installing" }),
      );

      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(9000);

      expect(getInstallStatus).toHaveBeenCalledTimes(2);
      expect(snapshot()?.games).toContainEqual(
        expect.objectContaining({ externalGameId: 730, state: "installed" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling when the game cannot be verified", async () => {
    vi.useFakeTimers();
    try {
      const getInstallStatus = vi.fn().mockResolvedValue({ state: "unknown" });
      const tauri = tauriClient({ getInstallStatus });
      const queryClient = renderProbe(tauri, { game: REMOTE_CS2 });

      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
      await act(async () => {});
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(9000);

      expect(getInstallStatus).toHaveBeenCalledTimes(1);
      const snapshot =
        queryClient.getQueryData<LocalLibrarySnapshot>(LOCAL_LIBRARY_QUERY_KEY);
      expect(snapshot?.games).toContainEqual(
        expect.objectContaining({ externalGameId: 730, state: "unknown" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling when a fresher scan no longer lists the game", async () => {
    vi.useFakeTimers();
    try {
      const getInstallStatus = vi.fn().mockResolvedValue({ state: "installing" });
      const tauri = tauriClient({ getInstallStatus });
      const queryClient = renderProbe(tauri, { game: REMOTE_CS2 });

      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
      await act(async () => {});
      // Tick 1: native still reports installing; the poll writes it and
      // records its lastWriteAt.
      await vi.advanceTimersByTimeAsync(3000);
      expect(getInstallStatus).toHaveBeenCalledTimes(1);

      // A fresh scan lands after the poll's last write and no longer lists
      // the game (game gone, i.e. `not-installed`): the scan is the local
      // truth, so the poll must stop instead of re-marking it installing.
      await vi.advanceTimersByTimeAsync(500);
      act(() => queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, EMPTY_SNAPSHOT));
      await vi.advanceTimersByTimeAsync(9000);

      expect(getInstallStatus).toHaveBeenCalledTimes(1);
      const snapshot =
        queryClient.getQueryData<LocalLibrarySnapshot>(LOCAL_LIBRARY_QUERY_KEY);
      expect(snapshot?.games).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling after a bounded timeout", async () => {
    vi.useFakeTimers();
    try {
      const getInstallStatus = vi.fn().mockResolvedValue({ state: "installing" });
      const tauri = tauriClient({ getInstallStatus });
      renderProbe(tauri, { game: REMOTE_CS2 });

      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
      await act(async () => {});

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
      const calls = getInstallStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);

      expect(getInstallStatus.mock.calls.length).toBe(calls);
      expect(calls).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the fresh native status into the local snapshot", async () => {
    const getInstallStatus = vi.fn().mockResolvedValue({ state: "installed" });
    const tauri = tauriClient({ getInstallStatus });
    const user = userEvent.setup();
    const queryClient = renderProbe(tauri);

    await user.click(screen.getByRole("button", { name: "Atualizar estado" }));

    await waitFor(() => {
      const snapshot =
        queryClient.getQueryData<LocalLibrarySnapshot>(LOCAL_LIBRARY_QUERY_KEY);
      expect(snapshot?.games).toContainEqual(
        expect.objectContaining({ externalGameId: 730, state: "installed" }),
      );
    });
  });

  it("opens the Steam downloads page when the install state is unknown", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderProbe(tauriClient(), { openUrl });

    await user.click(screen.getByRole("button", { name: "Verificar na Steam" }));

    expect(openUrl).toHaveBeenCalledWith("steam://open/downloads");
  });

  it("shows an inline error and retries when the opener fails", async () => {
    const openUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error("opener failed"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderProbe(tauriClient(), { openUrl });

    await user.click(screen.getByRole("button", { name: "Verificar na Steam" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível abrir a página da Steam.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
