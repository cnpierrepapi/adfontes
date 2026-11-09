//! AD FONTES world contract, v2 (SPEC §14).
//!
//! Every NEAR a god puts in (after founding costs) splits 86/14:
//! - 86% goes into the BACKING, the NEAR behind the florin, the world's internal token.
//!   The god's nation gets florins at the current florin price, and the god gets SHARES of
//!   their nation's florins (so a late god buys in at today's price, never at earlier gods' cost).
//! - 14% goes into the JACKPOT, paid after the season ends to the winning nation's gods,
//!   split by what each put in.
//! 1 florin is worth backing / florins. The world operator (the engine) mints florins for good
//! work (at most MINT_MAX per call), burns them for upkeep and Warden fines, and moves them
//! between nations for trades. A god can claim (withdraw) their florins as NEAR at any time.
//! There is no floor: a nation's florins can fall to nothing. We take no fee.
//! Liabilities = backing + jackpot + staking funds + owed payouts; the rest pays for storage.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, env, near, require,
};

const BPS: u128 = 10_000;
const JACKPOT_BPS: u128 = 1_400; // 14% of every NEAR put in, to the season's winner
/// Florin units: 1 florin = 10^22 units, so at the opening price 100 florins = 1 backing NEAR
/// (1 unit per yocto).
const FLORIN: u128 = 10_000_000_000_000_000_000_000;
/// The most the operator can mint in one call: 100 florins.
const MINT_MAX: u128 = 100 * FLORIN;
const GIFT_WINDOW_NS: u64 = 24 * 60 * 60 * 1_000_000_000; // 24h to rule on a gift
const STUNT_DAYS: u32 = 3;
const GAS_DAO_CREATE: Gas = Gas::from_tgas(150);
const GAS_CALLBACK: Gas = Gas::from_tgas(20);
const GAS_DAO_CHECK: Gas = Gas::from_tgas(10);
const GAS_DAO_PROPOSE: Gas = Gas::from_tgas(20);
const GAS_DAO_VOTE: Gas = Gas::from_tgas(40);
const GAS_ON_PROPOSED: Gas = Gas::from_tgas(60);
/// Sputnik proposal bond we set in every clan's policy: 0.01 NEAR.
// Nation aliases (9 Nov): the forwarder contract each named account runs (contracts/forwarder).
const FORWARDER_WASM: &[u8] = include_bytes!("../res/forwarder.wasm");
const ALIAS_DEPOSIT: u128 = 30_000_000_000_000_000_000_000; // 0.03 NEAR: the account, its 2 KB of code, gas headroom
const GAS_ALIAS_INIT: Gas = Gas::from_tgas(5);
const DAO_BOND: u128 = 10_000_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Clans,
    Agents,
    Gifts,
    Roots,
    Owed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Patron,
    Scholar,
    Smith,
    Drafter,
    Broker,
    Warden,
    Trickster,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GiftStatus {
    Pending,
    Rewarded,
    Punished,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Verdict {
    /// Stop an agent learning and working for STUNT_DAYS game days.
    Stunt,
    /// Remove an agent for good. Its name stays taken.
    Kill,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct God {
    pub account: AccountId,
    /// NEAR this god has put in (after costs). Splits the jackpot if their nation wins.
    pub put_in: U128,
    /// This god's shares of their nation's florins.
    pub shares: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Clan {
    pub id: u32,
    pub name: String,
    pub dao: AccountId,
    pub gods: Vec<God>,
    pub total_in: U128,
    /// The nation's florins (units; 1 florin = 10^22).
    pub florins: U128,
    /// Shares its gods hold in those florins.
    pub shares: U128,
    /// NEAR set aside for the clan's staking contract (deployed separately).
    pub staking_fund: U128,
    pub alive: bool,
    pub born_day: u32,
    /// Gifts the Warden passed. Most wins the season.
    pub clean_gifts: u32,
    /// The gods' latest whisper (temperament: risk, honesty, focus), set by DAO vote.
    pub whisper: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub name: String,
    pub clan: u32,
    pub role: Role,
    pub alive: bool,
    pub stunted_until: u32,
    pub born_day: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Gift {
    pub id: u64,
    pub clan: u32,
    /// sha256 of the draft as stored off chain.
    pub draft_hash: String,
    pub warden_passed: bool,
    pub created_ns: u64,
    pub day: u32,
    pub status: GiftStatus,
    pub ruled_by: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub operator: AccountId,
    pub dao_factory: AccountId,
    pub dao_deposit: U128,
    pub staking_deposit: U128,
    pub min_found: U128,
    pub day: u32,
    pub season: String,
    /// When the season ends (ns); the jackpot can be awarded after it.
    pub season_end_ns: U64,
    pub paused: bool,
}

#[near(serializers = [json])]
pub struct Stake {
    /// The god's florins in this nation (units; 1 florin = 10^22).
    pub florins: U128,
    /// What claiming them pays now (yocto).
    pub near: U128,
    pub put_in: U128,
}

#[near(serializers = [json])]
pub struct Totals {
    pub balance: U128,
    pub liabilities: U128,
    pub storage_locked: U128,
    /// NEAR behind the florin.
    pub backing: U128,
    /// Florins in existence (units).
    pub florins: U128,
    /// Yocto per whole florin.
    pub florin_value: U128,
    pub jackpot: U128,
    pub jackpot_paid: bool,
    pub minted: U128,
    pub burned: U128,
    pub clans: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct World {
    owner: AccountId,
    operator: AccountId,
    dao_factory: AccountId,
    dao_deposit: u128,
    staking_deposit: u128,
    min_found: u128,
    day: u32,
    next_clan: u32,
    next_gift: u64,
    clans: IterableMap<u32, Clan>,
    agents: IterableMap<String, Agent>,
    gifts: IterableMap<u64, Gift>,
    roots: LookupMap<u32, String>,
    /// Payouts that failed to send; the account can pull them with claim_owed.
    owed: LookupMap<AccountId, u128>,
    owed_total: u128,
    /// NEAR behind the florin (86% of everything put in, less claims and storage).
    backing: u128,
    /// Florins in existence (units).
    florins_total: u128,
    /// 14% of everything put in, for the season's winner.
    jackpot: u128,
    jackpot_paid: bool,
    season_end_ns: u64,
    /// Florins minted for work and burned for upkeep and fines (units), for the record.
    minted: u128,
    burned: u128,
    /// e.g. "S1: energy". The season winner picks the next field; the owner records it.
    season: String,
    /// Owner can stop NEW money (found, bless) in an emergency. Withdrawals never stop.
    paused: bool,
}

uint::construct_uint! {
    /// 256-bit integer for a*b/c on yocto amounts (1 NEAR = 10^24, so a*b overflows u128).
    pub struct U256(4);
}

fn bps(amount: u128, b: u128) -> u128 {
    mul_div(amount, b, BPS)
}

/// a * b / c without overflow.
fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

#[near]
impl World {
    #[init]
    pub fn new(
        owner: AccountId,
        operator: AccountId,
        dao_factory: AccountId,
        dao_deposit: U128,
        staking_deposit: U128,
        min_found: U128,
        season_end_ns: U64,
    ) -> Self {
        let w = Self {
            owner,
            operator,
            dao_factory,
            dao_deposit: dao_deposit.0,
            staking_deposit: staking_deposit.0,
            min_found: min_found.0,
            day: 0,
            next_clan: 1,
            next_gift: 1,
            clans: IterableMap::new(Key::Clans),
            agents: IterableMap::new(Key::Agents),
            gifts: IterableMap::new(Key::Gifts),
            roots: LookupMap::new(Key::Roots),
            owed: LookupMap::new(Key::Owed),
            owed_total: 0,
            backing: 0,
            florins_total: 0,
            jackpot: 0,
            jackpot_paid: false,
            season_end_ns: season_end_ns.0,
            minted: 0,
            burned: 0,
            season: "S1: energy".to_string(),
            paused: false,
        };
        w.check_min_found();
        w
    }

    // ---------------------------------------------------------------- gods

    /// Found a clan. The deposit pays the clan's DAO, its staking fund and its storage; the rest
    /// is split 86% backing (florins) / 14% jackpot. If the DAO can't be made, all of it goes back.
    #[payable]
    pub fn found_clan(&mut self, name: String) -> Promise {
        require!(!self.paused, "Paused: no new money while we check something");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.min_found, "Deposit is below the minimum to found a clan");
        require!(!name.is_empty() && name.len() <= 40, "Clan name must be 1-40 characters");
        let founder = env::predecessor_account_id();
        let id = self.next_clan;
        self.next_clan += 1;

        // The nation's name, readable (9 Nov), and the block height: nobody can register it ahead of
        // us to block a founding.
        let dao_name = format!("adf-{}-{}", slugify(&name), env::block_height());
        let policy = json!({
            "roles": [
                { "name": "gods", "kind": { "Group": [founder] }, "permissions": ["*:*"], "vote_policy": {} },
                { "name": "world", "kind": { "Group": [env::current_account_id()] },
                  "permissions": ["add_member_to_role:AddProposal", "add_member_to_role:VoteApprove",
                                  "remove_member_from_role:AddProposal", "remove_member_from_role:VoteApprove"],
                  "vote_policy": {} }
            ],
            "default_vote_policy": { "weight_kind": "RoleWeight", "quorum": "0", "threshold": [1, 2] },
            "proposal_bond": DAO_BOND.to_string(),
            "proposal_period": GIFT_WINDOW_NS.to_string(),
            "bounty_bond": DAO_BOND.to_string(),
            "bounty_forgiveness_period": GIFT_WINDOW_NS.to_string()
        });
        let dao_args = json!({
            "config": { "name": dao_name, "purpose": format!("AD FONTES clan: {name}"), "metadata": "" },
            "policy": policy
        });
        let args = json!({
            "name": dao_name,
            "args": Base64VecU8::from(dao_args.to_string().into_bytes())
        });

        // The factory's reply can't be trusted to carry a value (on testnet it returns nothing
        // even when the DAO is made), so we ask the new DAO itself: if get_config answers, the
        // DAO exists. If the create failed, the factory refunds the DAO deposit to us.
        let dao: AccountId = format!("{dao_name}.{}", self.dao_factory).parse().unwrap();
        Promise::new(self.dao_factory.clone())
            .function_call(
                "create".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(self.dao_deposit),
                GAS_DAO_CREATE,
            )
            .then(Promise::new(dao).function_call(
                "get_policy".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                GAS_DAO_CHECK,
            ))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_clan_founded(id, name, dao_name, founder, U128(deposit)),
            )
    }

    /// Success = the DAO answered get_policy AND its policy is ours (gods = [founder],
    /// world = [this contract]). A DAO that already existed under that name fails this check,
    /// so the founder is refunded. Parsing can't panic: any surprise = refund.
    #[private]
    pub fn on_clan_founded(
        &mut self,
        id: u32,
        name: String,
        dao_name: String,
        founder: AccountId,
        deposit: U128,
    ) -> bool {
        let created = env::promise_results_count() == 1
            && match env::promise_result(0) {
                near_sdk::PromiseResult::Successful(bytes) => policy_is_ours(&bytes, &founder),
                _ => false,
            };
        self.finish_founding(id, name, dao_name, founder, deposit, created)
    }
}

/// A nation's name as an account name part: lower case letters and digits, words joined by "-",
/// at most 24 characters ("Salamanco creek" -> "salamanco-creek"). Nothing usable -> "nation".
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 24 { break; }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "nation".to_string() } else { out }
}

/// True if a Sputnik policy (JSON) has exactly our two roles with the right members.
fn policy_is_ours(bytes: &[u8], founder: &AccountId) -> bool {
    let Ok(p) = near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(bytes) else {
        return false;
    };
    let group = |role: &str| -> Option<Vec<String>> {
        p.get("roles")?
            .as_array()?
            .iter()
            .find(|r| r.get("name").and_then(|n| n.as_str()) == Some(role))?
            .get("kind")?
            .get("Group")?
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
    };
    group("gods") == Some(vec![founder.to_string()])
        && group("world") == Some(vec![env::current_account_id().to_string()])
}

impl World {
    /// Ask the clan's DAO to add `god` to (or remove them from) its gods role, then approve it
    /// in the callback. The world role alone can pass these two kinds.
    fn propose_god(dao: AccountId, god: AccountId, add: bool) -> Promise {
        let kind = if add { "AddMemberToRole" } else { "RemoveMemberFromRole" };
        let what = if add { "blessed this clan and joins its gods" } else { "withdrew and leaves its gods" };
        let args = json!({
            "proposal": {
                "description": format!("AD FONTES: {god} {what}"),
                "kind": { (kind): { "member_id": god, "role": "gods" } }
            }
        });
        Promise::new(dao.clone())
            .function_call(
                "add_proposal".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(DAO_BOND),
                GAS_DAO_PROPOSE,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PROPOSED)
                    .on_god_proposed(dao, god, add),
            )
    }

    fn finish_founding(
        &mut self,
        id: u32,
        name: String,
        dao_name: String,
        founder: AccountId,
        deposit: U128,
        created: bool,
    ) -> bool {
        if !created {
            // The factory sends the DAO deposit back to us; the founder gets everything back.
            self.pay(founder, deposit.0).detach();
            env::log_str(&format!("clan {id} not founded; deposit refunded"));
            return false;
        }
        let dao: AccountId = format!("{dao_name}.{}", self.dao_factory).parse().unwrap();
        let before = env::storage_usage();
        let mut clan = Clan {
            id,
            name,
            dao,
            gods: vec![God { account: founder.clone(), put_in: U128(0), shares: U128(0) }],
            total_in: U128(0),
            florins: U128(0),
            shares: U128(0),
            staking_fund: U128(self.staking_deposit),
            alive: true,
            born_day: self.day,
            clean_gifts: 0,
            whisper: String::new(),
        };
        self.clans.insert(id, clan.clone());
        self.clans.flush(); // collections write lazily; flush so storage_usage sees the entry
        let storage = self.storage_cost_since(before) * 2; // headroom for the clan growing
        // Never panic in a callback: a panic here would strand the founder's deposit.
        // found_clan already checked deposit >= min_found > costs, so this can't go below 0.
        let net = deposit
            .0
            .saturating_sub(self.dao_deposit)
            .saturating_sub(self.staking_deposit)
            .saturating_sub(storage);
        clan.gods[0].put_in = U128(net);
        clan.total_in = U128(net);
        self.buy_in(&mut clan, 0, net);
        self.clans.insert(id, clan);
        env::log_str(&format!("clan {id} founded by {founder}, {net} yocto in"));
        true
    }
}

