Compound (./moneyMarkets/compound)
Aave (./moneyMarkets/aave)
Euler (./moneyMarkets/euler)
Silo (./moneyMarkets/silo)
dForce (./moneyMarkets/dforce)
Folks Finance (./moneyMarkets/folks-finance)
Capyfi (./moneyMarkets/capyfi)



Decentralized Exchanges (DEXs)
Uniswap (./markets/uniswap, ./markets/uniswap/v3)
Curve (./markets/curve)
Balancer (./markets/balancer)
PancakeSwap (./markets/pancakeStable)
SundaeSwap (./markets/sundaeswap, ./markets/sundaeswapv3)
Hop (./markets/hop)
Platypus (./markets/platypus)
Jarvis (./markets/jarvis)
Arrakis (./markets/arrakis)
Maverick (./markets/maverick)
Steer (./markets/steer)
Quipuswap (./markets/quipuswap)
Bluefin (./markets/bluefin)
Yield Aggregators & Vaults
Yearn (./yield/yearn)
Convex (./yield/convex)
Beefy (./yield/beefy)
Vesper (./yield/vesper)
Alchemix (./yield/alchemix)
Mean Finance (./yield/mean-finance)
Level Finance (./yield/level-finance)
Harvest (./yield/harvest)
Yield Yak (./yield/yield-yak)


Liquid Staking
Ankr (./liquidStaking/ankr)
pxETH (./liquidStaking/pxeth)
sthApt (./liquidStaking/sthapt)
truAPT (./liquidStaking/truapt)


Bridges
Hop (./markets/hop)
Stargate (./markets/stargate)
Oracles
Pyth (./oracles/pyth)
PythAggregatorV3 (./oracles/pythAggregatorV3)
ChainlinkNFT (./nft/chainlink)


explain with uniswap adapter 
1. Entry Point (Called by Orchestrator)
File: src/adapters/markets/uniswap/uniswap.ts
Function: getTokenPrices

This is the main exported async function called by the orchestrator (storeCoins.ts).
It coordinates all the steps to fetch, calculate, and return price data.

2. Get Block Number
File: src/utils/block.ts
Function: getBlock

Fetches the block number for the given chain and timestamp.
In this context, block refers to a specific block number on the BSC (Binance Smart Chain) blockchain.

Why is it important?

Blockchain data (like Uniswap pool reserves) changes with every new block.
To get an accurate price for CAKE (or any coin) at a specific time, you must query the state of the Uniswap pool at a specific block.
This ensures the price you calculate matches the exact moment you want (e.g., for historical price queries or for consistent snapshots).
How is it used?

The adapter calls getBlock("bsc", timestamp) to get the block number closest to your desired timestamp on BSC.
All subsequent on-chain queries (reserves, balances, etc.) are made "as of" that block.
This gives you the price of CAKE (from Uniswap on BSC) at that exact point in time.
Summary:

block = the snapshot of the blockchain at a specific moment.
It is essential for accurate, time-specific price calculations from Uniswap or any DEX.


3. Fetch Pool Addresses
If using a subgraph:
File: src/adapters/markets/uniswap/uniswap.ts
Function: fetchUniV2MarketsFromSubgraph
If using on-chain factory:
File: src/adapters/markets/uniswap/uniswap.ts
Function: fetchUniV2Markets
Step 3: Fetch Pool Addresses
What happens?
The function fetchUniV2Markets (or fetchUniV2MarketsFromSubgraph) is called.
It queries the Uniswap factory contract (on BSC) to get a list of all pool (pair) addresses.
Each pool address represents a trading pair, e.g., CAKE-BNB, CAKE-USDT, etc.
Why is this needed for CAKE price?
To get the price of CAKE, you need to find all pools where CAKE is one of the tokens.
By fetching all pool addresses, you can later check which pools contain CAKE as either token0 or token1.
Once you have the relevant pool(s), you can fetch their reserves and calculate the price of CAKE relative to the other token in the pool (e.g., CAKE/BNB).
How does it work in code?
The function calls the factory contract’s allPairs (or similar) method for each index, up to the total number of pairs.
It collects all pool addresses into an array.
Example: If there are 1000 pools, it will get 1000 addresses.
In your context (CAKE on BSC):
The adapter will fetch all pool addresses from the Uniswap factory on BSC.
Later steps will filter these pools to find the ones where CAKE is present.
The reserves of the CAKE pool(s) will be used to calculate the on-chain price of CAKE.
Summary:
This step is about discovering all possible trading pairs on Uniswap (on BSC), so you can later identify and use the pool(s) that contain CAKE to calculate its price.

