// The NEAR wallet packages call Node's Buffer; browsers don't have it. Imported first by wallet.js
// so it's in place before any wallet code runs.
import { Buffer } from "buffer";
globalThis.Buffer ??= Buffer;
