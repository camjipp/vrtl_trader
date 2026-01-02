import { runPaperTrade } from "./paper/engine.js";

async function main(): Promise<void> {
  const summary = await runPaperTrade();
  console.log("");
  console.log("Paper trading (read-only simulation)");
  console.log(`ts: ${summary.ts}`);
  console.log(
    `positions=${summary.openPositions} exposure=$${summary.exposureUsd.toFixed(2)} cash=$${summary.bankrollCashUsd.toFixed(2)}`
  );
  console.log(
    `entered=${summary.entered} exited=${summary.exited} marked=${summary.marked} realizedPnL=$${summary.realizedPnlUsd.toFixed(2)} unrealizedPnL=$${summary.unrealizedPnlUsd.toFixed(2)}`
  );
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