4. Fetch Pool Data (token0, token1, reserves)
File: src/adapters/markets/uniswap/uniswap.ts
Function: fetchUniV2MarketData

Uses multicall to get token0, token1, and reserves for each pool.
What happens?
For every pool address found in the previous step (which could include CAKE pairs like CAKE/BNB, CAKE/USDT, etc.), the function fetches:
token0 and token1: The addresses of the two tokens in the pool.
reserves: The current on-chain balances of both tokens in the pool.
Why is this needed for CAKE price?
To calculate the price of CAKE, you need to know:
Which pools contain CAKE (by checking if token0 or token1 is CAKE’s address).
The amount of CAKE and the other token in the pool (from reserves).
The price of CAKE in that pool is determined by the ratio of the reserves:
If the pool is CAKE/BNB, and you know the reserves of both, you can compute how much BNB one CAKE is worth (and then convert to USD if you know BNB’s price).
How does it work in code?
The function uses multicall to efficiently fetch:
token0 for each pool: which token is in the first slot.
token1 for each pool: which token is in the second slot.
getReserves for each pool: the current balances of both tokens.
This is done for all pools in parallel, using the block number from the previous step (so all data is from the same point in time).
In your context (CAKE on BSC):
The adapter will:
Fetch all pool addresses from the Uniswap factory on BSC.
For each pool, fetch the two token addresses and their reserves.
Identify pools where one of the tokens is CAKE.
Use the reserves from those pools to calculate the on-chain price of CAKE.

5. Get Underlying Token Prices
File: src/adapters/utils/database.ts
Function: getTokenAndRedirectData

Fetches prices for all unique underlying tokens in the pools.
Step 5: Get Underlying Token Prices (getTokenAndRedirectData)
What happens?
After fetching all pool data, you now have a list of all unique tokens present in those pools (e.g., CAKE, BNB, USDT, etc.).
The function getTokenAndRedirectData is called with this list of token addresses, the chain (BSC), the timestamp, and a limit (12).
This function queries external price oracles (like Coingecko, Chainlink, or internal price feeds) to get the current USD price for each token.
Why is this needed for CAKE price?
On-chain, you can only get the ratio of reserves between two tokens in a pool (e.g., how many BNB per CAKE).
To express the price of CAKE in USD, you need to know the USD price of at least one of the tokens in the pair (e.g., BNB/USD).
If you know BNB’s USD price and the on-chain CAKE/BNB ratio, you can calculate CAKE’s USD price:
CAKE/USD = (CAKE/BNB) * (BNB/USD)
How does it work in code?
The function collects all unique token addresses from the pools.
It queries price feeds for each token address.
It returns a mapping of token address → price (and possibly other metadata like decimals, symbol, confidence).
In your context (CAKE on BSC):
Suppose you have a CAKE/BNB pool.
The adapter will:
Fetch the on-chain reserves for CAKE and BNB in the pool.
Use getTokenAndRedirectData to get the USD price of BNB (and CAKE, if available).
If BNB’s price is known, it can now calculate CAKE’s USD price using the pool ratio.
Summary:
This step bridges the gap between on-chain ratios and real-world prices. It ensures that, even if CAKE itself doesn’t have a direct USD price feed, you can still compute its USD price using the price of a paired token (like BNB) and the on-chain pool ratio

6. Find Priceable LPs
File: src/adapters/markets/uniswap/uniswap.ts
Function: findPriceableLPs

Determines which LPs can be priced based on available token prices.
Step 6: Find Priceable LPs (findPriceableLPs)
What happens?
For each pool (pair) address, you now know:

The two token addresses (token0, token1)
The reserves of each token
The list of tokens for which you have a known USD price (from the previous step)
The function loops through all pools and checks:

Does either token0 or token1 have a known price?
If yes, this pool is "priceable" (you can calculate the price of the LP token, and possibly the unknown token).
If both tokens have known prices, the price calculation is more robust.
For each priceable pool, it creates an object with:

