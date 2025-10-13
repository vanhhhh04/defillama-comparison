// v3.ts (fixed $/token rate, detailed logs, stable-decimals-aware estimates)
import { multiCall } from "@defillama/sdk/build/abi";
import * as sdk from "@defillama/sdk";
import getBlock from "../../utils/block";
import { translateQty } from "./uniswap";
import { Write } from "../../utils/dbInterfaces";
import { addToDBWritesList } from "../../utils/database";
import abi from "./abi.json";
// ---------------------- Types ----------------------
console.log("Using BSC_RPC:", process.env.BSC_RPC);
type Data = {
  [address: string]: {
    decimals: number;
    symbol: string;
    rawQty: number;        // max amountOut when swapping 1 stable-unit -> token
    priceEstimate: number; // $/token (estimated)
    largeRate: number;     // $/token for large swap
    smallRate: number;     // $/token for small swap
    out: string;           // stable token address (USDC/USDT)
  };
};

type Call = { target?: string; params?: any };
type Tokens = { in: string; out: string };

type CallMeta = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;     // stringified BigInt
  size: "large" | "small";
};

// ---------------------- Constants ----------------------
const commonFees: string[] = ["10000", "2500", "500", "100"]; // 1.00%, 0.25%, 0.05%, 0.01%
const feesByChain: Record<string, string[]> = {
  ethereum: commonFees,
  bsc: commonFees,
};

const sqrtPriceLimitX96 = "0";
const dollarAmt = 10 ** 5; // ~100k USD used for large-swap impact

const quoters: { [chain: string]: string } = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // Uniswap V3 QuoterV2
  bsc: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",     // Pancake V3 QuoterV2
};

// ---------------------- Logging Helpers ----------------------
function getFees(chain: string): string[] {
  return feesByChain[chain] ?? commonFees;
}

function summarizeAddresses(label: string, addrs: string[]) {
  const uniq = [...new Set(addrs)];
  console.log(`[SUM] ${label}: ${uniq.length} unique`);
  if (uniq.length <= 10) console.log(`[SUM] ${label} list:`, uniq);
}

function summarizeDataState(stage: string, data: Data) {
  const keys = Object.keys(data);
  const priced = keys.filter(k => data[k].priceEstimate > 0).length;
  const withOut = keys.filter(k => !!data[k].out).length;
  const withDecimals = keys.filter(k => data[k].decimals >= 0).length;
  const withSymbols = keys.filter(k => !!data[k].symbol).length;
  console.log(`[DATA] ${stage}: total=${keys.length}, withOut=${withOut}, decimals=${withDecimals}, symbols=${withSymbols}, priceEstimate>0=${priced}`);
}

function logSampleRates(stage: string, data: Data, limit = 5) {
  const keys = Object.keys(data).slice(0, limit);
  console.log(`[RATES] ${stage}: sample ${keys.length}`);
  keys.forEach(k => {
    const d = data[k];
    console.log(`  ${k} => sym=${d.symbol} dec=${d.decimals} out=${d.out} rawQty=${d.rawQty} priceEst=${d.priceEstimate} largeRate=${d.largeRate} smallRate=${d.smallRate}`);
  });
}

function logCallsMeta(stage: string, metas: CallMeta[], limit = 6) {
  console.log(`[CALLS] ${stage}: total=${metas.length}`);
  metas.slice(0, limit).forEach((m, i) => {
    console.log(`  [${i}] ${m.size} tokenIn=${m.tokenIn} -> tokenOut=${m.tokenOut} amountIn=${m.amountIn}`);
  });
}

// ---------------------- Core Steps ----------------------

