require("dotenv").config();
import adapters from "./adapters/index";
import { init as initCoinMetadata } from "./utils/coins3/es";
import {
  batchWriteWithAlerts,
  batchWrite2WithAlerts,
} from "./adapters/utils/database";
import { filterWritesWithLowConfidence } from "./adapters/utils/database";
import { sendMessage } from "./../../defi/src/utils/discord";
import { withTimeout } from "./../../defi/src/utils/shared/withTimeout";
import PromisePool from "@supercharge/promise-pool";

const step = 2000;
const timeout = process.env.LLAMA_RUN_LOCAL ? 8400000 : 840000; //14mins
console.log("Handler started")
export default async function handler() {
  console.log("aaaaa")
  // await initCoinMetadata();
  console.log("BBBB")
  console.log("Handler started")
  process.env.tableName = "prod-coins-table";
  const a = Object.entries(adapters);
  const indexes = Array.from(Array(a.length).keys());
  const timestamp = 0;
  console.log("Starting adapters")
  try {
    await PromisePool.withConcurrency(5)
      .for(indexes)
      .process(async (i: any) => {
        try {
          if (!["uniswap","uniV3","pancakeStable"].includes(a[i][0])) return;
          console.log(`Running adapter: ${a[i][0]}`);

          const results = await withTimeout(timeout, a[i][1][a[i][0]](timestamp));
          const resultsWithoutDuplicates = await filterWritesWithLowConfidence(
            results.flat().filter((c: any) => c.symbol != null || c.SK != 0),
          );
          for (let i = 0; i < resultsWithoutDuplicates.length; i += step) {
            await Promise.all([
              batchWriteWithAlerts(
                resultsWithoutDuplicates.slice(i, i + step),
                true,
              ),
            ]);
            await batchWrite2WithAlerts(
              resultsWithoutDuplicates.slice(i, i + step),
            );
          }
          console.log("Writing items:", resultsWithoutDuplicates.length);
          console.log(`${a[i][0]} done`);
        } catch (e) {
          console.error(
            `${a[i][0]} adapter failed ${
              process.env.LLAMA_RUN_LOCAL ? "" : `:${e}`
            }`,
          );
          if (!process.env.LLAMA_RUN_LOCAL)
            await sendMessage(
              `${a[i][0]} adapter failed: ${e}`,
              process.env.STALE_COINS_ADAPTERS_WEBHOOK!,
              true,
            );
        }
      });
  }
  catch (e) {
    console.error(`Handler failed: ${e}`);
    if (!process.env.LLAMA_RUN_LOCAL)
      await sendMessage(
        `Handler failed: ${e}`,
        process.env.STALE_COINS_ADAPTERS_WEBHOOK!,
        true,
      );
  }
}

handler(); // ts-node coins/src/storeCoins.ts
