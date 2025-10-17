// coins/src/storeCoins.ts (serverless handler)
require("dotenv").config();

import adapters from "./adapters/index";
import { sendMessage } from "./../../defi/src/utils/discord";
import { withTimeout } from "./../../defi/src/utils/shared/withTimeout";
import { splitDataInput } from "./scripts/bsc_util/splitData";
import { PromisePool } from "@supercharge/promise-pool"; // <-- named import

const timeout = process.env.LLAMA_RUN_LOCAL ? 8_400_000 : 840_000; // 140min local, 14min prod

export default async function handler(event: any) {
  console.log("Handler started");

  // ----- Parse input safely -----
  let params: Record<string, any> = {};
  try {
    params =
      typeof event?.body === "string"
        ? JSON.parse(event.body)
        : (event?.body ?? {});
  } catch (e) {
    console.error("Invalid JSON in request body:", e);
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid JSON in request body" }),
    };
  }

  console.log("Params type:", typeof params);

  process.env.tableName = "prod-coins-table";

  const adapterEntries = Object.entries(adapters);
  const indexes = adapterEntries.map((_, i) => i);
  const timestamp = 0;

  // Prepare once; no need to recompute per adapter
  const coinsInfo = splitDataInput(params);

  // Collect outputs for the final HTTP response
  const responses: Array<{ adapter: string; count: number; data: any[] }> = [];

  try {
    await PromisePool.withConcurrency(5)
      .for(indexes)
      .process(async (i) => {
        const adapterKey = adapterEntries[i][0];
        const adapterMod: any = adapterEntries[i][1];

        // Run only selected adapters
        if (!["uniV3"].includes(adapterKey)) return;

        try {
          console.log(`Running adapter: ${adapterKey}`);

          const fn =
            typeof adapterMod === "function"
              ? adapterMod
              : adapterMod[adapterKey];

          if (!fn) {
            console.warn(`Adapter function not found for key: ${adapterKey}`);
            return;
          }

          const result = await withTimeout(timeout, fn(timestamp, coinsInfo));

          const flattened = (Array.isArray(result) ? result : [result]).flat();
          const filtered = flattened.filter(
            (c: any) => c && (c.symbol != null || c.SK != 0),
          );

          responses.push({
            adapter: adapterKey,
            count: filtered.length,
            data: filtered,
          });

          console.log(
            `${adapterKey} done. Filtered items: ${filtered.length}`,
          );
        } catch (e) {
          console.error(`${adapterKey} adapter failed:`, e);
        }
      });

    // ----- Success HTTP response -----
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, responses }),
    };
  } catch (e) {
    console.error(`Handler failed: ${e}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Handler failed" }),
    };
  }
}

// ts-node coins/src/storeCoins.ts
