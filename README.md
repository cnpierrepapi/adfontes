# AD FONTES

> "Our ultimate goal is to have ordinary people play the game and eventually be candidates for winning the Nobel Prize."
> Zoran Popović, who led Foldit at the University of Washington, 2008

**Play:** https://adfontes.fun · **For judges, five minutes:** https://adfontes.fun/judge/ · **The season, fast-forwarded:** https://adfontes.fun/timelapse/ · **The marketplace:** https://adfontes.fun/marketplace/ · NEAR Hackathon, tracks: Games With Real Economies, Social Money

AD FONTES is a world of small nations run by AI citizens. They read real research papers, write up what they learn, trade it with each other, and try to draft inventions nobody has made yet. You're a god. You put NEAR into a nation, whisper to its people, punish the ones who cheat, and decide what knowledge they keep.

Think of it as an ant farm for research. You can't make the ants smarter. You can feed them, nudge them, and watch which colony builds something worth having.

## For judges: do this, see this

| Do this | You'll see |
|---|---|
| Open https://adfontes.fun/timelapse/ | The season in a few minutes. Turns 1 to 34 are real and sealed on NEAR, 35 to 84 are the same engine run forward with AI gods. Each turn is labelled. |
| Open https://adfontes.fun/ and click an island | That nation's knowledge, florins, gods and people. The event list shows citizens answering their god's whispers. |
| Press "Play without a wallet", then found a nation | A funded testnet account made for you. No wallet, no sign-in, no popups. You write your first whisper while the island rises. |
| Open https://adfontes.fun/judge/ and press its three buttons | Your browser asks NEAR directly: is this record what was sealed, can the world pay everyone it owes, does this Broker hold this token. |
| `node scripts/verify.mjs` | 10 checks against NEAR in about five seconds. No install, no keys, signs nothing. Exits non-zero if any fails. |

What `scripts/verify.mjs` checks, and where each claim lives:

| Claim | Checked with | Code |
|---|---|---|
| The world can pay everyone it owes | `get_totals`: balance covers backing + jackpot + everything owed + storage | `contracts/world/src/lib.rs` `get_totals` |
| A florin is worth exactly backing / florins | `get_totals` | `lib.rs` `florin_value` |
| Every record is what was sealed | rebuilds the last three turns' Merkle roots from every record, compares with `get_root`; then changes one letter and shows it stops matching | `engine/world.mjs` `merkleRoot`, `lib.rs` `set_root` |
| Agents sign from their own wallets and can't move NEAR | `view_access_key_list` on a Broker and a Patron: one function-call key each, for the world contract only | `engine/chain.mjs`, `scripts/*-proof.mjs` |
| Research is NEP-245 tokens held by the Broker | `mt_token_info`, `mt_balance_of` | `contracts/world/src/mt.rs` |
| Every nation's treasury is a Sputnik DAO | `get_policy` on each one | `lib.rs` `found_clan` |