// Estimate step: fetch decimals & symbols first; then build estimate calls with amountIn = 10^(stableDecimals)
async function estimateValuesAndFetchMetadata(
  chain: string,
  tokens: Tokens[],
  block: number | undefined,
): Promise<Data> {
  console.log(`\n[STEP] estimateValuesAndFetchMetadata(chain=${chain}) START`);
  console.log(`[INFO] Using quoter: ${quoters[chain]}`);
  console.log(`[INFO] Fee tiers: ${getFees(chain).join(", ")}`);
  console.log(`[INFO] Tokens (in->out) pairs:`, tokens);

  const data: Data = {};
  const tokensMap: Record<string, string> = {};

  tokens.forEach((t) => {
    tokensMap[t.in.toLowerCase()] = t.out.toLowerCase();
  });

  const inTokens = [...new Set(tokens.map(t => t.in.toLowerCase()))];
  const outTokens = [...new Set(tokens.map(t => t.out.toLowerCase()))];
  const allTokens: string[] = [...new Set([...inTokens, ...outTokens])];

  // Init storage
  allTokens.forEach((addr) => {
    data[addr] = {
      rawQty: -1,
      decimals: -1,
      symbol: "",
      priceEstimate: -1,
      largeRate: -1,
      smallRate: -1,
      out: tokensMap[addr] ?? "",
    };
  });

  summarizeAddresses("allTokens", allTokens);
  summarizeDataState("init", data);

  // 1) decimals for all tokens (including stable outs)
  console.log(`[MC] fetching erc20:decimals for ${allTokens.length} tokens...`);
  await multiCall({
    calls: allTokens.map((target) => ({ target })),
    abi: "erc20:decimals",
    chain,
    block,
    permitFailure: true,
  }).then((res: any) => {
    let ok = 0, fail = 0;
    res.output?.forEach((r: any) => {
      const target = r?.input?.target;
      const d = r?.output;
      if (target && d != null && target in data) { data[target].decimals = Number(d); ok++; }
      else fail++;
    });
    console.log(`[MC] erc20:decimals: ok=${ok}, fail=${fail}`);
  });

  // 2) symbol for input tokens (tokens we’re pricing)
  console.log(`[MC] fetching erc20:symbol for ${inTokens.length} input tokens...`);
  await multiCall({
    calls: inTokens.map((target) => ({ target })),
    abi: "erc20:symbol",
    chain,
    block,
    permitFailure: true,
  }).then((res: any) => {
    let ok = 0, fail = 0;
    res.output?.forEach((r: any) => {
      const target = r?.input?.target;
      const s = r?.output;
      if (target && s && target in data) { data[target].symbol = s; ok++; }
      else fail++;
    });
    console.log(`[MC] erc20:symbol: ok=${ok}, fail=${fail}`);
  });

  // 3) Build estimate calls: stable(out) -> token(in) with amountIn = 10^(stableDecimals)
  const feeTiers = getFees(chain);
  const estimateCalls: Call[] = [];
  const estimateMetas: { tokenOut: string }[] = [];

  tokens.forEach((t) => {
    const stable = t.out.toLowerCase();
    const targetToken = t.in.toLowerCase();
    const stableDec = data[stable]?.decimals;

    if (stableDec == null || stableDec < 0) {
      console.warn(`[WARN] Missing decimals for stable ${stable}, skip estimate calls for pair ${targetToken}/${stable}`);
      return;
    }
    const amountIn = (BigInt(10) ** BigInt(stableDec)).toString(); // 1 * 10^(stableDecimals)

    feeTiers.forEach((f) => {
      estimateCalls.push({
        target: quoters[chain],
        params: [{
          tokenIn: stable,
          tokenOut: targetToken,
          fee: Number(f),
          amountIn,
          sqrtPriceLimitX96,
        }],
      });
      estimateMetas.push({ tokenOut: targetToken });
    });
  });

  console.log(`[CALLS] estimateCalls built: ${estimateCalls.length}`);

  // 4) Execute estimate quotes and record max rawQty per token
  await multiCall({
    calls: estimateCalls,
    abi: (abi as any).quoteExactInputSingle,
    chain,
    block,
    permitFailure: true,
  }).then((res: any) => {
    let ok = 0, fail = 0;
    res.output?.forEach((r: any, i: number) => {
      const meta = estimateMetas[i];
      const amountOut = r?.output?.amountOut;
      if (!meta || amountOut == null) { fail++; return; }
      const tokenOut = meta.tokenOut;
      if (!(tokenOut in data)) { fail++; return; }
      if (amountOut > data[tokenOut].rawQty) data[tokenOut].rawQty = amountOut;
      ok++;
    });
    console.log(`[MC] estimate quoteExactInputSingle: ok=${ok}, fail=${fail}`);
  });

  // Summary after metadata & estimate
  const keys = Object.keys(data);
  const withOut = keys.filter(k => !!data[k].out).length;
  const withDec = keys.filter(k => data[k].decimals >= 0).length;
  const withSym = keys.filter(k => !!data[k].symbol).length;
  const posRaw = keys.filter(k => data[k].rawQty > 0).length;
  console.log(`[DATA] after metadata fetch: total=${keys.length}, withOut=${withOut}, decimals=${withDec}, symbols=${withSym}, rawQty>0=${posRaw}`);

  const sampleKeys = keys.slice(0, 2);
  console.log(`[RATES] after metadata fetch: sample ${sampleKeys.length}`);
  sampleKeys.forEach(k => {
    const d = data[k];
    console.log(`  ${k} => sym=${d.symbol} dec=${d.decimals} out=${d.out} rawQty=${d.rawQty} priceEst=${d.priceEstimate} largeRate=${d.largeRate} smallRate=${d.smallRate}`);
  });

  console.log(`[STEP] estimateValuesAndFetchMetadata(chain=${chain}) END\n`);
  return data;
}