The pool address
Which token is the "primary" (the one with a known price)
Which is the "secondary" (possibly unknown price)
The reserves for each
Whether both tokens are known
Whether the primary is token1
Why is this needed for CAKE price?
You want to price CAKE in USD, but you can only do this if:
CAKE is in a pool with a token that has a known USD price (e.g., BNB, USDT, etc.)
If CAKE is paired with BNB, and BNB has a known USD price, you can price CAKE.
If CAKE is paired with another token that does not have a known price, you cannot price CAKE from that pool.
How does it work in code?
For each pool:
Checks if token0 or token1 is in the list of tokens with known prices.
If neither is known, skips this pool.
If at least one is known, adds the pool to the list of priceable LPs, with metadata about which token is known.
In your context (CAKE on BSC):
Suppose you have a pool: CAKE/BNB
If BNB’s price is known, this pool is priceable.
If both CAKE and BNB have known prices, the pool is even more reliable for pricing.
The function will include this pool in the list of priceable LPs, so the next steps can calculate the price of CAKE and/or the LP token.
Summary:
This step filters out pools that cannot be priced (because neither token has a known price) and prepares a list of pools where price calculation is possible. For CAKE, it ensures you only try to price CAKE from pools where you have enough information to do so.

7. Get LP Token Info
File: src/utils/erc20.ts
Function: getLPInfo

Fetches LP token decimals, symbols, supplies, and underlying token info.
Step 7: Get LP Token Info (getLPInfo in src/utils/erc20.ts)
What does it do?
For each priceable LP (liquidity pool) found in the previous step, this function fetches important metadata about the LP token and its underlying tokens:
LP token decimals: How many decimal places the LP token uses.
LP token symbol: The symbol for the LP token (e.g., "CAKE-BNB-LP").
LP token total supply: The total number of LP tokens in existence.
Underlying token symbols: The symbols for the two tokens in the pool (e.g., "CAKE" and "BNB").
Underlying token decimals: The decimals for each underlying token.
Why is this needed?
Decimals:
On-chain values (reserves, supply) are stored as integers. Decimals are needed to convert these to human-readable numbers (e.g., 1e18 = 1.0 token if decimals=18).
Symbols:
For labeling and identifying the LP and its underlying tokens in the output and database.
Total Supply:
To calculate the price per LP token:
The total value of the pool (in USD) divided by the total supply gives the price of one LP token.
Underlying Info:
To display which tokens are in the pool and to ensure calculations use the correct tokens and decimals.
In your context (CAKE on BSC):
Suppose you have a CAKE/BNB pool:
getLPInfo fetches:
The LP token’s decimals (e.g., 18)
The LP token’s symbol (e.g., "CAKE-BNB-LP")
The total supply of LP tokens
The symbols and decimals for CAKE and BNB
This info is used to:
Normalize all on-chain values to real numbers
Calculate the price of the LP token
Properly label the output in the database
Example Calculation
If the pool has $1,000,000 in value and 100,000 LP tokens:
LP price = $1,000,000 / 100,000 = $10 per LP token
Decimals ensure you’re dividing/multiplying the correct values.
Summary:
getLPInfo provides all the metadata needed to accurately and meaningfully calculate and label LP token prices, ensuring your price data is correct and human-readable.


8. Calculate and Add Writes
For LPs with both tokens known:

File: src/adapters/markets/uniswap/uniswap.ts
Function: lps
For LPs with one unknown token:

File: src/adapters/markets/uniswap/uniswap.ts
Function: unknownTokens
Calls getConfidenceScores (same file) for confidence estimation.
Calls translateQty (same file) for swap size calculation.
Both functions use:

File: src/adapters/utils/database.ts
Function: addToDBWritesList
Adds the calculated price data to the writes array.


9. Return Results
File: src/adapters/markets/uniswap/uniswap.ts
Function: getTokenPrices (main function)

Returns the array of Write objects to the orchestrator.