#[near]
impl World {
    /// Put more NEAR into a clan. Anyone who blesses a clan becomes one of its gods.
    #[payable]
    /// A new god also gets a vote: the world proposes them to the clan's DAO and approves it.
    /// The 0.01 NEAR proposal bond comes out of their first blessing.
    #[payable]
    pub fn bless(&mut self, clan_id: u32) -> PromiseOrValue<bool> {
        require!(!self.paused, "Paused: no new money while we check something");
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach NEAR to bless");
        let who = env::predecessor_account_id();
        let before = env::storage_usage();
        let mut clan = self.live_clan(clan_id);
        let is_new = !clan.gods.iter().any(|g| g.account == who);
        match clan.gods.iter_mut().find(|g| g.account == who) {
            Some(g) => g.put_in = U128(g.put_in.0 + amount),
            None => clan.gods.push(God { account: who.clone(), put_in: U128(amount), shares: U128(0) }),
        }
        self.clans.insert(clan_id, clan.clone());
        self.clans.flush();
        let costs = self.storage_cost_since(before) + if is_new { DAO_BOND } else { 0 };
        require!(amount > costs, "Blessing too small to cover storage and the DAO bond");
        let net = amount - costs;
        if costs > 0 {
            let g = clan.gods.iter_mut().find(|g| g.account == who).unwrap();
            g.put_in = U128(g.put_in.0 - costs);
        }
        clan.total_in = U128(clan.total_in.0 + net);
        let idx = clan.gods.iter().position(|g| g.account == who).unwrap();
        self.buy_in(&mut clan, idx, net);
        let dao = clan.dao.clone();
        self.clans.insert(clan_id, clan);
        if !is_new {
            return PromiseOrValue::Value(true);
        }
        PromiseOrValue::Promise(Self::propose_god(dao, who, true))
    }

