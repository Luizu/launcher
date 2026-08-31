import { render, screen } from "@testing-library/react";
import { FuseLogo } from "./fuse-logo";

describe("FuseLogo", () => {
  it("renders the Fuse Launcher wordmark by default", () => {
    render(<FuseLogo />);

    expect(screen.getByText("Fuse")).toBeInTheDocument();
    expect(screen.getByText("Launcher")).toBeInTheDocument();
  });

  it("renders an accessible CUT mark without the wordmark when compact", () => {
    render(<FuseLogo compact showWordmark={false} />);

    expect(
      screen.getByRole("img", { name: "Fuse Launcher" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Fuse")).not.toBeInTheDocument();
  });
});
