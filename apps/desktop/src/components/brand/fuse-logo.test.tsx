import { render, screen } from "@testing-library/react";
import { FuseLogo } from "./fuse-logo";

describe("FuseLogo", () => {
  it("makes the CUT mark mint with an orange cut and a stronger uppercase wordmark", () => {
    const { container } = render(<FuseLogo />);
    const mark = container.querySelector("svg");

    expect(mark).toHaveClass("text-[#8cf5d0]");
    expect(mark?.querySelector("path[fill=\"#ff925e\"]")).not.toBeNull();
    expect(screen.getByText("FUSE")).toBeInTheDocument();
    expect(screen.getByText("LAUNCHER")).toBeInTheDocument();
  });

  it("uses the canonical CUT silhouette", () => {
    const { container } = render(<FuseLogo />);
    const paths = container.querySelectorAll("svg path");

    expect(paths[0]).toHaveAttribute(
      "d",
      "M14 11h37v11H26v8h21v10H26v13H14V11Z",
    );
    expect(paths[1]).toHaveAttribute("d", "m36 11 9 0-7 11h-9l7-11Z");
  });

  it("renders the Fuse Launcher wordmark by default", () => {
    render(<FuseLogo />);

    expect(screen.getByText("FUSE")).toBeInTheDocument();
    expect(screen.getByText("LAUNCHER")).toBeInTheDocument();
  });

  it("renders an accessible CUT mark without the wordmark when compact", () => {
    render(<FuseLogo compact showWordmark={false} />);

    expect(
      screen.getByRole("img", { name: "Fuse Launcher" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("FUSE")).not.toBeInTheDocument();
  });
});