more concise version : 
1. Get the block number (snapshot)
Get the block number for the given timestamp on the target chain (e.g., BSC).
This ensures all on-chain data is from the same moment in time.
2. Get all pool addresses from Uniswap
Fetch all pool (pair) addresses from the Uniswap factory contract (on-chain) or via subgraph (off-chain indexer).
Each pool represents a trading pair (e.g., CAKE/BNB).
3. Get pool data
For each pool, fetch:
token0 and token1 addresses (the two tokens in the pool)
The reserves (on-chain balances) of each token in the pool at the snapshot block
4. Get underlying token prices
Query external price feeds (e.g., Coingecko, Chainlink) for the USD price of each unique token found in the pools.
5. Find priceable pools
For each pool, check if at least one token has a known USD price.
If yes, the pool is "priceable" (you can calculate the price of the other token and/or the LP token).
If both tokens have known prices, the price is more reliable.
6. Get LP info
For each priceable pool, fetch:
LP token decimals, symbol, and total supply
Underlying token symbols and decimals
This info is needed to normalize values and label the output.
7. Calculate prices and write to database
For each priceable pool:
Calculate the price of the LP token (and possibly the unknown token) using the reserves, token prices, and LP info.
Structure the result as a "write" object.
Write all results to the database (e.g., DynamoDB).
Handle any errors (e.g., missing data, calculation errors) gracefully—these pools/tokens are skipped or logged.



explain with uniswapv3 adapter 
 Entry Point: uniV3(timestamp: number = 0)
File: v3.ts
What it does:
Calls findPricesThroughV3 for a specific token pair (hardcoded in this example: in and out addresses) on Ethereum, passing the timestamp.
Purpose:
This is the function called by your orchestrator to start the Uniswap V3 price-fetching process.
2. Find Prices: findPricesThroughV3(chain, tokens, timestamp)
File: v3.ts
What it does:
a. Gets the block number for the given timestamp using getBlock (from ../../utils/block).
b. Calls estimateValuesAndFetchMetadata to get initial swap estimates and token metadata.
c. Calculates a rough price estimate for each token.
d. Calls createMainQuoterCalls to prepare swap quote calls for different amounts and fee tiers.
e. Calls fetchSwapQuotes to get actual swap rates for large and small amounts.
f. Calculates confidence and writes price data to the database.
3. Estimate Values and Fetch Metadata: estimateValuesAndFetchMetadata(chain, tokens, block)
File: v3.ts
What it does:
a. Prepares calls to the Uniswap V3 Quoter contract to estimate how much of out token you get for swapping 1e6 units of in token (for each fee tier).
b. Prepares calls to get decimals and symbol for all tokens involved.
c. Runs all these calls in parallel using multiCall (from @defillama/sdk).
d. Fills a data object with the results: raw swap output, decimals, and symbol for each token.
Purpose:
This step gets the basic info needed to price each token: how much you get in a swap, and how to interpret the numbers (decimals).
4. Calculate Initial Price Estimates
File: v3.ts (in findPricesThroughV3)
What it does:
For each token, calculates a rough price estimate as 10 ** decimals / rawQty (i.e., how much 1 token is worth in terms of the other).
Purpose:
This gives a starting point for more accurate price calculations.
5. Prepare Main Quoter Calls: createMainQuoterCalls(chain, data)
File: v3.ts
What it does:
For each token, prepares calls to the Uniswap V3 Quoter to simulate swaps of both large and small amounts (for all fee tiers).
Purpose:
This is to check for price impact and liquidity: large swaps may get worse rates if liquidity is low.
6. Fetch Swap Quotes: fetchSwapQuotes(chain, calls, data, block)
File: v3.ts
What it does:
a. Executes all prepared swap quote calls using multiCall.
b. For each result, calculates the effective rate for large and small swaps, and stores them in the data object.
Purpose:
This step gets the actual on-chain swap rates, which are used to determine the real price and liquidity for each token.
7. Calculate Confidence and Write Results
File: v3.ts (in findPricesThroughV3)
What it does:
a. For each token, checks if all required data is present.
b. Calculates a confidence score as largeRate / smallRate (capped at 0.989).
c. Calls addToDBWritesList (from ../../utils/database) to prepare a write object with the price, decimals, symbol, timestamp, source ("univ3"), and confidence.
Purpose:
This step finalizes the price and confidence for each token and prepares it for storage in the database.
8. Return Results
File: v3.ts (in findPricesThroughV3 and uniV3)
What it does:
Returns the array of write objects to the orchestrator, which will batch write them to DynamoDB.
Related Files/Functions
getBlock: ../../utils/block.ts — gets the block number for a timestamp.
addToDBWritesList: ../../utils/database.ts — prepares a write object for the DB.
multiCall: @defillama/sdk — batches many on-chain calls for efficiency.
translateQty: ./uniswap.ts — helps convert USD amounts to token amounts for swap simulation.
Key Points
This adapter does not scan all pools; it works with a specific list of token pairs (you can expand this).
It uses the Uniswap V3 Quoter contract to simulate swaps and get real on-chain prices, accounting for liquidity and slippage.
It writes price data for each token it can price, with a confidence score based on the difference between large and small swap rates.