// Build main quoter calls & metadata (token -> stable) for large/small sizes
function createMainQuoterCalls(
  chain: string,
  data: Data,
): { calls: Call[]; metas: CallMeta[] } {
  console.log(`\n[STEP] createMainQuoterCalls(chain=${chain}) START`);
  const calls: Call[] = [];
  const metas: CallMeta[] = [];
  const feeTiers = getFees(chain);

  let tokenCount = 0;
  Object.keys(data).forEach((token) => {
    if (!data[token].out) return;
    if (data[token].priceEstimate < 0) return;

    const largeQty = translateQty(dollarAmt, data[token].decimals, data[token].priceEstimate);
    if (!largeQty) return;

    const largeQtyBI = BigInt(sdk.util.convertToBigInt(largeQty).toString());
    let smallQtyBI = largeQtyBI / BigInt(dollarAmt); // ~1 USD
    if (smallQtyBI <= BigInt(0)) smallQtyBI = BigInt(1);

    feeTiers.forEach((f) => {
      // large
      calls.push({
        target: quoters[chain],
        params: [{
          tokenIn: token,
          tokenOut: data[token].out,
          fee: Number(f),
          amountIn: largeQtyBI.toString(),
          sqrtPriceLimitX96,
        }],
      });
      metas.push({
        tokenIn: token,
        tokenOut: data[token].out,
        amountIn: largeQtyBI.toString(),
        size: "large",
      });

      // small
      calls.push({
        target: quoters[chain],
        params: [{
          tokenIn: token,
          tokenOut: data[token].out,
          fee: Number(f),
          amountIn: smallQtyBI.toString(),
          sqrtPriceLimitX96,
        }],
      });
      metas.push({
        tokenIn: token,
        tokenOut: data[token].out,
        amountIn: smallQtyBI.toString(),
        size: "small",
      });
    });

    tokenCount++;
  });

  console.log(`[CALLS] created for ${tokenCount} tokens, total calls=${calls.length}, metas=${metas.length}`);
  logCallsMeta("createMainQuoterCalls metas (sample)", metas);
  console.log(`[STEP] createMainQuoterCalls(chain=${chain}) END\n`);
  return { calls, metas };
}

// Execute quotes and compute $/token rates; summarize results
async function fetchSwapQuotes(
  chain: string,
  calls: Call[],
  metas: CallMeta[],
  data: Data,
  block: number | undefined,
): Promise<void> {
  console.log(`\n[STEP] fetchSwapQuotes(chain=${chain}) START`);
  console.log(`[INFO] calls=${calls.length}, metas=${metas.length}`);

  const okCounts: Record<string, { large: number; small: number }> = {};
  let ok = 0, fail = 0, skipped = 0;

  await multiCall({
    calls,
    abi: (abi as any).quoteExactInputSingle,
    chain,
    block,
    permitFailure: true,
  }).then((res: any) => {
    res.output?.forEach((r: any, i: number) => {
      const meta = metas[i];
      if (!meta) { skipped++; return; }

      const token = meta.tokenIn;
      const amountInStr = meta.amountIn;
      const amountOut = r?.output?.amountOut;

      if (!amountOut || !amountInStr) { fail++; return; }
      if (!data[token] || !data[token].out || !data[data[token].out]) { fail++; return; }

      const amountIn = Number(amountInStr);
      if (!Number.isFinite(amountIn) || amountIn <= 0) { fail++; return; }

      // Correct $/token formula:
      // rate = (amountOut / 10^stableDec) / (amountIn / 10^tokenDec)
      //      = (amountOut * 10^(tokenDec - stableDec)) / amountIn
      const tokenDec = data[token].decimals;
      const stableDec = data[data[token].out].decimals;
      const scale = Math.pow(10, tokenDec - stableDec);
      const numer = Number(amountOut) * scale;
      if (!numer) { fail++; return; }

      const rate = numer / amountIn; // $ per 1 tokenIn

      if (!okCounts[token]) okCounts[token] = { large: 0, small: 0 };
      if (meta.size === "large") {
        if (data[token].largeRate < 0 || rate > data[token].largeRate) data[token].largeRate = rate;
        okCounts[token].large += 1;
      } else {
        if (data[token].smallRate < 0 || rate > data[token].smallRate) data[token].smallRate = rate;
        okCounts[token].small += 1;
      }
      ok++;
    });
  });

  console.log(`[MC] fetch quotes: ok=${ok}, fail=${fail}, skipped=${skipped}`);
  Object.keys(data).forEach((t) => {
    if (!data[t].out) return;
    const cnt = okCounts[t] || { large: 0, small: 0 };
    console.log(`[MC] token=${t} => okLarge=${cnt.large}, okSmall=${cnt.small}, largeRate=${data[t].largeRate}, smallRate=${data[t].smallRate}`);
    if (cnt.large + cnt.small === 0) {
      console.warn(`[WARN] No successful v3 quotes for token ${t} on ${chain} (all fee tiers failed).`);
    }
  });

  logSampleRates("after fetchSwapQuotes", data);
  console.log(`[STEP] fetchSwapQuotes(chain=${chain}) END\n`);
}

