import assert from "node:assert/strict";

import { isTelegramMessageNotModified } from "../src/lib/telegram-api-errors.ts";

assert.equal(isTelegramMessageNotModified(new Error("Bad Request: message is not modified: specified new message content and reply markup are exactly the same")), true);
assert.equal(isTelegramMessageNotModified(new Error("Bad Request: message to edit not found")), false);
assert.equal(isTelegramMessageNotModified("message is not modified"), false);

console.log("Telegram API error tests passed.");
