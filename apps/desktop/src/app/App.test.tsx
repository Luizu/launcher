import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { App } from "./App";

it("renders the launcher shell", () => {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole("main")).toBeInTheDocument();
});

it("confines scrolling to the app root so no page-level overflow escapes", () => {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
  // The window-sized root clips overflow; wide content scrolls inside its own
  // container instead of forcing the page to scroll horizontally.
  expect(screen.getByRole("main")).toHaveClass("overflow-hidden");
});
