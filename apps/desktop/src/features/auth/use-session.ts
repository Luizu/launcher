import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./auth-context";

/** Access the session state; throws when used outside an {@link AuthProvider}. */
export function useSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSession must be used within an AuthProvider");
  }
  return context;
}
