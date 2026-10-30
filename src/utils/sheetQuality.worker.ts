// Worker thread for sheetQuality: decoding a booklet's scans takes seconds of CPU,
// which must not stall the API. One job at a time; see services/answer-sheet/sheetQuality.service.

import { parentPort } from "worker_threads";
import { analyzeSheetQuality } from "./sheetQuality";

parentPort?.on("message", async ({ id, pdf, rule }) => {
  try {
    const report = await analyzeSheetQuality(pdf, rule);
    parentPort?.postMessage({ id, report });
  } catch (err: any) {
    parentPort?.postMessage({ id, error: err?.message || String(err) });
  }
});
