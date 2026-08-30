import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  GameLibraryConnection,
  LinkAttemptStatus,
  StartPlatformLinkResponse,
} from "@launcher/contracts";
import { SteamConnectionCard } from "./steam-connection-card";

const AUTHORIZATION_URL = "https://steamcommunity.com/openid/login";

const START_RESPONSE = {
  attemptId: "attempt-1",
  authorizationUrl: AUTHORIZATION_URL,
};

const CONNECTION_NEVER: GameLibraryConnection = {
  provider: "steam",
  visibility: "unknown",
  syncStatus: "never",
  lastSyncedAt: null,
};

// Offset-less so `new Date(...)` parses in local time and the formatted
// label is the same in every test environment timezone.
const CONNECTION_SYNCED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T12:00:00",
};

const CONNECTION_PRIVATE: GameLibraryConnection = {
  provider: "steam",
  visibility: "private",
  syncStatus: "synced",
  lastSyncedAt: null,
};

const CONNECTION_UNAVAILABLE: GameLibraryConnection = {
  provider: "steam",
  visibility: "unavailable",
  syncStatus: "failed",
  lastSyncedAt: null,
};

function pendingStatus(attemptId: string): LinkAttemptStatus {
  return {
    attemptId,
    provider: "steam",
    status: "pending",
    expiresAt: "2026-08-28T00:02:00.000Z",
    completedAt: null,
  };
}

function completedStatus(attemptId: string): LinkAttemptStatus {
  return {
    attemptId,
    provider: "steam",
    status: "completed",
    expiresAt: "2026-08-28T00:02:00.000Z",
    completedAt: "2026-08-28T00:00:00.000Z",
  };
}

it("opens the Steam link in the external browser and polls the attempt", async () => {
  const start = vi.fn().mockResolvedValue({
    attemptId: "attempt-1",
    authorizationUrl: "https://steamcommunity.com/openid/login",
  });
  const openUrl = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();

  render(<SteamConnectionCard startLink={start} openUrl={openUrl} />);
  await user.click(screen.getByRole("button", { name: "Conectar Steam" }));

  expect(openUrl).toHaveBeenCalledWith("https://steamcommunity.com/openid/login");
  expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();
});

it("polls the attempt every two seconds and stops on completion", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn().mockResolvedValue(START_RESPONSE);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const getLinkStatus = vi
      .fn()
      .mockResolvedValueOnce(pendingStatus("attempt-1"))
      .mockResolvedValueOnce(pendingStatus("attempt-1"))
      .mockResolvedValue(completedStatus("attempt-1"));
    const onConnected = vi.fn();

    const { rerender } = render(
      <SteamConnectionCard
        startLink={start}
        openUrl={openUrl}
        getLinkStatus={getLinkStatus}
        onConnected={onConnected}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });
    expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getLinkStatus).toHaveBeenCalledWith("attempt-1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Conectado à Steam. Carregando a biblioteca…")).toBeInTheDocument();

    // The invalidation triggered by onConnected refetches the library, which
    // now reports the fresh connection.
    rerender(
      <SteamConnectionCard
        startLink={start}
        openUrl={openUrl}
        getLinkStatus={getLinkStatus}
        connection={CONNECTION_NEVER}
        onConnected={onConnected}
      />,
    );
    expect(screen.getByText("Conectada, nunca sincronizada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sincronizar biblioteca" })).toBeInTheDocument();

    const callsAfterCompletion = getLinkStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getLinkStatus.mock.calls.length).toBe(callsAfterCompletion);
  } finally {
    vi.useRealTimers();
  }
});