// Orchestrator per chain
async function findPricesThroughV3(
  chain: string,
  tokens: Tokens[],
  timestamp: number,
) {
  console.log(`\n[STEP] findPricesThroughV3(chain=${chain}) START, timestamp=${timestamp}`);
  try {
    const block = await getBlock(chain, timestamp);
    console.log(`[INFO] Resolved block for chain=${chain}, block=${block}`);

    const data = await estimateValuesAndFetchMetadata(chain, tokens, block);

    // Compute $/token priceEstimate only where rawQty > 0
    let priced = 0, unpriced = 0;
    Object.keys(data).forEach((addr) => {
      if (data[addr].rawQty > 0) {
        data[addr].priceEstimate = Math.pow(10, data[addr].decimals) / data[addr].rawQty;
        priced++;
      } else {
        data[addr].priceEstimate = -1;
        unpriced++;
      }
    });
    console.log(`[CALC] priceEstimate computed: priced=${priced}, unpriced=${unpriced}`);
    logSampleRates("after priceEstimate calc", data);

    const { calls, metas } = createMainQuoterCalls(chain, data);
    if (calls.length) {
      await fetchSwapQuotes(chain, calls, metas, data, block);
    } else {
      console.warn(`[WARN] No main quoter calls generated for chain=${chain} (nothing to fetch).`);
    }

    const writes: Write[] = [];
    let writeCount = 0, skipped = 0;

    Object.keys(data).forEach((t) => {
      const d = data[t];

      const requiredOk =
        d.out &&
        d.symbol &&
        d.decimals >= 0 &&
        d.smallRate > 0 &&
        d.largeRate > 0;

      if (!requiredOk) { skipped++; return; }

      // Confidence as similarity between large/small, bounded [0, 0.989]
      const top = Math.min(d.smallRate, d.largeRate);
      const bottom = Math.max(d.smallRate, d.largeRate);
      const confidence = Math.min(bottom > 0 ? top / bottom : 0, 0.989);
      console.log(`chain=${chain}, token=${t}, confidence=${confidence}`);
      addToDBWritesList(
        writes,
        chain,
        t,
        d.smallRate, // prefer the smaller swap rate (less impact)
        d.decimals,
        d.symbol,
        timestamp,
        "univ3",
        confidence,
      );
      writeCount++;
    });
    console.log("[DB WRITE] Prepared write object:", writes);

    console.log(`[WRITES] chain=${chain} produced writes=${writeCount}, skipped=${skipped}`);
    console.log(`[STEP] findPricesThroughV3(chain=${chain}) END\n`);
    return writes;
  } catch (err) {
    console.error(`[ERR] findPricesThroughV3 failed for chain ${chain}:`, err);
    console.log(`[STEP] findPricesThroughV3(chain=${chain}) END (error path)\n`);
    throw err;
  }
}

// Entry point
export function uniV3(timestamp: number = 0) {
  console.log(`\n[ENTRY] uniV3 START, timestamp=${timestamp}`);
  return Promise.allSettled([
    // Example BSC: CAKE -> USDT
    // findPricesThroughV3(
    //   "bsc",
    //   [
    //     {
    //       in: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // CAKE
    //       out: "0x55d398326f99059fF775485246999027B3197955", // USDT (18 on BSC)
    //     }, 
    //   ],
    //   timestamp,
    // ),
    findPricesThroughV3(
      "bsc",
      [
        {
          in: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
          out: "0x55d398326f99059fF775485246999027B3197955",
        }
      ],
      timestamp,
    ),

    // If you want Ethereum example, use a known-good pool like WETH -> USDC:
    // findPricesThroughV3(
    //   "ethereum",
    //   [
    //     {
    //       in:  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    //       out: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    //     },
    //   ],
    //   timestamp,
    // ),

  ]).then((results) => {
    const writes: Write[] = [];
    let fulfilled = 0, rejected = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        writes.push(...r.value);
        fulfilled++;
      } else {
        rejected++;
        if (r.status === "rejected") console.error("[ENTRY] uniV3 chain failed:", r.reason);
      }
    }
    console.log(`[ENTRY] uniV3 END: chains fulfilled=${fulfilled}, rejected=${rejected}, total writes=${writes.length}\n`);
    return writes;
  });
}
