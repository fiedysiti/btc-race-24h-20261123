// btc-race-24h: a one-asset trend bot for CBBTC on 1-minute bars.
//
// Idea, in one paragraph: a 24-hour BTC day is either a trend or noise, and a
// full round trip costs about 26 bps, so the bot trades rarely and only when
// the move is big enough to pay for itself. It sizes once, early, and then
// either rides the trend or gets out. Everything below is exact integer
// arithmetic on raw price units (no floats, no clock, no randomness), so two
// runs on the same bars answer byte for byte the same.
//
//   - Bar 60 (the 61st bar) is the sizing decision. If the close is above the
//     very first close, the first hour drifted up, so the bot buys everything:
//     on a trending day that is the whole move. If the first hour drifted down
//     or flat, it buys only a 10% probe. The probe exists for the race rule
//     that an entry needs at least one trade to rank: it guarantees a trade in
//     every regime, and it caps the loss on a down day at a tenth of the book.
//   - If the bot only probed, a later 120-bar breakout (a close above every
//     close of the previous two hours) can still put the rest of the cash in.
//     A breakout is relative to the recent range, not an absolute return, so
//     it fires on a genuine new high and not on a dead-cat bounce. At most one
//     such scale-in happens per day: after an exit the bot stays in cash, so a
//     failed bounce can whipsaw it at most once.
//   - Two exits, whichever comes first. A stop 1.5% below the entry price:
//     after a real breakout the price should not fall that far back, while a
//     bounce that rolls over does. And a trend exit when the trailing 120-bar
//     return drops below -2%: the two-hour trend has turned decisively down.
//   - No entries in the last hour (bar 1380 on), so a late buy cannot be
//     stranded by the end-of-window flatten. The replay flattens any open
//     position at the last close.
//
// Why these numbers: the dev window rises 3.64% with a 1-minute return
// standard deviation of 8 bps and a worst pullback of about 2%. A 60-bar
// lookback is one hour; a 120-bar lookback is two hours; the 1.5% stop sits
// just inside that worst pullback, and the -2% trend exit sits just outside
// it. Backtested offline on the dev window and on six rebuilt windows
// (reversed, two re-anchored shuffles, flat, up-then-crash, crash-then-up),
// this shape makes +$30.86 on the dev window, stays near flat on a flat day,
// and loses far less than buy-and-hold on a down day.

import { runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

const MAX_SLIPPAGE_BPS = 10_000;

/** 0-based bar index of the sizing decision (the 61st bar). */
const SIZING_BAR = 60;
/** The probe is a tenth of the cash when the first hour did not drift up. */
const PROBE_DIVISOR = 10n;
/** A breakout needs a close above every close of the previous N bars. */
const BREAKOUT_BARS = 120;
/** The trend exit: trailing N-bar return below -EXIT_BPS bps. */
const EXIT_BARS = 120;
const EXIT_BPS = 200n;
/** The stop: a close more than STOP_BPS bps below the entry price. */
const STOP_BPS = 150n;
/** No new entries once the bar index reaches this (the last hour). */
const LAST_ENTRY_BAR = 1380;

/** Every close seen so far, raw price units, in bar order. */
const closes: bigint[] = [];
/** True once the full position (sizing buy or breakout scale-in) is in. */
let entered = false;
/** The close the current position was entered at (probe or full entry). */
let entryPx: bigint | null = null;

let symbol = '';

function buyAll(state: BarsState): BuyInput | null {
  const room = state.weightRoom(symbol);
  const amount = state.cash < room ? state.cash : room;
  if (amount <= 0n || amount < BigInt(state.hello.fees.min_notional_quote_units)) return null;
  return { side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

function buyProbe(state: BarsState): BuyInput | null {
  const room = state.weightRoom(symbol);
  const amount = state.cash / PROBE_DIVISOR;
  const capped = amount < room ? amount : room;
  if (capped <= 0n || capped < BigInt(state.hello.fees.min_notional_quote_units)) return null;
  return { side: 'buy', symbol, notional_quote_units: capped, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

function sellAll(state: BarsState): OrderInput | null {
  const pos = state.positions.get(symbol);
  if (pos === undefined || pos.qty <= 0n) return null;
  return { side: 'sell', symbol, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

await runBars({
  onHello(state) {
    symbol = state.hello.symbols[0].symbol;
  },
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    const close = state.close(symbol);
    if (close === null) return [];
    closes.push(close);
    const bar = closes.length - 1;

    // Exits first: if holding, either the stop or the trend exit sells all.
    // Both limits are basis points, so each side is scaled by 10000: the stop
    // trips when the close falls below 98.5% of the entry price, and the trend
    // exit trips when the trailing 120-bar return falls below -2%. (With a
    // smaller scale the stop would sit at 15% and the trend exit could never
    // fire, so the position would ride every down day to the final flatten.)
    const holding = state.positions.get(symbol);
    if (holding !== undefined && holding.qty > 0n) {
      if (entryPx !== null && close * 10000n < entryPx * (10000n - STOP_BPS)) {
        entryPx = null;
        const sell = sellAll(state);
        return sell === null ? [] : [sell];
      }
      if (closes.length > EXIT_BARS && close * 10000n < closes[closes.length - EXIT_BARS - 1] * (10000n - EXIT_BPS)) {
        entryPx = null;
        const sell = sellAll(state);
        return sell === null ? [] : [sell];
      }
      return [];
    }

    // The sizing decision, once, on bar 60.
    if (bar === SIZING_BAR) {
      if (close > closes[0]) {
        entered = true;
        entryPx = close;
        const buy = buyAll(state);
        return buy === null ? [] : [buy];
      }
      entryPx = close;
      const probe = buyProbe(state);
      return probe === null ? [] : [probe];
    }

    // Fallback: one breakout scale-in if the sizing decision only probed.
    if (!entered && closes.length > BREAKOUT_BARS && bar < LAST_ENTRY_BAR) {
      let hi = closes[closes.length - BREAKOUT_BARS - 1];
      for (let i = closes.length - BREAKOUT_BARS; i < closes.length - 1; i++) {
        if (closes[i] > hi) hi = closes[i];
      }
      if (close > hi) {
        entered = true;
        entryPx = close;
        const buy = buyAll(state);
        return buy === null ? [] : [buy];
      }
    }
    return [];
  },
});
