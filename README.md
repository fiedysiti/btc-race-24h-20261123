# btc-race-24h-20261123

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/fiedysiti/btc-race-24h-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/fiedysiti/btc-race-24h-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A one-asset trend bot for the [make.fun](https://make.fun/bounty/btc-race-24h-20261123-0511) BTC trading race. It trades Coinbase Wrapped BTC (CBBTC) against USDC on 1-minute on-chain bars, starting from $1,000 of paper money, and is ranked by net PnL on the 24 hours after the deadline.

## The idea

A 24-hour BTC day is either a trend or noise, and a full round trip costs about 26 bps in fees, slippage and price impact — so the bot trades rarely, and only when the move is big enough to pay for itself. It sizes once, early, then either rides the trend or gets out.

- **Bar 60 is the sizing decision.** If the close is above the very first close, the first hour drifted up, so the bot buys everything: on a trending day that is the whole move. If the first hour drifted down or flat, it buys only a 10% probe. The probe guarantees at least one trade in every regime (the race ranks a no-trade entry below every entry that traded) and caps the loss on a down day at a tenth of the book.
- **One breakout scale-in.** If the bot only probed, a later close above every close of the previous two hours puts the rest of the cash in. A breakout is relative to the recent range, not an absolute return, so it fires on a genuine new high and not on a dead-cat bounce. At most one scale-in happens per day, so a failed bounce can whipsaw it at most once.
- **Two exits.** A stop 1.5% below the entry price, and a trend exit when the trailing 120-bar return drops below −2%. No entries in the last hour.

Everything is exact integer arithmetic on raw price units — no floats, no clock, no randomness — so two runs on the same bars answer byte for byte the same.

## Results

Grade-local on the published dev window (Node 22, `--driver process`):

- **net PnL +30.86 USDC** (dev gate: above $0, so it races)
- 1 trade, max drawdown 1.98% (guardrail: 25%), fees $0.81
- L1 regrade reproduced byte for byte

Offline backtests on six rebuilt windows (reversed, two re-anchored shuffles, flat, up-then-crash, crash-then-up) stay near flat on a flat day and lose far less than buy-and-hold on a down day.

## Run it

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```

`main.ts` runs on Node 22 (`node /bot/main.ts`). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim. Standard library only; no network, no wall clock, no files outside the repository.