    /// Retry for a god whose automatic DAO seat failed. They pay the 0.01 NEAR bond.
    #[payable]
    pub fn join_dao(&mut self, clan_id: u32) -> Promise {
        require!(env::attached_deposit().as_yoctonear() >= DAO_BOND, "Attach 0.01 NEAR for the DAO bond");
        let who = env::predecessor_account_id();
        let clan = self.live_clan(clan_id);
        require!(clan.gods.iter().any(|g| g.account == who), "Only a god of this clan");
        Self::propose_god(clan.dao, who, true)
    }

    #[private]
    pub fn on_god_proposed(&mut self, dao: AccountId, god: AccountId, add: bool) -> bool {
        // add_proposal returns the new proposal id. Parse without panicking.
        let id = match env::promise_result(0) {
            near_sdk::PromiseResult::Successful(b) => near_sdk::serde_json::from_slice::<u64>(&b).ok(),
            _ => None,
        };
        let Some(id) = id else {
            env::log_str(&format!("could not propose {god} to {dao}; they can call join_dao"));
            return false;
        };
        let args = json!({
            "id": id,
            "action": "VoteApprove",
            "proposal": { (if add { "AddMemberToRole" } else { "RemoveMemberFromRole" }): { "member_id": god, "role": "gods" } }
        });
        Promise::new(dao)
            .function_call("act_proposal".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_DAO_VOTE)
            .detach();
        true
    }