concise way : 
The purpose of this step is to fetch the real, on-chain price of CAKE in terms of USDT (or vice versa) from PancakeSwap V3, using the Quoter contract to simulate swaps and account for liquidity and slippage. This gives you a reliable, up-to-date price that reflects actual trading conditions.

Step-by-Step Breakdown
a. Get the block number for the given timestamp
Calls getBlock(chain, timestamp).
Why?: Ensures all on-chain data (swap rates, token balances, etc.) is from the same moment in time, so your price snapshot is accurate and consistent.
b. Call estimateValuesAndFetchMetadata
Simulates a swap of a small, fixed amount (e.g., 1 USDT) for CAKE using the Quoter contract, for each fee tier.
Also fetches token metadata (decimals, symbol) for both CAKE and USDT.
Why?: This gives a rough idea of how much CAKE you get for 1 USDT, and provides the info needed to interpret the numbers.
c. Calculate a rough price estimate for each token
For each token, calculates an initial price estimate using the swap output and token decimals.
Why?: This is a quick, approximate price to use as a starting point for more detailed calculations.
d. Call createMainQuoterCalls
Prepares a set of calls to the Quoter contract to simulate swaps of both large and small amounts, for all fee tiers.
Why?: This checks for price impact and liquidity—large swaps may get worse rates if liquidity is low, so you can measure slippage and market depth.
e. Call fetchSwapQuotes
Executes all the prepared Quoter calls using multicall.
For each result, calculates the effective swap rate for both large and small amounts, and stores them.
Why?: This gives you the real, on-chain price for CAKE/USDT, accounting for liquidity and slippage.
f. Calculate confidence and write price data to the database
For each token, calculates a confidence score (how much the price changes between small and large swaps).
Calls addToDBWritesList to prepare a write object with the price, decimals, symbol, timestamp, source, and confidence.
Why?: This finalizes the price and confidence for CAKE/USDT and prepares it for storage in your database, so it can be used by other systems or shown to users.




pancakestable adapter!
Certainly! Here’s how each step in the pancakeStable adapter works, specifically for getting the price of CAKE (if it is part of a stable pool) on BSC in PancakeSwap:

1. Factory Setup
The adapter knows the PancakeSwap StableSwap factory contract address on BSC.
This contract emits events whenever a new stable pool (e.g., CAKE/USDT/USDC) is created.
detect all stable pools created by the PancakeSwap StableSwap factory on BSC


2. Get Current Block and API
The adapter gets the current timestamp (or uses the one you provide).
It initializes the api object, which is used to make all on-chain calls at the correct block.
The api object is a helper that lets you make on-chain calls (like reading logs, balances, supplies) as of a specific block.
This ensures all the data you fetch (pool balances, supplies, etc.) is from the same point in time (the same block), which is critical for accurate price calculations.
Why is this important?
Blockchain data changes with every block.
If you want a consistent snapshot of all pool balances and supplies, you must query them at the same block.
The api object abstracts away the details of finding the right block for your timestamp and making all calls at that block.


3. Fetch All StableSwap Pools
The adapter fetches all NewStableSwapPair events from the factory contract.
Each event gives you the addresses of the pool contract, tokenA, tokenB, tokenC (optional), and the LP token.
If CAKE is in any of these pools (as tokenA, tokenB, or tokenC), it will be included in the next steps.
This step automatically finds every stable pool that exists on PancakeSwap, including any new pools that have been created since the last run.
If CAKE is present as tokenA, tokenB, or tokenC in any pool, that pool will be included in the next steps for price calculation.

4. Fetch On-Chain Data for Each Pool
For each pool, the adapter fetches:
The balance of tokenA, tokenB, and tokenC in the pool contract.
The total supply and decimals of the LP token.
This is done using efficient batch calls (multiCall).
For every stable pool found in the previous step, fetch all the on-chain data needed to calculate the value of the pool and its LP token.
For each pool (deploy), you have:

