import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerQuotaStatus } from "../lib/cliproxyapi-usage.js";

export default function (pi: ExtensionAPI): void {
  registerQuotaStatus(pi);
}