    /// Whisper: the gods set the clan's temperament (by DAO vote). Agents read it each turn.
    pub fn whisper(&mut self, clan_id: u32, text: String) {
        require!(text.len() <= 280, "Whisper too long");
        let mut clan = self.live_clan(clan_id);
        require!(env::predecessor_account_id() == clan.dao, "Only the clan's DAO can whisper");
        clan.whisper = text;
        self.clans.insert(clan_id, clan);
        // A whisper's storage (at most ~0.003 NEAR) is paid by the world, never by the nation:
        // a god must always be able to speak to a nation that lost everything.
    }

    /// Root it out (SPEC §14): the gods cut a point of knowledge (and all that grew from it) from
    /// their nation's mind map, by DAO vote. Nothing is stored here: the engine reads the passed
    /// proposal and prunes the map, and the line gets shorter (drafts get less likely).
    pub fn root_out(&mut self, clan_id: u32, point: String) {
        let clan = self.live_clan(clan_id);
        require!(env::predecessor_account_id() == clan.dao, "Only the clan's DAO can root out knowledge");
        require!(!point.is_empty() && point.len() <= 120, "Point must be 1-120 characters");
        env::log_str(&format!("root_out {clan_id} {point}"));
    }

    /// Smite: stunt or kill one of the clan's agents at any time (by DAO vote), no gift needed.
    pub fn smite(&mut self, clan_id: u32, agent: String, verdict: Verdict) {
        let clan = self.live_clan(clan_id);
        require!(env::predecessor_account_id() == clan.dao, "Only the clan's DAO can smite");
        let mut a = self.agents.get(&agent).expect("No such agent").clone();
        require!(a.clan == clan_id && a.alive, "Agent is not alive in this clan");
        match verdict {
            Verdict::Stunt => a.stunted_until = self.day + STUNT_DAYS,
            Verdict::Kill => a.alive = false,
        }
        self.agents.insert(agent, a);
    }

