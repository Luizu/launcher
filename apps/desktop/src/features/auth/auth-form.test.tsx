import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthForm } from "./auth-form";
import { ApiClientError } from "../../lib/api-client";

it("shows the sign-up form and submits credentials", async () => {
  const signUp = vi.fn().mockResolvedValue({ user: { email: "new@example.com" } });
  const user = userEvent.setup();

  render(<AuthForm mode="sign-up" onSignUp={signUp} onSignIn={vi.fn()} />);
  await user.type(screen.getByLabelText("E-mail"), "new@example.com");
  await user.type(screen.getByLabelText("Senha"), "a-secure-password-123");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(signUp).toHaveBeenCalledWith({
    email: "new@example.com",
    password: "a-secure-password-123",
  });
});

it("signs in with the submitted credentials", async () => {
  const signIn = vi.fn().mockResolvedValue({ user: { email: "a@example.com" } });
  const user = userEvent.setup();

  render(<AuthForm mode="sign-in" onSignIn={signIn} onSignUp={vi.fn()} />);
  await user.type(screen.getByLabelText("E-mail"), "a@example.com");
  await user.type(screen.getByLabelText("Senha"), "a-secure-password-123");
  await user.click(screen.getByRole("button", { name: "Entrar" }));

  expect(signIn).toHaveBeenCalledWith({
    email: "a@example.com",
    password: "a-secure-password-123",
  });
});

it("disables the submit button while the request is pending", async () => {
  let resolveSubmit!: (value: unknown) => void;
  const signIn = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
  );
  const user = userEvent.setup();

  render(<AuthForm mode="sign-in" onSignIn={signIn} onSignUp={vi.fn()} />);
  await user.type(screen.getByLabelText("E-mail"), "a@example.com");
  await user.type(screen.getByLabelText("Senha"), "secret");
  await user.click(screen.getByRole("button", { name: "Entrar" }));

  expect(screen.getByRole("button", { name: "Entrando…" })).toBeDisabled();

  resolveSubmit({ user: { email: "a@example.com" } });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });
});

it("keeps the e-mail and shows a human-readable error after a rejected submission", async () => {
  const signUp = vi
    .fn()
    .mockRejectedValue(
      new ApiClientError(409, "user-already-exists", "User with this email already exists", "sign in"),
    );
  const user = userEvent.setup();

  render(<AuthForm mode="sign-up" onSignUp={signUp} onSignIn={vi.fn()} />);
  await user.type(screen.getByLabelText("E-mail"), "a@example.com");
  await user.type(screen.getByLabelText("Senha"), "secret");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Já existe uma conta com este e-mail.");
  expect(alert).not.toHaveTextContent("User with this email already exists");
  expect(screen.getByLabelText("E-mail")).toHaveValue("a@example.com");
  expect(alert).toHaveFocus();
});

it("clears the error and password when the mode changes", async () => {
  const signUp = vi
    .fn()
    .mockRejectedValue(new ApiClientError(409, "user-already-exists", "x", "y"));
  const user = userEvent.setup();
  const { rerender } = render(
    <AuthForm mode="sign-up" onSignUp={signUp} onSignIn={vi.fn()} />,
  );

  await user.type(screen.getByLabelText("E-mail"), "a@example.com");
  await user.type(screen.getByLabelText("Senha"), "secret");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("alert");

  rerender(<AuthForm mode="sign-in" onSignUp={signUp} onSignIn={vi.fn()} />);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Senha")).toHaveValue("");
  expect(screen.getByLabelText("E-mail")).toHaveValue("a@example.com");
});

it("moves focus to the first field when a rejected submission is retried", async () => {
  const signUp = vi
    .fn()
    .mockRejectedValueOnce(new ApiClientError(409, "user-already-exists", "x", "y"))
    .mockResolvedValueOnce({ user: { email: "new@example.com" } });
  const user = userEvent.setup();

  render(<AuthForm mode="sign-up" onSignUp={signUp} onSignIn={vi.fn()} />);
  await user.type(screen.getByLabelText("E-mail"), "new@example.com");
  await user.type(screen.getByLabelText("Senha"), "secret");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));
  await screen.findByRole("alert");

  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  await waitFor(() => expect(screen.getByLabelText("E-mail")).toHaveFocus());
});

it("asks for the fields instead of submitting an empty form", async () => {
  const signUp = vi.fn();
  const user = userEvent.setup();

  render(<AuthForm mode="sign-up" onSignUp={signUp} onSignIn={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Preencha o e-mail e a senha.");
  expect(signUp).not.toHaveBeenCalled();
});

it("offers switching to the other mode", async () => {
  const onToggleMode = vi.fn();
  const user = userEvent.setup();

  render(
    <AuthForm mode="sign-in" onSignIn={vi.fn()} onSignUp={vi.fn()} onToggleMode={onToggleMode} />,
  );
  await user.click(screen.getByRole("button", { name: "Trocar para criar conta" }));

  expect(onToggleMode).toHaveBeenCalledTimes(1);
});
