import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionResponse } from "@launcher/contracts";
import { mockMatchMedia, restoreMatchMedia } from "../../test/match-media";
import { AuthProvider, type AuthClientLike } from "../auth/auth-context";
import { diagnosticsClient } from "../diagnostics/diagnostics-client";
import { APP_VERSION, formatAppVersion } from "../../lib/app-version";
import { AppShell } from "./app-shell";

const session: SessionResponse = {
  user: {
    id: "user-1",
    email: "a@example.com",
    emailVerified: true,
    name: "Luizu",
    image: null,
  },
  session: {
    id: "session-1",
    token: "token",
    userId: "user-1",
    expiresAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

const authClient: AuthClientLike = {
  getSession: vi.fn().mockResolvedValue(session),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

function renderShell(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider client={authClient}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/home" element={<p>conteudo-home</p>} />
              <Route path="/library" element={<p>conteudo-biblioteca</p>} />
              <Route path="/onboarding" element={<p>conteudo-onboarding</p>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("keeps the sidebar with only Home and Biblioteca as destinations", async () => {
  renderShell("/home");

  await screen.findByText("conteudo-home");
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Biblioteca" })).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /descobrir|amigos|comunidades/i }),
  ).not.toBeInTheDocument();
});

it("shows the dynamically injected product version in the sidebar", async () => {
  renderShell("/home");

  await screen.findByText("conteudo-home");
  const displayVersion = formatAppVersion(APP_VERSION);
  expect(screen.getByText(displayVersion)).toBeInTheDocument();
  expect(
    screen.getByLabelText(`Versão da aplicação: ${displayVersion}`),
  ).toBeInTheDocument();
});

it("marks the current destination as active in the sidebar", async () => {
  renderShell("/home");

  await screen.findByText("conteudo-home");
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Biblioteca" })).not.toHaveAttribute(
    "aria-current",
  );
});

it("navigates from Home to Biblioteca through the sidebar and back", async () => {
  const user = userEvent.setup();
  renderShell("/home");

  await screen.findByText("conteudo-home");
  await user.click(screen.getByRole("link", { name: "Biblioteca" }));

  expect(await screen.findByText("conteudo-biblioteca")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Biblioteca" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
    "aria-current",
  );

  await user.click(screen.getByRole("link", { name: "Home" }));

  expect(await screen.findByText("conteudo-home")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("shows the current destination context in the topbar", async () => {
  const user = userEvent.setup();
  renderShell("/home");

  await screen.findByText("conteudo-home");
  const topbar = screen.getByRole("banner");
  expect(within(topbar).getByText("Home")).toBeInTheDocument();

  await user.click(screen.getByRole("link", { name: "Biblioteca" }));
  await screen.findByText("conteudo-biblioteca");
  expect(within(topbar).getByText("Biblioteca")).toBeInTheDocument();
});

it("reserves search, user and settings in the topbar without a sync indicator", async () => {
  renderShell("/library");

  await screen.findByText("conteudo-biblioteca");
  const topbar = screen.getByRole("banner");

  expect(
    within(topbar).getByRole("searchbox", { name: "Buscar" }),
  ).toBeDisabled();
  expect(await within(topbar).findByText("LU")).toBeInTheDocument();
  expect(
    within(topbar).getByRole("button", { name: "Configurações" }),
  ).toBeDisabled();

  // No permanent sync status in the topbar.
  expect(within(topbar).queryByText(/sincroniz/i)).not.toBeInTheDocument();
  expect(within(topbar).queryByText(/steam/i)).not.toBeInTheDocument();
});

it("persists the shell around onboarding", async () => {
  renderShell("/onboarding");

  await screen.findByText("conteudo-onboarding");
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Biblioteca" })).toBeInTheDocument();
});

it("opens the user menu with logout and local diagnostics actions", async () => {
  const user = userEvent.setup();
  const openLogs = vi.spyOn(diagnosticsClient, "openLogs").mockResolvedValue(undefined);
  renderShell("/library");

  await screen.findByText("conteudo-biblioteca");
  await user.click(screen.getByRole("button", { name: "Usuário" }));

  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.getByText("a@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Abrir logs" }));
  expect(openLogs).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("menuitem", { name: "Sair" }));
  expect(authClient.signOut).toHaveBeenCalled();
  openLogs.mockRestore();
});

afterEach(restoreMatchMedia);

describe("AppShell compact window", () => {
  it("compacts the rail and the topbar at narrow widths, hiding secondary chrome", async () => {
    mockMatchMedia("(max-width: 800px)", true);
    renderShell("/home");

    await screen.findByText("conteudo-home");
    const sidebar = screen.getByRole("complementary", { name: "Menu principal" });
    expect(sidebar).toHaveClass("w-[60px]");
    expect(sidebar).not.toHaveClass("w-[78px]");

    const topbar = screen.getByRole("banner");
    expect(topbar).toHaveClass("h-[58px]");
    expect(topbar).not.toHaveClass("h-[72px]");

    // Secondary chrome (the reserved search field) hides; the user identity
    // and the settings entry stay reachable.
    expect(within(topbar).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(topbar).getByText("LU")).toBeInTheDocument();
    expect(
      within(topbar).getByRole("button", { name: "Configurações" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Biblioteca" })).toBeInTheDocument();
  });

  it("keeps the full rail and topbar at wide widths", async () => {
    mockMatchMedia("(max-width: 800px)", false);
    renderShell("/home");

    await screen.findByText("conteudo-home");
    expect(
      screen.getByRole("complementary", { name: "Menu principal" }),
    ).toHaveClass("w-[78px]");
    expect(screen.getByRole("banner")).toHaveClass("h-[72px]");
    expect(
      within(screen.getByRole("banner")).getByRole("searchbox", { name: "Buscar" }),
    ).toBeInTheDocument();
  });

  it("gives the sidebar destinations a visible keyboard focus style", async () => {
    renderShell("/home");

    await screen.findByText("conteudo-home");
    expect(screen.getByRole("link", { name: "Home" }).className).toMatch(
      /focus-visible:outline/,
    );
    expect(screen.getByRole("link", { name: "Biblioteca" }).className).toMatch(
      /focus-visible:outline/,
    );
  });
});