it("stops polling after two minutes and offers a retry", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn().mockResolvedValue(START_RESPONSE);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const getLinkStatus = vi.fn().mockResolvedValue(pendingStatus("attempt-1"));

    render(
      <SteamConnectionCard startLink={start} openUrl={openUrl} getLinkStatus={getLinkStatus} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Não foi possível confirmar a conexão com a Steam."),
    ).toBeInTheDocument();

    const callsAtTimeout = getLinkStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getLinkStatus.mock.calls.length).toBe(callsAtTimeout);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["failed", "expired"] as const)(
  "stops polling when the attempt %s and offers a retry",
  async (status) => {
    vi.useFakeTimers();
    try {
      const start = vi.fn().mockResolvedValue(START_RESPONSE);
      const openUrl = vi.fn().mockResolvedValue(undefined);
      const getLinkStatus = vi
        .fn()
        .mockResolvedValueOnce(pendingStatus("attempt-1"))
        .mockResolvedValue({ ...pendingStatus("attempt-1"), status });

      render(
        <SteamConnectionCard startLink={start} openUrl={openUrl} getLinkStatus={getLinkStatus} />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(
        screen.getByRole("button", { name: "Tentar novamente" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Não foi possível confirmar a conexão com a Steam."),
      ).toBeInTheDocument();

      const callsAtTerminal = getLinkStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(getLinkStatus.mock.calls.length).toBe(callsAtTerminal);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("lets the user cancel the attempt and reconnect later", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn().mockResolvedValue(START_RESPONSE);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const getLinkStatus = vi.fn().mockResolvedValue(pendingStatus("attempt-1"));

    render(
      <SteamConnectionCard startLink={start} openUrl={openUrl} getLinkStatus={getLinkStatus} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });
    expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    });
    expect(screen.getByText("Steam não conectada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Steam" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getLinkStatus).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("reopens Steam from the waiting state without losing the attempt", async () => {
  const start = vi.fn().mockResolvedValue(START_RESPONSE);
  const openUrl = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();

  render(<SteamConnectionCard startLink={start} openUrl={openUrl} />);
  await user.click(screen.getByRole("button", { name: "Conectar Steam" }));
  await user.click(
    await screen.findByRole("button", { name: "Voltar para a Steam" }),
  );

  expect(openUrl).toHaveBeenCalledTimes(2);
  expect(openUrl).toHaveBeenLastCalledWith(AUTHORIZATION_URL);
  expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();
});

it("does not offer to return to Steam while the attempt is still starting", async () => {
  let resolveStart!: (response: StartPlatformLinkResponse) => void;
  const start = vi.fn().mockReturnValue(
    new Promise<StartPlatformLinkResponse>((resolve) => {
      resolveStart = resolve;
    }),
  );
  const openUrl = vi.fn().mockResolvedValue(undefined);

  render(<SteamConnectionCard startLink={start} openUrl={openUrl} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));

  // Waiting copy renders while the POST is in flight, but there is no
  // authorization URL yet, so the Steam link action must not appear.
  expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Voltar para a Steam" }),
  ).not.toBeInTheDocument();

  await act(async () => {
    resolveStart(START_RESPONSE);
  });
  expect(
    screen.getByRole("button", { name: "Voltar para a Steam" }),
  ).toBeInTheDocument();
  expect(openUrl).toHaveBeenCalledWith(AUTHORIZATION_URL);
});

it.each([
  ["http", "http://steamcommunity.com/openid/login"],
  ["malformed", "not a url"],
  ["empty", ""],
] as const)(
  "does not open a non-HTTPS authorization URL (%s) and shows a retryable error",
  async (_kind, url) => {
    const start = vi.fn().mockResolvedValue({
      attemptId: "attempt-1",
      authorizationUrl: url,
    });
    const openUrl = vi.fn().mockResolvedValue(undefined);

    render(<SteamConnectionCard startLink={start} openUrl={openUrl} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });

    expect(openUrl).not.toHaveBeenCalled();
    expect(
      screen.getByText("Não foi possível iniciar a conexão com a Steam."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  },
);

it("offers a retry instead of dead-ending when the library refetch fails after linking", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn().mockResolvedValue(START_RESPONSE);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const getLinkStatus = vi
      .fn()
      .mockResolvedValueOnce(pendingStatus("attempt-1"))
      .mockResolvedValue(completedStatus("attempt-1"));
    const onRefreshLibrary = vi.fn();

    const { rerender } = render(
      <SteamConnectionCard
        startLink={start}
        openUrl={openUrl}
        getLinkStatus={getLinkStatus}
        onRefreshLibrary={onRefreshLibrary}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The invalidation-triggered library refetch errored: no connection data
    // and the query is unavailable. The card must offer recovery.
    rerender(
      <SteamConnectionCard
        startLink={start}
        openUrl={openUrl}
        getLinkStatus={getLinkStatus}
        libraryUnavailable
        onRefreshLibrary={onRefreshLibrary}
      />,
    );

    expect(
      screen.getByText("Não foi possível verificar sua biblioteca."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Conectado à Steam. Carregando a biblioteca…"),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });
    expect(onRefreshLibrary).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps raw attempt ids and provider errors out of the primary UI", async () => {
  vi.useFakeTimers();
  try {
    const start = vi
      .fn()
      .mockRejectedValue(
        new Error("openid_discovery_failed: https://steamcommunity.com"),
      );
    const openUrl = vi.fn().mockResolvedValue(undefined);

    render(<SteamConnectionCard startLink={start} openUrl={openUrl} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });

    expect(
      screen.getByText("Não foi possível iniciar a conexão com a Steam."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/attempt-1|openid_discovery_failed/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("offers to sync the library when connected but never synced", async () => {
  const onSync = vi.fn().mockResolvedValue({ status: "synced" });
  const user = userEvent.setup();

  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={CONNECTION_NEVER}
      onSync={onSync}
    />,
  );
  expect(screen.getByText("Conectada, nunca sincronizada")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sincronizar biblioteca" }));
  expect(onSync).toHaveBeenCalledTimes(1);
});

it("updates the library when already synced", async () => {
  const onSync = vi.fn().mockResolvedValue({ status: "synced" });
  const user = userEvent.setup();

  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={CONNECTION_SYNCED}
      onSync={onSync}
    />,
  );
  expect(screen.getByText("Sincronizada")).toBeInTheDocument();
  expect(
    screen.getByText("Última sincronização: 28/08/2026, 12:00"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Atualizar biblioteca" }));
  expect(onSync).toHaveBeenCalledTimes(1);
});

it("omits the sync timestamp when the connection has none", () => {
  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={{ ...CONNECTION_SYNCED, lastSyncedAt: null }}
    />,
  );

  expect(screen.getByText("Sincronizada")).toBeInTheDocument();
  expect(screen.queryByText(/Última sincronização/)).not.toBeInTheDocument();
});

it("explains a private profile without exposing internals", () => {
  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={CONNECTION_PRIVATE}
    />,
  );
  expect(
    screen.getByText("Conta conectada; biblioteca indisponível"),
  ).toBeInTheDocument();
});

it("explains a failed sync distinctly from unavailable and keeps the last sync time", () => {
  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={{
        ...CONNECTION_SYNCED,
        visibility: "public",
        syncStatus: "failed",
      }}
    />,
  );

  expect(
    screen.getByText("Não foi possível atualizar sua biblioteca."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Última sincronização: 28/08/2026, 12:00"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Tentar novamente" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Sua biblioteca Steam está indisponível."),
  ).not.toBeInTheDocument();
});

it("offers a retry when the library is unavailable", async () => {
  const onSync = vi.fn().mockResolvedValue({ status: "unavailable" });
  const user = userEvent.setup();

  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={CONNECTION_UNAVAILABLE}
      onSync={onSync}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(onSync).toHaveBeenCalledTimes(1);
});

it("shows the syncing state while a sync runs", () => {
  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={{
        provider: "steam",
        visibility: "unknown",
        syncStatus: "syncing",
        lastSyncedAt: null,
      }}
    />,
  );
  expect(screen.getByText("Sincronizando biblioteca…")).toBeInTheDocument();
});

it("offers to retry when the library status cannot be verified", async () => {
  const onRefreshLibrary = vi.fn();
  const user = userEvent.setup();

  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      libraryUnavailable
      onRefreshLibrary={onRefreshLibrary}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(onRefreshLibrary).toHaveBeenCalledTimes(1);
});

it("shows a human error and retry when the sync fails", async () => {
  const onSync = vi.fn().mockRejectedValue(new Error("provider unavailable"));
  const user = userEvent.setup();

  render(
    <SteamConnectionCard
      startLink={vi.fn()}
      openUrl={vi.fn()}
      connection={CONNECTION_NEVER}
      onSync={onSync}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Sincronizar biblioteca" }));

  expect(
    await screen.findByText("Não foi possível sincronizar a biblioteca."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  expect(screen.queryByText(/provider unavailable/)).not.toBeInTheDocument();
});