log.args[0]: The pool contract address (swapContract)
log.args[1]: tokenA address
log.args[2]: tokenB address
log.args[3]: tokenC address (may be the null address if the pool only has two tokens)
log.args[4]: LP token address
The code uses api.multiCall to batch many on-chain calls into a single request for efficiency.

Specifically, it fetches:

The balance of tokenA in the pool contract (balanceOf(pool) for tokenA)
The balance of tokenB in the pool contract (balanceOf(pool) for tokenB)
The balance of tokenC in the pool contract (balanceOf(pool) for tokenC, if present)
The total supply of the LP token (totalSupply() for the LP token)
The decimals of the LP token (decimals() for the LP token)


5. Fetch Token Prices
The adapter calls getTokenAndRedirectDataMap to get the USD price and decimals for all tokens in all pools (including CAKE if present).
This uses oracles or price feeds (e.g., Coingecko, Chainlink).
For every pool, you extract the addresses of tokenA, tokenB, and tokenC.
You flatten all these addresses into a single list (so you have every token in every pool).
You call getTokenAndRedirectDataMap with this list, the chain, and the timestamp.
What does getTokenAndRedirectDataMap do?

It queries price oracles (like Coingecko, Chainlink, or internal price feeds) to get the current USD price and decimals for each token address.
It returns a mapping:
{ [tokenAddress]: { price: <usd price>, decimals: <decimals>, ... } }
If CAKE is present in any pool, you’ll get its USD price and decimals in this mapping.
Why is this important?
You need the USD price of each token to calculate the total USD value of the pool (AUM).
Decimals are needed to convert raw on-chain balances to human-readable numbers.
Without this step, you can’t value the pool or its LP token in USD.

6. Calculate AUM (Assets Under Management)
For each pool, the adapter calculates the total USD value of all tokens in the pool:
For each token (including CAKE if present), multiplies its balance by its USD price, divided by its decimals.
Sums the values for all tokens in the pool.
Token Discovery:
For each pool, the adapter gets the addresses of up to three tokens (tokenA, tokenB, tokenC). CAKE will be included if it is one of these tokens.

Balance Fetching:
The adapter uses multicall to fetch the on-chain balance of each token in the pool contract.

balancesA[i] is the balance of tokenA in pool i
balancesB[i] is the balance of tokenB in pool i
balancesC[i] is the balance of tokenC in pool i (may be zero or null if not present)
Price Fetching:
The adapter calls getTokenAndRedirectDataMap to get the USD price and decimals for each token, using their addresses.

AUM Calculation (the core step):
For each pool, the code does:

For each token, it calls getAum(address, balance).
getAum looks up the token’s price and decimals, and computes:
This converts the raw on-chain balance to a human-readable amount, then multiplies by the USD price to get the USD value for that token in the pool.
It sums the USD values for all tokens in the pool to get the total AUM.
Special Handling:

If a token is not present (e.g., tokenC is the null address), it skips or sets its value to zero.
Example (with CAKE in the pool)
Suppose a pool contains CAKE, USDT, and BUSD:

The adapter fetches the balances of CAKE, USDT, and BUSD in the pool contract.
It fetches the USD price and decimals for each token.
For each token:
Converts the raw balance to the real amount (using decimals)
Multiplies by the USD price
Sums the USD values for CAKE, USDT, and BUSD to get the pool’s total AUM.
Why is this important?
The AUM is used to calculate the price of the pool’s LP token (total AUM divided by total LP supply).
This ensures the LP token price reflects the real, up-to-date USD value of all assets in the pool, including CAKE if presen

7. Calculate LP Token Price
The adapter divides the total AUM by the total supply of LP tokens (normalized by decimals) to get the price per LP token.
This is the price of the LP token, not CAKE directly.
This price is for the LP token, not for CAKE directly.
If you hold 10 LP tokens, and each is worth $10, your share of the pool is $100.
The LP token price changes as the pool’s AUM or total supply changes (e.g., due to swaps, deposits, withdrawals, or price changes of underlying tokens).
This step ensures that anyone holding LP tokens can know their current USD value, which is essential for DeFi transparency


8. Write Results
The adapter prepares a write object for each LP token, including its price, decimals, symbol, timestamp, and confidence.
These are written to the database.
