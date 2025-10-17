import { multiCall } from "@defillama/sdk/build/abi";
import * as sdk from "@defillama/sdk";
import getBlock from "../../utils/block";
import { translateQty } from "./uniswap";
import { PriceResponse } from "../../utils/dbInterfaces";
import abi from "./abi.json";

type Chain = string;
type Dex = "pancakeswap" | "uniswap";

type Entry = {
  in: string;                 // input token (priced token)
  out: string;                // output token (usually stable)
  dex: Dex;

  decimalsIn: number;
  decimalsOut: number;
  symbolIn?: string;
  symbolOut?: string;
  pairSymbol?: string;        // <-- NEW

  // bootstrap
  rawQty: number;             // tokens per 1 out-token
  priceEstimate: number;      // ~$ per token (rough)

  // sized quotes
  largeQty?: bigint;
  smallQty?: bigint;
  largeRate: number;          // $/token for large swap
  smallRate: number;          // $/token for small swap
};

type Data = Record<string, Entry>;      // key = `${dex}:${inAddr}`
type Call = { target?: string; params?: any; };

// Input can carry a human-friendly pair symbol (e.g. "CAKE/USDT")
type Tokens = { in: string; out: string; dex: Dex; symbol?: string };

// v3 fee tiers per DEX
const FEES_BY_DEX: Record<Dex, number[]> = {
  pancakeswap: [10000, 2500, 500, 100],
  uniswap:     [10000, 3000, 500, 100],
};

const sqrtPriceLimitX96 = "0";
const dollarAmt = 10 ** 5;

// QuoterV2 per chain/DEX
const quoters: Record<string, Record<Dex, string>> = {
  bsc: {
    pancakeswap: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997", // Pancake v3 Quoter
    uniswap:     "0x78D78E420Da98ad378D7799bE8f4AF69033EB077", // Uniswap v3 Quoter (BSC)
  },
};

// reverse lookup quoter -> dex so we can tag responses
const reverseQuoter: Record<string, Record<string, Dex>> = Object.fromEntries(
  Object.entries(quoters).map(([chain, m]) => ([
    chain,
    Object.fromEntries(Object.entries(m).map(([dex, addr]) => [addr.toLowerCase(), dex as Dex])),
  ])),
);

function keyOf(dex: Dex, inAddr: string) {
  return `${dex}:${inAddr.toLowerCase()}`;
}

function priceFromQuote(
  amountIn: bigint, inDec: number,
  amountOut: bigint, outDec: number,
): number {
  const outHuman = Number(amountOut) / 10 ** outDec;
  const inHuman  = Number(amountIn)  / 10 ** inDec;
  if (!isFinite(outHuman) || !isFinite(inHuman) || inHuman === 0) return -1;
  return outHuman / inHuman; // (out per in). If out is $1 stable, this is $/token
}

export async function uniV3(timestamp: number = 0, coinsInfo: any) {
  console.time("handler");
  console.log("univ3 running for timestamp", timestamp, coinsInfo);

  const results = await Promise.all([
    findPricesThroughV3("bsc", coinsInfo.bsc as Tokens[], timestamp),
  ]);

  console.log("univ3 done", results);
  console.timeEnd("handler");
  return results;
}

// -----------------------------
// pipeline
// -----------------------------

async function findPricesThroughV3(chain: Chain, tokens: Tokens[], timestamp: number) {
  const block = await getBlock(chain, timestamp);

  // 1) bootstrap & metadata
  const { data } = await estimateValuesAndFetchMetadata(chain, tokens, block);

  // 2) build forward quotes
  const calls = createMainQuoterCalls(chain, data);

  // 3) execute & fill rates
  await fetchSwapQuotes(chain, calls, data, block);

  // 4) build result rows (now include symbol)
  const writes: (PriceResponse & { symbol?: string })[] = [];
  Object.values(data).forEach((e) => {
    if (
      !e.out ||
      e.decimalsIn < 0 ||
      e.decimalsOut < 0 ||
      e.smallRate <= 0 ||
      e.largeRate <= 0 ||
      !isFinite(e.smallRate) ||
      !isFinite(e.largeRate)
    ) return;

    const confidence = Math.min(e.largeRate / e.smallRate, 0.989);
    const pairSymbol = e.pairSymbol || (
      e.symbolIn && e.symbolOut ? `${e.symbolIn}/${e.symbolOut}` : undefined
    );

    console.log(
      `v3 ${chain} ${e.dex} ${pairSymbol ?? `${e.in}/${e.out}`} price=${e.smallRate} (~$${e.priceEstimate.toFixed(10)}) conf=${confidence.toFixed(6)}`
    );

    writes.push({
      in: e.in,
      out: e.out,
      price: e.smallRate,
      chain,
      exchange: e.dex,
      symbol: pairSymbol,     // <-- INCLUDED IN RESULT
    });
  });

  console.log("data response", writes);
  return writes;
}

// --- metadata + bootstrap reverse quotes (OUT -> IN) ---

