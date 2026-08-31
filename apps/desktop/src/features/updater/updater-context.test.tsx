import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  UpdaterProvider,
  useUpdater,
  type UpdaterClientLike,
} from "./updater-context";
import type { UpdateSnapshot } from "./updater-client";

const idleSnapshot: UpdateSnapshot = {
  status: "idle",
  currentVersion: "0.3.0",
  availableVersion: null,
  releaseDate: null,
  releaseNotes: null,
  progress: null,
  error: null,
};

function Probe() {
  const { snapshot, checkForUpdates } = useUpdater();
  return (
    <div>
      <span data-testid="status">{snapshot.status}</span>
      <button onClick={() => void checkForUpdates()}>Verificar</button>
    </div>
  );
}

describe("UpdaterProvider", () => {
  it("checks in the background on mount and publishes client updates", async () => {
    const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
    const client: UpdaterClientLike = {
      getSnapshot: vi.fn().mockReturnValue(idleSnapshot),
      subscribe: vi.fn((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      check: vi.fn().mockImplementation(async () => {
        const available: UpdateSnapshot = {
          ...idleSnapshot,
          status: "available",
          availableVersion: "0.4.0",
        };
        for (const listener of listeners) listener(available);
        return available;
      }),
      install: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <UpdaterProvider client={client}>
        <Probe />
      </UpdaterProvider>,
    );

    await waitFor(() => expect(client.check).toHaveBeenCalledOnce());
    expect(await screen.findByTestId("status")).toHaveTextContent("available");
  });

  it("does not duplicate the startup check under React StrictMode", async () => {
    const client: UpdaterClientLike = {
      getSnapshot: vi.fn().mockReturnValue(idleSnapshot),
      subscribe: vi.fn(() => () => undefined),
      check: vi.fn().mockResolvedValue(idleSnapshot),
      install: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <StrictMode>
        <UpdaterProvider client={client}>
          <span>Fuse Launcher</span>
        </UpdaterProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(client.check).toHaveBeenCalledOnce());
  });
});