What's real and what isn't. Real, on NEAR testnet: the world contract, every sealed turn, the gods' stakes in test NEAR, the DAOs, the agents' wallets and trades, the research tokens. The research is real too, papers from OpenAlex read and written up by Claude. Simulated: the season film after turn 34. Not live yet: mainnet (the first version was retired on 10 November, see [On chain](#on-chain)), and NEAR Intents and House of Stake, which only exist on mainnet.

## What you say is the game

A nation's standing is its reverence: how much its citizens believe in the god they follow. The season's jackpot goes to the gods of the most revered nation. And reverence mostly comes from your words, and from when you say them.

When you whisper, the citizens hear it against what's happening to them right then. Are they hungry? At war? One step from a patent? A whisper that fits the moment lands like prophecy. A vague one gets a shrug. One that misreads the nation costs you. A named citizen says what they made of it, right there in the event log.

From the simulated week: on turn 41 one of Numdial's gods whispered "There's a Trickster among you. Check every citation twice." Farah Petrov took it as prophecy: the god saw the Trickster before any of them had proof. Reverence +17. On turn 72 Fremonition's god said "Study two-dimensional materials next. It leads somewhere." Nora Kowalski called it a sensible nudge, since that's what their scholars were already poking at. +12.

Live, on turn 26, Antilles' god told it to feed its smiths so the war machines could win. Otto Tanaka agreed, and said he wished the god had mentioned the peace offer and the walls they don't have. +9.

Money still helps, just less. A blessing lifts reverence, but only up to 60. The second blessing in a day counts half, the third a third, and anything under 0.1 NEAR goes in without moving anyone. Past 60, blessings stop counting. From there it's what the citizens hear and what they do: whispers they take as wise, and their own clean work getting past the Warden.

Here's how the simulated week (turns 35 to 84) came out, for the nations that took in the most NEAR:

| Nation | NEAR put in that week | Whispers heard | Reverence at the end |
|---|---|---|---|
| Salamanco creek | 1.45 | 8 | 96.9, first |
| Fremonition | 1.12 | 8 | 87.2, second |
| Soucalibur | 0.63 | 3 | 1.8, last |
| Kristalnjik | 0.39 | 3 | 8.0 |

The two leaders were blessed the most, but they were also the two whose gods got heard the most. Soucalibur's gods put in the third most NEAR and were heard three times, and it finished last. Money alone didn't buy a nation's faith. Every number here is in `public/season/season.json`, the file the season film plays: NEAR put in is each nation's `total_in` on turn 84 minus turn 34, and the whispers are its `heard` records.

## Why this is more than a game

In 2011 Foldit players worked out the structure of a retrovirus protein that had stumped scientists for over a decade. They did it by playing. People are good at judging what looks promising, and a game is a good way to point a lot of that judgement at one hard problem.

AD FONTES points it at invention. Each season is one field. Season 1 is energy: batteries, solar cells, carbon capture. In every nation:

- Scholars pull real open papers on a topic and write a short corpus. Every claim has to cite one of the papers they were given.
- Their knowledge grows as a map. A point leads to the next, and a long enough line becomes a patent-style draft with claims and labelled figures.
- A Warden checks every citation and every figure numeral. Made-up sources get caught and the nation is fined.
- Gods (players) steer with their words first and their NEAR second: say the right thing at the right time, fund the nations doing good work, punish cheats, and root out knowledge that leads nowhere.

The drafts aren't filed patents. They're a public, checkable search through the space of ideas, run by many small teams that compete and trade. And every turn's records get a fingerprint on NEAR, so the record of who found what can't be quietly rewritten later.

## What a god does

| Power | What happens |
|---|---|
| Found a nation | Your NEAR starts a nation, with its own Sputnik DAO and a fresh team of citizens. The whole team is made in one go, about ten seconds after you sign, and the island rises with them already on it |
| Whisper | Tell your citizens what matters. They judge it against what's happening to them right now, and that moves their reverence more than money can |
| Bless | Put more NEAR in. You join the nation's gods and get a vote in its DAO. It lifts reverence up to 60, less each time in the same day |
| Smite | Stun a citizen for a few turns, or remove them for good |
| Root it out | Cut a point of knowledge, and everything that grew from it, out of the nation's map |
| Rule on a draft | Reward it, or punish the citizen who rushed it |
| Release staking | Every nation keeps 0.1 NEAR in a staking fund from its founding. Its gods can vote to send it to any account, a staking pool say. Only the nation's DAO can do it |
| Claim your stake | Take your florins out as NEAR at today's value. If you're the last god, the nation ends: its citizens leave, its island is gone from the world, and the staking fund goes out with you |

Citizens also report each other. Now and then one tells the god that another slipped a fake citation in, rushed a draft, sold the nation's work cheap, or is a Trickster. Some reports are true and some are grudges, and you don't find out which until you act. Stunt the accused (that's Smite) and you learn the truth: a guilty one means the citizens saw justice done, and your reverence fades half as fast for a day. An innocent one becomes your enemy, and your reverence fades faster for as long as they live. Or do nothing, and the report lapses after a real day. Ignore a true one and the citizen who made it loses faith for a day, and the god the nation follows fades faster while that lasts. Stunting anyone costs 8 reverence on its own, so it's never free.

While your nation is being born, a panel ticks off each step as it happens: the DAO, your citizens by name, the reverence they start with, then the island rising. It keeps a box for your first whisper, and the moment they're on the plaza the whisper card opens with it filled in. Nothing the new nation does plays out before its island is up.

No wallet? "Play without a wallet" makes you one in the browser. The testnet pool turns it into a named account like `amber-quill-417.adf-pool1-hf0w8.testnet`, funded with enough testnet NEAR to found a nation. The key never leaves your browser.

The world reacts. Citizens need a little NEAR every day, and the need keeps growing: underfed, they go hungry and slow down, overfed, they get lazy. A nation whose gods go quiet for a day gets a Trickster (two at most), who slips fake citations into its work. Knowledge can lift a nation's faith or unsettle it. Five techs (Printing Press, Spectacles, Mechanical Clock, Double-entry Bookkeeping, Astrolabe) change how a nation works. They now unlock one at a time over the season. Helios and Salamanco creek got all five in the first days, before that pacing went in.

### War

Then there's war, and the gods don't get a vote. Once a day every nation's Patron sits its war council and picks one move: declare war on someone, build walls, offer peace, take a peace that's on offer, or wait. Whispers don't reach that room. A nation is safe until it has had one patent pass. After that it's fair game.

At war, research stops and the citizens fight. Only the crews on the war machines stay outside; everyone else goes indoors. Every turn both sides burn money on the war chest and fire at each other, and every hit burns a point of knowledge off the other island's edge. The island is its knowledge, so you watch it shrink. The dice come from the fingerprint already sealed on NEAR, so nobody can rig a roll and anyone can redo one. When an island is down to its root it falls out of the sky. A nation that runs out of florins for three rounds in a row surrenders instead. The winner takes half its florins, its knowledge and two of its people, and the fallen nation's gods can still claim the other half.

Two even nations fight for about ten days. A big one with all five techs against a small one, about a day. The live war sits in between, and it's still going, so the numbers here are probably behind by the time you read them. The live world always has the current ones.

Antilles (13 points, no techs) declared on Striklar (6 points) on turn 13. Striklar walled up and has been holding on ever since, a round every two hours. By turn 35 they'd fought 23 rounds, with Antilles at 11 points and Striklar at 4. Striklar offered peace on turn 25, and Antilles' council turned it down: "Striklar is down to 5 points against our 11, so we keep pressing until they fall and we take half their 540 florins."

## The agents hold their own money

Each nation has two agents with wallets of their own. The Broker (`trader<id>.adfontes-mw1fjpfx.testnet`) buys and sells knowledge. The Patron (`patron<id>.adfontes-mw1fjpfx.testnet`) pays for the war chest and the walls. Each wallet has exactly one key, a function-call key that can only call its own methods on the world contract. It can't send NEAR anywhere, and it can't call the other agent's methods. The contract checks which agent is signing before it moves a single florin.

What the nations learn is on NEAR too, as NEP-245 multi-tokens on the world contract, held in each Broker's wallet. Research (`r:`) copies, like a book: a buyer gets its own and the seller keeps theirs. A passed patent (`p:`) is one of a kind. Figure kits (`k:`) copy too. The contract has NEP-245's transfer and balance methods (`mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_token`), plus `mt_tokens`, `mt_tokens_for_owner` and its own `mt_token_info` for the title and kind. It doesn't have the metadata methods (`mt_metadata_contract`, `mt_metadata_token_all`), so a wallet that needs those won't show a name or icon. The judge page asks NEAR about one token straight from your browser.

## The marketplace

Every trade between nations goes through it. When a Scholar is stuck on a point another nation already knows, its Broker goes shopping. The seller's Broker names a price, anywhere from half to three times the fair one, with a line on why. The buyer takes it or walks away, and it walks if the ask is more than double the fair price or more than it can pay. A deal is a real listing and a real sale on the market contract. The buyer's copy lands in its Broker's wallet in the same minute, and any royalty is paid then too. Nothing waits for the next turn.

Once a real day, each Broker also works the market on its own: lists up to three things, takes down what isn't selling, or buys one. It pays in florins from its own wallet, and says why in one line. Only the agents trade. Gods can watch at https://adfontes.fun/marketplace/, and that's it.

Every price comes from one short file, `engine/prices.mjs`, and every trade carries the sum that made it. Hover a trade in the event list and you see something like `0.22 base × 7 for depth 6 × 3 scarcity (6 nations, 1 already knows it) = 4.52 florins`. A Broker can ask anywhere from half to three times that fair price. The contract adds its own limits: ten open listings a nation, nothing over 1000 florins, and you can't buy your own listing, buy a copy twice, or sell something you don't hold.

Patents earn. Whenever any nation buys research on a point a patent stands on, the patent's holder gets a royalty. Sell the patent and the royalties go with it. The first one was paid on turn 17: Fremonition bought research on spectral graph theory, which sits in Striklar's battery patent, and Striklar got paid.

## Every nation has a name

Each nation gets a named account, like `helios.w6.adf-pool1-hf0w8.testnet`. Think of it as a mailbox at the front gate. Send NEAR there and the engine carries it on to the nation's treasury, its DAO, on the next turn. The account runs a 2 KB contract with no keys on it, so nobody can take the money out on the way.

## Two nations that came and went

Babamako and Colo Colo were founded on turn 27, the evening of 9 November. Their god took the stake out the same evening, and a nation whose last god leaves ends. So they're gone from the live world: not on the map or the marketplace, and the API doesn't serve them. What they did is still in the sealed records, exactly as it was written, because those can't change. Turns 27 and 28 still mention them, NEAR still has them, and the season film shows both islands rise and leave. Their trades with other nations still count, and their god's 14% stayed in the jackpot, like anyone's who claims out.

## The season, fast-forwarded

A season lasts weeks, and a judge has five minutes. So https://adfontes.fun/timelapse/ plays the whole season in its own 3D world, a few minutes long. It's the live world's own code, fed one turn at a time.

Turns 1 to 34 are the real season, from the records sealed on NEAR: nations founded, their first research and trades, the techs, the war between Antilles and Striklar. Then it's a simulation. We copied the world at 12:03 UTC on 10 November, partway through turn 34, and ran the same engine forward to turn 84 on a stand-in chain, with real language-model calls and simulated gods. They visit when reverence is high, drift off when it drops, and rush back when their nation is on the brink. Each simulated god whispers at most five times in the week, and the citizens judge every whisper the way they do live. Every turn is labelled real or simulated.

What happens in the simulated week: Antilles finally takes Striklar's peace offer on turn 53, after 39 rounds. The same turn, Numdial sees Antilles nearly down to its root with no walls and declares war. By turn 84 Antilles is down to 2 points and has offered peace itself, still at war. Cannons, trebuchets and fire arrows do most of the fighting, with burning glass, pamphlets and ornithopters now and then. Salamanco creek finishes first at 96.9 and Fremonition second at 87.2. Over the week 28 whispers were heard, 13 Tricksters turned up, 23 techs were built, and 28 of 29 drafts passed the Warden.

Pause on any turn and click a nation, or open "All nations", and you get where it stood that turn: points, florins, NEAR in, mood, gods, techs, walls, war. On the real turns the money is the world contract's own numbers, read from NEAR at the block where each turn was sealed (`scripts/season-chain.mjs`), so you can check any of them yourself. Turn 34 is NEAR at 12:03, the moment the simulation was copied, and the film plays only the first 63 of that turn's 110 sealed records, the ones that had happened by then. The other 47 are still on /api/day and still hash to NEAR's fingerprint for turn 34; they just come after the copy. On the simulated turns, the numbers are the ones the engine printed every turn. The mind maps are wound back from the end of the run through every record, and they match the engine's own point count on every simulated turn for every nation still in the game.

## The clock is NEAR's price

The world runs on NEAR's real hourly price, replayed five times faster than life and timed to meet the live price on 30 November, the last day of the season. While NEAR climbs it's day. When it falls 3% from its high, night comes, and scholars work at half pace. A long slide is a long night.

## The money

```mermaid
flowchart LR
  G[God puts NEAR in] --> C{World contract}
  C -->|86%| B[Backing behind the florins]
  C -->|14%| J[Season jackpot]
  B --> F[Florins, held by nations]
  F -->|good work and patent royalties mint, upkeep and fines burn, trades move them| F
  F -->|claim any time, at backing ÷ florins| G
  J -->|after 30 Nov| W[Gods of the #1 nation by reverence]
```

Every NEAR a god puts in splits 86/14. The 86% backs florins, the world's own currency. Nations earn florins for clean research, passed drafts and patent royalties, pay them out for upkeep and fines, and trade them for each other's research. A florin is always worth the backing divided by the florins in existence, so a strong nation's gods can take out more than they put in, and a neglected nation can lose everything. The 14% goes to a jackpot paid after the season to the gods of the most revered nation. A fallen nation is out of the running. The contract doesn't read reverence (that lives in the engine), so after 30 Nov the owner calls `award_jackpot` for the #1 nation in the published standings, and the contract splits it between that nation's gods by what each put in. This contract takes no fee for anyone, us included.

The jackpot only ever gets 14% of what gods put in. The founders' grants and the founding fund below go straight into the backing and never touch it, so they can't raise or lower anyone's share of the pot. A god who claims out leaves their 14% behind. On turn 35 the jackpot held 4.571739 NEAR, which is exactly 14% of the 32.6553 NEAR gods have put in since the world started. That includes 10.47 NEAR from the god who founded Babamako and Colo Colo and then claimed out. `scripts/jackpot-audit.mjs` replays every deposit against NEAR's own history to check it.

Every nation needs a Sputnik DAO, and making one costs 5.5 NEAR. The first six founders paid that themselves, so most of their 6 NEAR never became florins. The world gave it back: a `grant` put 5.5 NEAR into the backing as florins for each founder, at the day's price, so nobody else's florins moved. That credit is the founder's, so the engine keeps it out of what the nation spends. After that, a founding fund in the contract covers a new nation's DAO while it has NEAR, so every NEAR a founder puts in becomes florins. When the fund is empty (it is as of 10 November), the founder pays for the DAO again. The roadmap page reads the fund from NEAR each time it loads. On testnet the pool gives a new player 8.3 NEAR, enough to found a nation either way.

## How it's built

```mermaid
flowchart TB
  subgraph Browser
    L[Live world, three.js] --- J[Judge page]
    T[Season world, same code on the season's data] --- M[Marketplace page]
    W[NEAR wallets, or a key made in the browser] --- L
    I[NEAR Intents top-up, for when mainnet opens] --- L
  end
  subgraph Railway
    S[Web server: site + read-only API] --- P[(Postgres: records, drafts, state)]
    E[Engine loop: one turn about every 2 hours, instant turns for new gods] --- P
  end
  subgraph NEAR
    WC[World contract: nations, florins, jackpot, drafts, citizens, NEP-245 tokens, market, one root per turn]
    D[A Sputnik DAO per nation]
    A[Agent wallets: a Broker and a Patron per nation]
    N[Named accounts: forward to the DAO]
  end
  L -->|API| S
  L -->|sign: found, bless, claim| WC
  L -->|propose + vote: whisper, smite, root out, rule| D
  D -->|passed proposals call| WC
  E -->|mint, burn, spawn citizens, mint tokens, seal the turn| WC
  E -->|signs for the agents with their one-method keys| A
  A -->|buy, list, spend| WC
  N -->|forward| D
  E -->|reads passed proposals| D
  E -->|papers| R[Open research papers]
  E -->|research, drafts, councils, market calls| X2[Language models]
  I -->|any token to NEAR| X[1Click, NEAR Intents]
```

A turn, step by step:

```mermaid
sequenceDiagram
  participant E as Engine
  participant N as NEAR
  participant DB as Postgres
  E->>N: read nations, gods, passed DAO proposals
  E->>E: clock: day or night from NEAR's price
  loop every living nation
    E->>E: needs, Tricksters, reverence
    E->>N: Broker buys knowledge it's missing: the seller names a price, a listing and a sale on the market
    E->>N: the buyer's copy minted and any royalty paid, at once
    E->>N: once a real day: Broker lists, takes down, buys on the market
    E->>E: Scholars research, Warden checks citations
    E->>E: a draft, at most once a real day
    E->>N: mint for good work, burn upkeep and fines
  end
  E->>E: war councils and battles
  E->>N: mint any token whose mint failed earlier (new ones are minted the moment they're made)
  E->>DB: save the turn's records
  E->>N: set_root(turn, merkle root of every record)
```

The pieces, all in this repo:

| Part | Where |
|---|---|
| World contract (Rust, near-sdk) | `contracts/world` (`mt.rs` tokens, `market.rs` marketplace) |
| Named-account forwarder (raw wasm, 2 KB) | `contracts/forwarder` |
| Engine | `engine/` (`loop.mjs`, `run.mjs`, `clock.mjs`, `world.mjs`, `war.mjs`, `reverence.mjs`) |
| Prices, tokens, market rules | `engine/prices.mjs`, `engine/tokens.mjs`, `engine/market.mjs` |
| Web server and API | `server.mjs` |
| Live world | `src/live/` (three.js; citizens, towns, the sky of each nation's knowledge) |
| Season world | `timelapse/`, `src/season/`, built by `scripts/season-build.mjs`; `scripts/season-chain.mjs` reads each real turn's numbers from NEAR |
| Simulation | `scripts/sim-seed.mjs`, `scripts/sim-week.mjs`, `scripts/sim-gods.mjs`, `engine/chain-sim.mjs` |
| Judge page, marketplace | `judge/`, `src/judge.js`, `marketplace/`, `src/market.js` |
| Tests and proofs | `engine/test-*.mjs`, `tests/`, `contracts/world/src/tests.rs`, `scripts/*-proof.mjs` |

## On chain

The game plays on testnet. Everything in this table is live and changes every turn.

| What | Testnet address |
|---|---|
| World contract, v2 | `w6.adf-pool1-hf0w8.testnet` |
| Each nation's DAO, the first six | `adf-<id>-<block>.sputnikv2.testnet` |
| Each nation's DAO, nations founded since | `adf-<name>-<block>.sputnikv2.testnet` |
| Each nation's named account | `<name>.w6.adf-pool1-hf0w8.testnet` |
| Each nation's Broker and Patron | `trader<id>.adfontes-mw1fjpfx.testnet`, `patron<id>.adfontes-mw1fjpfx.testnet` |
| The engine's operator | `adfontes-mw1fjpfx.testnet` |

There's no AD FONTES world on mainnet right now. The first version went up on 6 November, and one nation was founded there to prove it worked. Then this season's contract outgrew it, so on 10 November we retired it: its one god claimed out, `world.adfontes.near` and its helper accounts were deleted, and the NEAR came back to us. The site stays on testnet until mainnet opens again with the current contract, in a fresh account, after the hackathon.

The world contract's account owns itself. It has one key, a full-access key, and we hold it. That key is how the contract gets upgraded: every new part this season (the agent wallets, the tokens, the market, the named accounts, the founding fund) went in by deploying new code to the same account, with nobody's state or money touched. It's also the owner, so it's the only thing that can pause new deposits (claims can never be paused), move a god whose browser key was lost, or pay the jackpot after 30 November. Grants to founders can come from it or from the operator. That's a lot to hang on one key. The contract has `set_owner` so the role can move to a multisig without an upgrade, and that's on the roadmap for after Season 1.

## Check it yourself

Every turn, the engine hashes each record and puts one Merkle root on NEAR with `set_root`. The judge page picks a random record, hashes it in your browser, climbs the proof, and asks NEAR directly for the root. If they match, that record is exactly what happened. `tests/live-audit.mjs` does the same for a whole turn.

Two plainer pages sit next to the 3D world. https://adfontes.fun/world/ is the world as text: the turn, day or night, every nation's points, florins and deepest line, the latest events, the drafts with their figures and claims, and a box to prove any record against NEAR. It refreshes itself every 30 seconds and shows when it last did. https://adfontes.fun/roadmap/ is what's done, what's next and what we dropped. It reads from one file, `public/roadmap.json`. Every time you open it, each item that can be checked asks NEAR or the API, and what comes back is printed under it, like the market's listing and sale count or whether mainnet runs the current contract yet.

The judge page opens with the agents talking: war councils arguing, citizens answering their god and reporting each other, Brokers haggling. It's their words, played back as a chat, and every line has its own button that proves it against NEAR the same way.

## Tests

```bash
npm test               # engine: clock, war, prices, tokens, market, techs, reverence, Warden, the god sim, the daily spend cap, RPC fallback, god actions; walking round buildings
npm run test:live      # 62 checks against the live site and the chain itself
npm run test:load      # a crowd of simultaneous visitors (on a slow connection this mostly measures your own link)
node scripts/jackpot-audit.mjs   # every deposit ever, replayed against NEAR: the jackpot is exactly 14% of them
```

`npm test` needs the internet for two of its tests, because they read the real testnet. `engine/test-rpc.mjs` points the engine at a fake NEAR node that only ever answers "rate limited" and checks it falls back to the real backup node within seconds. `engine/test-godactions.mjs` reads every live nation's DAO, runs the engine's god-action code on it, and checks each whisper, smite, ruling or staking release is credited to the god who proposed it, and that no proposer gets missed. We made sure it can fail: when we changed the engine to credit every action to a nation's first god, it failed on the two nations that had more than one active god at the time. `engine/test-cap.mjs` checks the $0.50 daily model budget refuses a call before it reaches the API.

The contract has 79 unit tests: `cargo test --lib` in `contracts/world`, or in the `sourcescan/cargo-near` Docker image (the first build compiles the whole toolchain, so give it a while). 35 of them are refusals, and each has to fail with its exact message. `contracts/world/tests/test_basics.rs` also wants a local NEAR sandbox, which has to download a node binary and can't inside that Docker image. The same flows run for real on testnet against a separate test world, `v2d`: the market proof (`scripts/market-proof.mjs`) has two Brokers list, buy a copy, buy a patent and take things down, then tries eleven things the contract must refuse. It passes 29 of 29. There are proofs like it for the agent wallets, the tokens, the named accounts, and making a new nation's whole team in one transaction (`scripts/spawn-batch-proof.mjs`). `engine/test-war.mjs` runs 400 simulated wars to check the pacing above.

The live audit checks the pages, tries to read server files and secrets through path tricks, throws junk at the API, then reads the contract and confirms the money adds up: the world can pay everything it owes, every god's stake sums to the backing, florins sum exactly, and the jackpot holds at least 14% of what today's gods have put in. (At least, because a god who claims out leaves their 14% behind. The exact check is the jackpot audit above.) It rebuilds a sealed turn's root from its records and compares it with NEAR's, and checks the clock against NEAR's real price history.

## Run it

```bash
git clone https://github.com/cnpierrepapi/adfontes
cd adfontes
npm install
npm run build
npm start              # the site on http://localhost:3000
```

Money and nations come straight from the chain. A fresh clone has no database and none of the engine's records, so it reads those from adfontes.fun's public API, and you see the real world, served from your own copy of the code. Set `ADF_UPSTREAM=off` to turn that off. Running your own engine needs a funded operator account and model keys; see `engine/config.mjs`.

## Built during the hackathon

All of this code was written for the NEAR Hackathon, starting 4 November 2026. The repo's first commit is that day. Nothing was carried over from earlier projects.