async function estimateValuesAndFetchMetadata(
  chain: Chain,
  tokens: Tokens[],
  block?: number,
): Promise<{ data: Data }> {
  const inTokens  = [...new Set(tokens.map(t => t.in.toLowerCase()))];
  const outTokens = [...new Set(tokens.map(t => t.out.toLowerCase()))];
  const allTokens = [...new Set([...inTokens, ...outTokens])];

  // fetch decimals & symbols once per address
  const tokenDecimals: Record<string, number> = {};
  const tokenSymbols: Record<string, string> = {};

  await Promise.all([
    multiCall({
      chain, block, abi: "erc20:decimals",
      calls: allTokens.map((target) => ({ target })),
    }).then((res: any) => res.output.forEach((r: any) => {
      tokenDecimals[r.input.target.toLowerCase()] = Number(r.output);
    })),

    multiCall({
      chain, block, abi: "erc20:symbol",
      calls: allTokens.map((target) => ({ target })), // <-- fetch both in & out symbols
    }).then((res: any) => res.output.forEach((r: any) => {
      tokenSymbols[r.input.target.toLowerCase()] = r.output;
    })),
  ]);

  // initialize entries per (dex, in)
  const data: Data = {};
  tokens.forEach(({ in: inn, out, dex, symbol }) => {
    const inL  = inn.toLowerCase();
    const outL = out.toLowerCase();
    const k = keyOf(dex, inL);
    data[k] = {
      in: inL,
      out: outL,
      dex,
      decimalsIn: tokenDecimals[inL]  ?? -1,
      decimalsOut: tokenDecimals[outL] ?? -1,
      symbolIn: tokenSymbols[inL],
      symbolOut: tokenSymbols[outL],
      pairSymbol: symbol || (tokenSymbols[inL] && tokenSymbols[outL] ? `${tokenSymbols[inL]}/${tokenSymbols[outL]}` : undefined),

      rawQty: -1,
      priceEstimate: -1,
      largeRate: -1,
      smallRate: -1,
    };
  });

  // build reverse-quote calls: swap 1 unit of OUT -> IN (per dex)
  const estimateCalls: Call[] = tokens.flatMap(({ in: inn, out, dex }) => {
    const qaddr = quoters[chain]?.[dex];
    if (!qaddr) return [];
    const outL = out.toLowerCase();
    const feeTiers = FEES_BY_DEX[dex] || [3000];
    const outDec = tokenDecimals[outL] ?? 18;
    const oneOut = (10n ** BigInt(outDec)).toString();   // 1.0 OUT in raw units
    return feeTiers.map((fee) => ({
      target: qaddr,
      params: [[ outL, inn.toLowerCase(), oneOut, fee, sqrtPriceLimitX96 ]],
    }));
  });

  if (estimateCalls.length) {
    const revMap = reverseQuoter[chain] || {};
    await multiCall({
      chain, block, abi: abi.quoteExactInputSingle, calls: estimateCalls, permitFailure: true,
    }).then((res: any) => res.output.forEach((r: any) => {
      if (!r?.output) return;
      const params = r.input.params[0];
      const quoterAddr = (r.input.target as string).toLowerCase();
      const dex = revMap[quoterAddr] as Dex | undefined;
      if (!dex) return;

      const inAddr  = (params[1] as string).toLowerCase();  // IN token (we want to price)
      const k = keyOf(dex, inAddr);
      if (!data[k]) return;

      const amountOut = Number(r.output.amountOut);
      if (amountOut > data[k].rawQty) data[k].rawQty = amountOut;
    }));
  }

  // derive priceEstimate and precompute large/small notional sizes
  Object.values(data).forEach((e) => {
    if (e.rawQty > 0 && e.decimalsIn >= 0) {
      e.priceEstimate = Math.pow(10, e.decimalsIn) / e.rawQty;
      const L = translateQty(dollarAmt, e.decimalsIn, e.priceEstimate);
      const S = translateQty(1,          e.decimalsIn, e.priceEstimate);
      if (L) e.largeQty = sdk.util.convertToBigInt(L);
      if (S) e.smallQty = sdk.util.convertToBigInt(S);
    }
  });

  return { data };
}

// --- forward quotes (IN -> OUT) for large/small ---

function createMainQuoterCalls(chain: Chain, data: Data): Call[] {
  const calls: Call[] = [];
  Object.values(data).forEach((e) => {
    const qaddr = quoters[chain]?.[e.dex];
    if (!qaddr || !e.out || !e.largeQty || !e.smallQty) return;
    const fees = FEES_BY_DEX[e.dex] || [3000];

    fees.forEach((fee) => {
      calls.push(
        { target: qaddr, params: [[ e.in, e.out, e.largeQty.toString(), fee.toString(), sqrtPriceLimitX96 ]] },
        { target: qaddr, params: [[ e.in, e.out, e.smallQty.toString(), fee.toString(), sqrtPriceLimitX96 ]] },
      );
    });
  });
  return calls;
}

async function fetchSwapQuotes(
  chain: Chain, calls: Call[], data: Data, block?: number,
): Promise<void> {
  if (!calls.length) return;
  const revMap = reverseQuoter[chain] || {};

  await multiCall({
    chain, block, abi: abi.quoteExactInputSingle, calls, permitFailure: true,
  }).then((res: any) => res.output.forEach((r: any) => {
    if (!r?.output) return;

    const targetAddr = (r.input.target as string).toLowerCase();
    const dex = revMap[targetAddr] as Dex | undefined;
    if (!dex) return;

    const params   = r.input.params[0];
    const inAddr   = (params[0] as string).toLowerCase();
    const outAddr  = (params[1] as string).toLowerCase();
    const amountIn = BigInt(params[2]);
    const amountOut= BigInt(r.output.amountOut);

    const k = keyOf(dex, inAddr);
    const e = data[k];
    if (!e || e.out !== outAddr) return;

    const price = priceFromQuote(amountIn, e.decimalsIn, amountOut, e.decimalsOut);
    if (price <= 0) return;

    // robust large/small detection: compare against midpoint
    if (e.largeQty && e.smallQty) {
      const mid = (e.largeQty + e.smallQty) / 2n;
      const isLarge = amountIn >= mid;
      if (isLarge) {
        if (price > e.largeRate) e.largeRate = price;
      } else {
        if (price > e.smallRate) e.smallRate = price;
      }
    }
  }));
}