    /// The clan's DAO (its gods' vote) sends the staking fund to the clan's staking account.
    pub fn release_staking(&mut self, clan_id: u32, to: AccountId) -> Promise {
        let mut clan = self.live_clan(clan_id);
        require!(env::predecessor_account_id() == clan.dao, "Only the clan's DAO can release its staking fund");
        let amount = clan.staking_fund.0;
        require!(amount > 0, "No staking fund left");
        clan.staking_fund = U128(0);
        self.clans.insert(clan_id, clan);
        Promise::new(to)
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_staking_sent(clan_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_staking_sent(&mut self, clan_id: u32, amount: U128) -> bool {
        let ok = matches!(env::promise_result(0), near_sdk::PromiseResult::Successful(_));
        if !ok {
            // Put it back so the DAO can try again.
            if let Some(c) = self.clans.get(&clan_id) {
                let mut c = c.clone();
                c.staking_fund = U128(c.staking_fund.0 + amount.0);
                self.clans.insert(clan_id, c);
            }
        }
        ok
    }

    /// Claim: a god takes out their florins as NEAR at today's florin value, and leaves.
    /// The 14% they put into the jackpot stays there. The clan dies when its last god leaves.
    pub fn withdraw(&mut self, clan_id: u32) -> Promise {
        let who = env::predecessor_account_id();
        let mut clan = self.live_clan(clan_id);
        let idx = clan.gods.iter().position(|g| g.account == who);
        require!(idx.is_some(), "Only a god of this clan can withdraw");
        let idx = idx.unwrap();

        let put_in = clan.gods[idx].put_in.0;
        let my_shares = clan.gods[idx].shares.0;
        let last = clan.gods.len() == 1;
        let fl = if last || clan.shares.0 == 0 {
            clan.florins.0
        } else {
            mul_div(clan.florins.0, my_shares, clan.shares.0)
        };
        let mut payout = if self.florins_total == 0 { 0 } else { mul_div(fl, self.backing, self.florins_total) };
        clan.florins = U128(clan.florins.0 - fl);
        clan.shares = U128(clan.shares.0.saturating_sub(my_shares));
        self.florins_total -= fl;
        self.backing -= payout;
        clan.total_in = U128(clan.total_in.0.saturating_sub(put_in));
        clan.gods.remove(idx);
        if last {
            payout += clan.staking_fund.0;
            clan.staking_fund = U128(0);
            clan.alive = false;
            env::log_str(&format!("clan {clan_id} died: its last god left"));
        }
        let dao = clan.dao.clone();
        self.clans.insert(clan_id, clan);
        if last || payout <= DAO_BOND {
            return self.pay(who, payout);
        }
        // Remaining gods shouldn't be blocked by a departed god's vote: remove them from the
        // DAO too. The 0.01 NEAR bond comes out of their payout.
        Self::propose_god(dao, who.clone(), false).detach();
        self.pay(who, payout - DAO_BOND)
    }

    /// Pull a payout that failed to send earlier.
    pub fn claim_owed(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.remove(&who).unwrap_or(0);
        require!(amount > 0, "Nothing owed");
        self.owed_total -= amount;
        self.pay(who, amount)
    }

    // ---------------------------------------------------------------- the clan's DAO

    /// A ruling on a gift. Called by the clan's Sputnik DAO when its gods' vote passes.
    /// Reward = a god blesses the clan directly; this records it.
    pub fn rule(&mut self, gift_id: u64, reward: bool, verdict: Option<Verdict>, agent: Option<String>) {
        let mut gift = self.gifts.get(&gift_id).expect("No such gift").clone();
        let clan = self.clans.get(&gift.clan).expect("No such clan").clone();
        require!(env::predecessor_account_id() == clan.dao, "Only the clan's DAO can rule");
        require!(gift.status == GiftStatus::Pending, "Gift already settled");
        if reward {
            gift.status = GiftStatus::Rewarded;
        } else {
            let verdict = verdict.expect("A punishment needs a verdict");
            let name = agent.expect("A punishment needs an agent");
            let mut a = self.agents.get(&name).expect("No such agent").clone();
            require!(a.clan == gift.clan && a.alive, "Agent is not alive in this clan");
            match verdict {
                Verdict::Stunt => a.stunted_until = self.day + STUNT_DAYS,
                Verdict::Kill => a.alive = false,
            }
            self.agents.insert(name, a);
            gift.status = GiftStatus::Punished;
        }
        gift.ruled_by = Some(clan.dao);
        self.gifts.insert(gift_id, gift);
    }

    // ---------------------------------------------------------------- operator (the world tick)

    /// Advance the game day. Days only go forward.
    pub fn tick(&mut self, day: u32) {
        self.only_operator();
        require!(day > self.day, "Days only go forward");
        self.day = day;
    }

    /// Add an agent. Names are unique across the world, forever (dead names stay taken).
    pub fn spawn_agent(&mut self, clan_id: u32, name: String, role: Role) {
        self.only_operator();
        require!(!name.is_empty() && name.len() <= 32, "Agent name must be 1-32 characters");
        require!(self.agents.get(&name).is_none(), "That name is taken");
        let mut clan = self.live_clan(clan_id);
        let before = env::storage_usage();
        self.agents.insert(
            name.clone(),
            Agent { name, clan: clan_id, role, alive: true, stunted_until: 0, born_day: self.day },
        );
        self.agents.flush();
        // The nation pays for its citizen's storage in florins at their NEAR value.
        let cost = self.storage_cost_since(before);
        self.charge_storage(&mut clan, cost);
        self.clans.insert(clan_id, clan);
    }

    /// One nation buys from another, in florins (no fee).
    pub fn trade(&mut self, buyer: u32, seller: u32, amount: U128, memo: String) {
        self.only_operator();
        self.move_florins(buyer, seller, amount.0, &memo, "trade");
    }

    // ---------------------------------------------------------------- agent wallets (8 Nov)
    // Each nation's Broker and Patron have their own NEAR accounts and sign their own moves. The
    // registry lives in its own storage slots ("aw:" / "awr:" keys), outside the contract's state
    // struct, so adding it changed no stored layout.

    /// The operator registers (or replaces) an agent's wallet. role: "Broker" or "Patron".
    pub fn set_agent_wallet(&mut self, clan_id: u32, role: String, account: AccountId) {
        self.only_operator();
        require!(role == "Broker" || role == "Patron", "Only a Broker or a Patron gets a wallet");
        self.live_clan(clan_id);
        let taken = env::storage_read(Self::rev_key(&account).as_bytes()).is_some();
        require!(!taken || Self::wallet_of(clan_id, &role).as_ref() == Some(&account), "That account already works for another nation");
        if let Some(old) = Self::wallet_of(clan_id, &role) {
            env::storage_remove(Self::rev_key(&old).as_bytes());
            // Remembered, so the operator can move what the old wallet held to the new one (mt_move_to_broker).
            if old != account { env::storage_write(format!("aw:prev:{clan_id}:{role}").as_bytes(), old.as_str().as_bytes()); }
        }
        env::storage_write(format!("aw:{clan_id}:{role}").as_bytes(), account.as_str().as_bytes());
        env::storage_write(Self::rev_key(&account).as_bytes(), format!("{clan_id}:{role}").as_bytes());
        env::log_str(&format!("agent wallet {clan_id} {role} {account}"));
    }

    pub fn get_agent_wallet(&self, clan_id: u32, role: String) -> Option<AccountId> {
        Self::wallet_of(clan_id, &role)
    }

    // ---------------------------------------------------------------- nation aliases (9 Nov)
    // A nation's named account: <name>.<this world>, e.g. helios.w6.adf-pool1-hf0w8.testnet. Only
    // this contract can make accounts under its own name, so nobody can take one first. It runs the
    // forwarder (contracts/forwarder): whatever is sent there goes on to the nation's DAO when anyone
    // calls forward(). Registry in raw storage keys ("al:" id -> account, "als:" name -> id), so
    // adding it changed no stored layout.

    /// The operator makes a nation's named account; the attached 0.03 NEAR pays for it.
    #[payable]
    pub fn create_alias(&mut self, clan_id: u32) -> Promise {
        self.only_operator();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= ALIAS_DEPOSIT, "Attach 0.03 NEAR for the account and its storage");
        let clan = self.live_clan(clan_id);
        require!(Self::alias_of(clan_id).is_none(), "This nation already has a named account");
        let mut slug = slugify(&clan.name);
        if env::storage_read(format!("als:{slug}").as_bytes()).is_some() {
            slug = format!("{slug}-{clan_id}");
        }
        require!(env::storage_read(format!("als:{slug}").as_bytes()).is_none(), "That name is taken");
        let alias: AccountId = format!("{slug}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("That name doesn't make a valid account"));
        // Reserved now (two calls can't race for it); freed again if the account can't be made.
        env::storage_write(format!("als:{slug}").as_bytes(), clan_id.to_string().as_bytes());
        Promise::new(alias.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit))
            .deploy_contract(FORWARDER_WASM.to_vec())
            .function_call("init".to_string(), clan.dao.as_str().as_bytes().to_vec(), NearToken::from_yoctonear(0), GAS_ALIAS_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_alias_made(clan_id, slug, alias, U128(deposit)),
            )
    }

    /// Records the named account if it was made; otherwise frees the name and returns the deposit.
    #[private]
    pub fn on_alias_made(&mut self, clan_id: u32, slug: String, alias: AccountId, deposit: U128) -> bool {
        let made = env::promise_results_count() == 1 && matches!(env::promise_result(0), near_sdk::PromiseResult::Successful(_));
        if made {
            env::storage_write(format!("al:{clan_id}").as_bytes(), alias.as_str().as_bytes());
            env::log_str(&format!("alias {clan_id} {alias}"));
        } else {
            env::storage_remove(format!("als:{slug}").as_bytes());
            // A failed create_account sends the deposit back here; it goes back to the operator.
            Promise::new(self.operator.clone()).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            env::log_str(&format!("alias for {clan_id} not made; deposit returned"));
        }
        made
    }

    /// A nation's named account, if it has one.
    pub fn get_alias(&self, clan_id: u32) -> Option<AccountId> {
        Self::alias_of(clan_id)
    }

    fn alias_of(clan_id: u32) -> Option<AccountId> {
        env::storage_read(format!("al:{clan_id}").as_bytes())
            .and_then(|v| String::from_utf8(v).ok())
            .and_then(|s| s.parse().ok())
    }

    /// A nation's Broker buys from another nation, signing from its own wallet.
    pub fn agent_buy(&mut self, seller: u32, amount: U128, memo: String) {
        let buyer = self.agent_clan("Broker");
        self.move_florins(buyer, seller, amount.0, &memo, "agent-trade");
    }

    /// A nation's Patron spends its florins (the war chest, walls), signing from its own wallet.
    /// Spent florins are burned, like the operator's burn.
    pub fn agent_spend(&mut self, amount: U128, memo: String) -> U128 {
        let clan_id = self.agent_clan("Patron");
        self.burn_florins(clan_id, amount.0, &memo, "agent-spend")
    }

    /// Florins for good work (clean corpus, passed draft, a tech). At most MINT_MAX a call.
    /// Minting dilutes every other florin a little: the backing doesn't grow.
    pub fn mint(&mut self, clan_id: u32, amount: U128, memo: String) {
        self.only_operator();
        require!(amount.0 > 0 && amount.0 <= MINT_MAX, "Mint 1 unit to 100 florins per call");
        require!(memo.len() <= 200, "Memo too long");
        let mut c = self.live_clan(clan_id);
        require!(c.shares.0 > 0, "Nobody holds this nation's florins");
        c.florins = U128(c.florins.0 + amount.0);
        self.florins_total += amount.0;
        self.minted += amount.0;
        self.clans.insert(clan_id, c);
        env::log_str(&format!("mint {clan_id} {} {memo}", amount.0));
    }

    /// Upkeep and Warden fines: florins burned (every other florin is worth a little more).
    /// A nation that can't pay pays what it has.
    pub fn burn(&mut self, clan_id: u32, amount: U128, memo: String) -> U128 {
        self.only_operator();
        self.burn_florins(clan_id, amount.0, &memo, "burn")
    }

    /// Record a draft (a gift to the nation's gods, theirs to reward or punish).
    pub fn gift(&mut self, clan_id: u32, draft_hash: String, warden_passed: bool) -> u64 {
        self.only_operator();
        require!(draft_hash.len() == 64, "draft_hash must be a hex sha256");
        let mut clan = self.live_clan(clan_id);
        let id = self.next_gift;
        self.next_gift += 1;
        if warden_passed {
            clan.clean_gifts += 1;
            self.clans.insert(clan_id, clan);
        }
        self.gifts.insert(
            id,
            Gift {
                id,
                clan: clan_id,
                draft_hash,
                warden_passed,
                created_ns: env::block_timestamp(),
                day: self.day,
                status: GiftStatus::Pending,
                ruled_by: None,
            },
        );
        id
    }

    /// One provenance fingerprint for the whole world per day (records live off chain).
    pub fn set_root(&mut self, day: u32, root: String) {
        self.only_operator();
        require!(root.len() == 64, "root must be a hex sha256");
        require!(self.roots.get(&day).is_none(), "That day already has a root");
        self.roots.insert(day, root);
    }

    #[private]
    pub fn on_paid(&mut self, to: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_err() {
            let cur = self.owed.get(&to).copied().unwrap_or(0);
            self.owed.insert(to, cur + amount.0);
            self.owed_total += amount.0;
        }
    }

    // ---------------------------------------------------------------- owner

    /// Hand the owner role over (to the Season 2 multisig) without an upgrade.
    /// Stop or restart NEW money (found, bless). Withdrawals are never paused.
    pub fn set_paused(&mut self, paused: bool) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.paused = paused;
    }

