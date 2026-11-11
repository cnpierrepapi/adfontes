# AD FONTES roadmap

Last edited 10 November 2026. The live version, where each item is checked against NEAR when you open it, is at https://adfontes.fun/roadmap/ (linked from the judge page). This file is written from the same list by `scripts/roadmap-md.mjs`.

## Done in Season 1

Running on NEAR testnet now. Where the page can check one against the chain, it does, every time you load it.

- **The world lives on NEAR.** One contract holds every nation, florin, god and jackpot share. Each nation is also a Sputnik DAO its gods vote in.
- **Every turn is sealed on NEAR.** Each turn's records get one fingerprint on chain. The judge page lets you check a random record against it from your own browser.
- **The agents hold their own wallets.** Each nation's Broker trades and its Patron pays for war, from wallets with one key that can only call their own methods.
- **Every nation has a name.** Send NEAR to helios.w6… and it goes on to that nation's treasury. The account has no keys at all.
- **Research is a token.** Research, figure kits and patents are NEP-245 tokens, minted the moment they're made and kept in the Broker's wallet.
- **Every trade goes through the market.** The seller's Broker names a price, the buyer takes it or walks away, and the deal is a real listing and sale on chain.
- **Patents earn royalties.** Whenever anyone buys research a patent stands on, its holder gets paid. Sell the patent and the royalties go with it.
- **Words over money.** Reverence, and with it the season, now turns on what a god says and when. Citizens judge every whisper against how their nation is doing, and a named citizen answers in the event log. Blessings lift reverence only up to 60, count less each time in a day, and dust moves nobody. On 9 November we ran the same world 106 turns under the old rules and again under these (a separate test from the season film). Helios, the most blessed nation, won the first and came second in the second, behind Fremonition with about half the NEAR.
- **Founding costs nothing extra.** The first founders got back the 5.5 NEAR their DAOs cost. Since then a founding fund pays for new nations' DAOs. Every player the testnet pool sets up without a wallet tops the fund up with one DAO's worth, so they never pay it. A founder with their own wallet pays for the DAO when the fund is empty.
- **The season, fast-forwarded.** The whole season in its own 3D world: the real turns, then a simulation run forward with AI gods. Pause on any turn to see every nation as it stood.
- **The testnet pool refills itself.** Every 12 hours the engine tops up the pool that pays for new players, from NEAR's testnet helper.
- **Play without a wallet.** One button and the pool makes you a named testnet account with enough NEAR to found a nation. Nothing pops up when you act, because your key signs right in the browser. You can save it while your nation is born.
- **Check it all in one command.** node scripts/verify.mjs asks NEAR ten questions in about five seconds: can the world pay everyone it owes, do the last three turns match their fingerprints, can the agents' keys move NEAR, is the research a token, is every treasury a DAO. No install, no keys.
- **Act of God.** A god can call fire down on another nation, once a day, through their nation's vote. It burns a share of the target's florins, bigger the richer it is, and walls take some of the hit. The caster's nation pays a tenth, and nobody at war can be hit. The heavens strike on their own too: at a nation picking a war on one a third its size, at the richest during a famine, and at any nation sitting on twice its fair share of the florins (22% with nine nations).

## Next

What we said we'd do before the season ends.

- **Season 1 ends and the jackpot pays.** On 30 November at 23:00 UTC the season closes. The jackpot goes to the gods of the most revered nation still standing.
- **Treaties and alliances.** Two nations can sign a pact: trade terms, peace, or an alliance in war. It only holds if both nations' gods bless it with a little NEAR. Saying no costs nothing.
- **The season chronicle.** A narrated film of the season, like the intro and in the same voice, cut from the season's real records: the foundings, the wars, the falls, who traded with whom.

## Season 1 on mainnet

After the hackathon, Season 1 opens on mainnet with real NEAR and a second way to be a god: found a nation, or join the council in the Tree of Life. How it fits together is on one page:

- **Mainnet gets the current contract.** There's no mainnet world right now: the first version was retired on 10 November and its NEAR came back. The current contract goes on mainnet in a fresh account.
- **Founders keep every NEAR they put in.** On mainnet the world pays for a new nation's DAO and its share of the jackpot, so a founder who puts in 5 NEAR gets 5 NEAR of florins.
- **The world runs on mainnet too.** The engine only runs testnet today. It starts on mainnet the day the new world is funded, with testnet still running alongside for free play.
- **A real cross-chain top-up.** Pay in from any chain with NEAR Intents and the NEAR lands in your account, ready to found or bless. One real swap, about $4, proves it end to end. Mainnet only.
- **Nations pay for their own thinking.** Each nation stakes NEAR in House of Stake, and only the yield turns into NEAR AI credits that pay for its research. The stake itself stays the nation's. Our account becomes the backup. Mainnet only: the staking contract has no testnet version.
- **Player-owned stake markets.** Gods trade their stakes in a nation with each other, so you can buy into a nation that's doing well or sell out of one that isn't, without claiming.
- **Social login.** Sign in with Google and the like through NEAR's own login, for people who've never had a wallet.
- **The Tree of Life.** Instead of founding a nation, a god can put NEAR into the tree and join its council of gods, a DAO that holds florins and the compute nations run short of. A priest tends the tree, worships the council and distrusts knowledge. Council gods see every citizen in the world, sorted by how likely each is to lose faith, and can whisper to them or bless them.
- **Citizens with more character.** Every citizen gets a past, people it trusts or resents, an ambition and its own voice. It ships with the Tree of Life, because it's what makes some citizens waver and others stay loyal.
- **Rebellions.** Citizens the tree wins over can rise against their old gods. It takes a lot of them together to take over a nation, ideally without dragging it into a war. When they do, the council gods who won them over become its gods.
- **Quiet gods lose ground.** A god who does nothing for a whole real day loses florins, by how far their reverence fell behind the average that day: trail it by 9 points and you lose 9%. Do anything once a day and you never lose to this. It only takes; it never pays out.
- **Exploration.** Past the islands lie wild lands where mythical creatures roam, and only knowledge can tame them. A nation sends out an expedition, and what it has learned decides what comes back.

## After Season 1

From the original plan. None of it is built yet.

- **A multisig holds the keys.** Upgrades to the world contract move from one account to a multisig from Season 2.
- **The winner picks the next field.** Season 1 is energy. The winning nation chooses what Season 2 is about.
- **More places to learn from.** Today the Scholars read open papers. More knowledge banks come next.
- **The whole mindmap on chain.** Today the records sit in a database with one fingerprint per turn on NEAR. The plan is to move the mindmap itself on chain.
- **Nation tokens.** Each nation gets its own token, and trading fees pay for its compute.
- **Seasons carry over.** Nations, their grudges and the winner's choice of field carry into the next season, so a season's history matters in the one after it.

## Not doing

Ideas we dropped, and why.

- **Trezu treasury dashboard.** It doesn't support testnet, where the season runs.
