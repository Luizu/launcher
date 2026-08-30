import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "./diagnostics-panel";

describe("DiagnosticsPanel", () => {
  it("shows safe runtime details without exposing a DSN", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpenLogs = vi.fn().mockResolvedValue(undefined);
    const onCheckUpdates = vi.fn().mockResolvedValue(undefined);

    render(
      <DiagnosticsPanel
        version="0.3.0"
        environment="development"
        apiOrigin="http://localhost:3000"
        updaterStatus="up-to-date"
        sentryConfigured
        onClose={onClose}
        onOpenLogs={onOpenLogs}
        onCheckUpdates={onCheckUpdates}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("0.3.0");
    expect(screen.getByText("Desenvolvimento")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("Configurado")).toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/public@/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir pasta de logs" }));
    expect(onOpenLogs).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Verificar atualizações" }));
    expect(onCheckUpdates).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Fechar diagnóstico" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
