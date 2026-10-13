export function isTelegramMessageNotModified(error: unknown) {
  return error instanceof Error && /message is not modified/i.test(error.message);
}