    /// After the season ends: pay the jackpot to the winning nation's gods, split by what each
    /// put in. Once. The winner (#1 on the reverence standings) is read off chain by the owner.
    pub fn award_jackpot(&mut self, clan_id: u32) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        require!(env::block_timestamp() >= self.season_end_ns, "The season isn't over");
        require!(!self.jackpot_paid, "The jackpot was already paid");
        let clan = self.clans.get(&clan_id).expect("No such clan").clone();
        let total: u128 = clan.gods.iter().map(|g| g.put_in.0).sum();
        require!(total > 0, "That nation has no gods to pay");
        let pot = self.jackpot;
        self.jackpot = 0;
        self.jackpot_paid = true;
        for g in &clan.gods {
            let share = mul_div(pot, g.put_in.0, total);
            if share > 0 {
                self.pay(g.account.clone(), share).detach();
            }
        }
        env::log_str(&format!("jackpot {pot} to nation {clan_id}"));
    }

    /// Record the season (the winner of the last one picks the field).
    pub fn set_season(&mut self, season: String) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        require!(season.len() <= 80, "Season label too long");
        self.season = season;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.owner = owner;
    }

    pub fn set_config(
        &mut self,
        operator: Option<AccountId>,
        dao_deposit: Option<U128>,
        staking_deposit: Option<U128>,
        min_found: Option<U128>,
        season_end_ns: Option<U64>,
    ) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        if let Some(v) = operator { self.operator = v; }
        if let Some(v) = season_end_ns { require!(!self.jackpot_paid, "The jackpot was already paid"); self.season_end_ns = v.0; }
        if let Some(v) = dao_deposit { self.dao_deposit = v.0; }
        if let Some(v) = staking_deposit { self.staking_deposit = v.0; }
        if let Some(v) = min_found { self.min_found = v.0; }
        self.check_min_found();
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            dao_factory: self.dao_factory.clone(),
            dao_deposit: U128(self.dao_deposit),
            staking_deposit: U128(self.staking_deposit),
            min_found: U128(self.min_found),
            day: self.day,
            season: self.season.clone(),
            season_end_ns: U64(self.season_end_ns),
            paused: self.paused,
        }
    }

    pub fn get_clan(&self, clan_id: u32) -> Option<Clan> {
        self.clans.get(&clan_id).cloned()
    }

    pub fn list_clans(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Clan> {
        let from = from.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.clans.values().skip(from).take(limit).cloned().collect()
    }

    pub fn get_agent(&self, name: String) -> Option<Agent> {
        self.agents.get(&name).cloned()
    }

    pub fn list_agents(&self, clan_id: u32, from: Option<u32>, limit: Option<u32>) -> Vec<Agent> {
        let from = from.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.agents.values().filter(|a| a.clan == clan_id).skip(from).take(limit).cloned().collect()
    }

    pub fn get_gift(&self, gift_id: u64) -> Option<Gift> {
        self.gifts.get(&gift_id).cloned()
    }

    pub fn get_root(&self, day: u32) -> Option<String> {
        self.roots.get(&day).cloned()
    }

    pub fn get_owed(&self, account: AccountId) -> U128 {
        U128(self.owed.get(&account).copied().unwrap_or(0))
    }

    /// The solvency check: balance must cover liabilities plus locked storage.
    pub fn get_totals(&self) -> Totals {
        let liabilities: u128 = self.clans.values().map(|c| c.staking_fund.0).sum::<u128>()
            + self.backing
            + self.jackpot
            + self.owed_total;
        Totals {
            balance: U128(env::account_balance().as_yoctonear()),
            liabilities: U128(liabilities),
            storage_locked: U128(env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear()),
            backing: U128(self.backing),
            florins: U128(self.florins_total),
            florin_value: U128(self.florin_value()),
            jackpot: U128(self.jackpot),
            jackpot_paid: self.jackpot_paid,
            minted: U128(self.minted),
            burned: U128(self.burned),
            clans: self.clans.len(),
        }
    }

    /// A god's stake in a nation: their florins and what claiming them pays now (yocto).
    pub fn get_stake(&self, clan_id: u32, account: AccountId) -> Stake {
        let none = Stake { florins: U128(0), near: U128(0), put_in: U128(0) };
        let Some(c) = self.clans.get(&clan_id) else { return none };
        let Some(g) = c.gods.iter().find(|g| g.account == account) else { return none };
        let fl = if c.shares.0 == 0 { 0 } else { mul_div(c.florins.0, g.shares.0, c.shares.0) };
        let near = if self.florins_total == 0 { 0 } else { mul_div(fl, self.backing, self.florins_total) };
        Stake { florins: U128(fl), near: U128(near), put_in: g.put_in }
    }

    // ---------------------------------------------------------------- internals

    fn only_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "Only the world operator");
    }

    fn move_florins(&mut self, buyer: u32, seller: u32, amount: u128, memo: &str, what: &str) {
        require!(buyer != seller, "Buying inside your own clan isn't a trade");
        require!(memo.len() <= 200, "Memo too long");
        let mut b = self.live_clan(buyer);
        let mut s = self.live_clan(seller);
        require!(b.florins.0 >= amount, "Buyer can't afford it");
        b.florins = U128(b.florins.0 - amount);
        s.florins = U128(s.florins.0 + amount);
        self.clans.insert(buyer, b);
        self.clans.insert(seller, s);
        env::log_str(&format!("{what} {buyer}->{seller} {amount} {memo}"));
    }

    fn burn_florins(&mut self, clan_id: u32, amount: u128, memo: &str, what: &str) -> U128 {
        require!(memo.len() <= 200, "Memo too long");
        let mut c = self.live_clan(clan_id);
        let paid = amount.min(c.florins.0);
        c.florins = U128(c.florins.0 - paid);
        self.florins_total -= paid;
        self.burned += paid;
        self.clans.insert(clan_id, c);
        env::log_str(&format!("{what} {clan_id} {paid} {memo}"));
        U128(paid)
    }

    fn rev_key(a: &AccountId) -> String {
        format!("awr:{a}")
    }

    fn wallet_of(clan_id: u32, role: &str) -> Option<AccountId> {
        env::storage_read(format!("aw:{clan_id}:{role}").as_bytes())
            .and_then(|v| String::from_utf8(v).ok())
            .and_then(|s| s.parse().ok())
    }

    /// The nation whose agent (in this role) is signing, or a refusal.
    fn agent_clan(&self, role: &str) -> u32 {
        let who = env::predecessor_account_id();
        let v = env::storage_read(Self::rev_key(&who).as_bytes()).unwrap_or_else(|| env::panic_str("Not an agent wallet"));
        let s = String::from_utf8(v).unwrap_or_default();
        let (id, r) = s.split_once(':').unwrap_or(("", ""));
        require!(r == role, "This wallet can't do that");
        id.parse().unwrap_or_else(|_| env::panic_str("Bad agent record"))
    }

    fn live_clan(&self, id: u32) -> Clan {
        let c = self.clans.get(&id).expect("No such clan").clone();
        require!(c.alive, "That clan is dead");
        c
    }

    fn storage_cost_since(&self, before: u64) -> u128 {
        let after = env::storage_usage();
        if after > before {
            (after - before) as u128 * env::storage_byte_cost().as_yoctonear()
        } else {
            0
        }
    }

    /// Yocto per whole florin (the opening price is 0.01 NEAR).
    fn florin_value(&self) -> u128 {
        if self.florins_total == 0 { FLORIN } else { mul_div(FLORIN, self.backing, self.florins_total) }
    }

    /// NEAR put in by god `idx` of `clan`: 14% to the jackpot, 86% into the backing; the nation
    /// gets florins at today's price and the god gets shares of the nation's florins.
    fn buy_in(&mut self, clan: &mut Clan, idx: usize, net: u128) {
        let jack = bps(net, JACKPOT_BPS);
        let back = net - jack;
        self.jackpot += jack;
        let fl = if self.backing == 0 || self.florins_total == 0 { back } else { mul_div(back, self.florins_total, self.backing) };
        self.backing += back;
        self.florins_total += fl;
        // A nation whose florins are all gone: its gods' old shares are worth nothing; start over.
        if clan.florins.0 == 0 {
            for g in clan.gods.iter_mut() { g.shares = U128(0); }
            clan.shares = U128(0);
        }
        let sh = if clan.shares.0 == 0 { fl } else { mul_div(fl, clan.shares.0, clan.florins.0) };
        clan.florins = U128(clan.florins.0 + fl);
        clan.shares = U128(clan.shares.0 + sh);
        clan.gods[idx].shares = U128(clan.gods[idx].shares.0 + sh);
    }

    /// Storage the nation caused (a citizen, a long whisper): burn florins worth `cost` and take
    /// that NEAR out of the backing to cover the storage.
    fn charge_storage(&mut self, clan: &mut Clan, cost: u128) {
        if cost == 0 { return; }
        let fl = if self.backing == 0 { u128::MAX } else { mul_div(cost, self.florins_total, self.backing) + 1 };
        require!(clan.florins.0 >= fl && self.backing >= cost, "The nation can't afford the storage");
        clan.florins = U128(clan.florins.0 - fl);
        self.florins_total -= fl;
        self.backing -= cost;
    }

    /// Send NEAR; if it fails, the amount is kept for the account to claim.
    fn pay(&mut self, to: AccountId, amount: u128) -> Promise {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_paid(to, U128(amount)),
            )
    }

    fn check_min_found(&self) {
        // Founding must cover the DAO, the staking fund and storage, and leave NEAR to play with.
        let floor = self.dao_deposit + self.staking_deposit + NearToken::from_millinear(50).as_yoctonear();
        require!(self.min_found > floor, "min_found must exceed DAO + staking + storage");
    }
}

// Research, patents and kits as NEP-245 multi-tokens (9 Nov).
mod mt;
pub use mt::{MtInfo, MtMint, MtToken};
// The marketplace, agents only (9 Nov).
mod market;
pub use market::{Listing, Sale};

#[cfg(test)]
mod tests;
