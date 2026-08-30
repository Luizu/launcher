import { Outlet } from "react-router-dom";

/**
 * Root layout of the launcher: renders the authenticated/unauthenticated
 * route tree inside a semantic `<main>`. The root clips overflow so wide
 * content scrolls inside its own container instead of forcing the page to
 * scroll horizontally; each destination scrolls vertically within itself.
 */
export function App() {
  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <Outlet />
    </main>
  );
}

export default App;
