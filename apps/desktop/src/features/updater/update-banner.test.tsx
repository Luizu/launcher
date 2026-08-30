import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./update-banner";
import type { UpdateSnapshot } from "./updater-client";

const baseSnapshot: UpdateSnapshot = {
  status: "available",
  currentVersion: "0.3.0",
  availableVersion: "0.4.0",
  releaseDate: "2026-08-30T12:00:00.000Z",
  releaseNotes: "Melhorias de estabilidade",
  progress: null,
  error: null,
};

describe("UpdateBanner", () => {
  it("offers the available update and release notes", async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdateBanner
        snapshot={baseSnapshot}
        onInstall={onInstall}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("0.4.0");
    expect(screen.getByText("Melhorias de estabilidade")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atualizar e reiniciar" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("shows download progress while the app is installing", () => {
    render(
      <UpdateBanner
        snapshot={{ ...baseSnapshot, status: "installing", progress: 42 }}
        onInstall={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveValue(42);
    expect(screen.getByRole("status")).toHaveTextContent("42%");
  });

  it("does not render for disabled or idle updater states", () => {
    const { rerender } = render(
      <UpdateBanner
        snapshot={{ ...baseSnapshot, status: "disabled" }}
        onInstall={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <UpdateBanner
        snapshot={{ ...baseSnapshot, status: "idle" }}
        onInstall={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
