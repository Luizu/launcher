/** Known provider display labels; unknown providers fall back to the id. */
const PROVIDER_LABELS: Record<string, string> = {
  steam: "Steam",
};

/**
 * PT-BR display label for a provider id (rendered uppercase by the UI).
 * Unknown providers keep their id so same-looking entries from different
 * providers never become indistinguishable.
 */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.toUpperCase();
}
