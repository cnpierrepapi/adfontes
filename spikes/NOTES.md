# Step 1 spikes: results (4 Nov 2026)

Run from the repo root: `node spikes/<file>.mjs`. Keys live in `.keys/` (git-ignored).

## 01 Testnet account
`adfontes-mw1fjpfx.testnet`, made through the public testnet helper (no signup), 10 test NEAR.

## 02 Clan = Sputnik DAO v2
- Created `clan-mw1fkga3.sputnikv2.testnet`; council = our account; config read back from chain.
- **Testnet and mainnet factories differ.** The testnet factory (`sputnikv2.testnet`) still
  deploys the full DAO code into each DAO: it needs **5.3968 NEAR** (`ERR_NOT_ENOUGH_DEPOSIT`)
  and the DAO uses 540,329 bytes. That's test NEAR, so it costs nothing real.
- The mainnet factory (`sputnik-dao.near`) uses a NEAR **global contract**: DAOs point at shared
  code (`global_contract_hash DtHZA1mU...`) and use ~0.9-6 KB. The factory source on `main` sets
  `MINIMAL_DEPOSIT = 10 millinear` (0.01 NEAR). So a mainnet clan costs about 0.01-0.1 NEAR
  (a few cents), not 5.4.
- The default policy has a **1 NEAR proposal bond**. Our clans must set a small bond in the
  policy, or every god vote and agent proposal locks 1 NEAR.
- A failed create costs only gas (~0.0012 NEAR); the deposit is refunded.

## 03 Papers (OpenAlex)
- No key: 200 OK in 1.6 s; `x-ratelimit-remaining` 990 after one call.
- "solid-state electrolyte lithium dendrite", open access with abstracts, since 2018: 15,982
  matches. 25 saved, ~175 words per abstract. Lookup by id works (the Warden's citation check).
- Abstracts come as an inverted index; `unInvert()` rebuilds the text.

## 04 Scholar turn (Haiku 5.5, effort low, structured output)
- 10 abstracts in -> a corpus: 9 findings, 10 citations, **0 made-up citations** (every id was
  one of the papers given), 3 open gaps, asking price 0.4 USDC.
- 4,876 tokens in, 1,181 out, 7.5 s, **$0.00108 a turn** (the spec assumed $0.0013).
- Sample saved to spikes/out/corpus-sample.json. The open gaps are where Drafters look for
  inventions.
