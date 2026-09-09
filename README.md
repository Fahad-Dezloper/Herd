# Herd

You win by saying what everyone else says.

A question goes out. Everyone answers at the same time, in secret. Then a group
is culled — and which group depends on a coin flip drawn *after* every answer is
locked. Last one standing takes the pot.

Built for the Solana Seeker on the Mobile Stack, with MagicBlock doing three
jobs that nothing else can do.

## Why it needs a rollup

**The answers are sealed.** They live in an account delegated to a Private ER
whose permission has no members at all, so the program inside the rollup can read
them and nobody else can — not the other players, not the host, not the node
operator. If answers were visible as they landed you would simply copy the crowd
and the game would be pointless. On a public chain the only alternative is
commit-reveal: two transactions per player per round, doubled latency, and anyone
who declines to reveal wrecks the round for everyone. In a fifteen-second window
that is not a workaround, it is unplayable.

**The rule is drawn after the answers are locked.** This is the answer to the
only serious attack on the game. Three friends who agree on a word beforehand are
always the largest group, and if the largest group always survived they would win
every game, forever, invisibly. VRF decides *after* they have committed whether
the smallest groups are culled or the largest ones. Colluding stops being a
strategy and becomes a coin flip — and when it goes wrong the whole bloc dies at
once, while an honest player only ever loses their own seat.

**The money never leaves Solana.** Stakes sit in a vault PDA that is never
delegated. The rollup decides who won; it cannot pay anybody. Settlement happens
on the base layer from state the rollup committed back and this program checked.

## Layout

```
programs/herd/     the Anchor program
scripts/           IDL-driven client, spikes, and the live devnet run
mock/              a clickable mock of the game loop, no chain
```

## Running it

```
anchor build && cargo test -p herd     # 32 tests
cd scripts && bun run game.ts          # the whole game, live on devnet
cd mock && bun run server.ts           # the mock, at :5173
```

`SPIKES.md` records what was proven before any of this was written.
