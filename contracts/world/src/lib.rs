//! AD FONTES world contract (Season 1).
//!
//! Holds every clan's NEAR as a ledger, splits deposits 86/14, takes the 14% fee on spend,
//! pays gods out on withdraw, keeps agents (names unique across the world), gifts and rulings,
//! and one provenance root per game day. Rules: Documents/NEAR_LAUNCHPAD/SPEC.md §6b, §12b.
//!
//! Money words used below:
//! - play: the clan's 86%, what agents spend.
//! - reserve: the clan's 14%, where the daily fee comes from.
//! - fee_due: 14% of what the clan spent since the last sweep.
//! - liabilities: everything this contract owes clans and gods. The rest of the balance is
//!   ours (it pays for storage).

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, env, near, require,
};

const BPS: u128 = 10_000;
const PLAY_BPS: u128 = 8_600; // 86% to play with
const FEE_BPS: u128 = 1_400; // 14% of spend goes to us
const GIFT_WINDOW_NS: u64 = 24 * 60 * 60 * 1_000_000_000; // 24h to rule on a gift
const STUNT_DAYS: u32 = 3;
const GAS_DAO_CREATE: Gas = Gas::from_tgas(150);
const GAS_CALLBACK: Gas = Gas::from_tgas(20);
const GAS_DAO_CHECK: Gas = Gas::from_tgas(10);
const GAS_DAO_PROPOSE: Gas = Gas::from_tgas(20);
const GAS_DAO_VOTE: Gas = Gas::from_tgas(40);
const GAS_ON_PROPOSED: Gas = Gas::from_tgas(60);
/// Sputnik proposal bond we set in every clan's policy: 0.01 NEAR.
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
    Claimed,
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
    /// NEAR this god has put in (after costs). Sets their share and vote on money.
    pub put_in: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Clan {
    pub id: u32,
    pub name: String,
    pub dao: AccountId,
    pub gods: Vec<God>,
    pub total_in: U128,
    pub play: U128,
    pub reserve: U128,
    pub fee_due: U128,
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
    /// The clan whose corpus contributed most to the draft (may be the same clan).
    pub top_contributor: u32,
    pub created_ns: u64,
    pub day: u32,
    pub status: GiftStatus,
    pub ruled_by: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub operator: AccountId,
    pub treasury: AccountId,
    pub dao_factory: AccountId,
    pub dao_deposit: U128,
    pub staking_deposit: U128,
    pub min_found: U128,
    pub day: u32,
    pub season: String,
    pub paused: bool,
}

#[near(serializers = [json])]
pub struct Totals {
    pub balance: U128,
    pub liabilities: U128,
    pub storage_locked: U128,
    pub fees_paid: U128,
    pub fees_pending: U128,
    pub burned: U128,
    pub clans: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct World {
    owner: AccountId,
    operator: AccountId,
    treasury: AccountId,
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
    /// Fees taken from reserves but not yet sent to the treasury.
    fees_pending: u128,
    fees_paid: u128,
    /// Upkeep leaves the clans and goes to no one. No function can move it.
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
        treasury: AccountId,
        dao_factory: AccountId,
        dao_deposit: U128,
        staking_deposit: U128,
        min_found: U128,
    ) -> Self {
        let w = Self {
            owner,
            operator,
            treasury,
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
            fees_pending: 0,
            fees_paid: 0,
            burned: 0,
            season: "S1: energy".to_string(),
            paused: false,
        };
        w.check_min_found();
        w
    }

    // ---------------------------------------------------------------- gods

    /// Found a clan. The deposit pays the clan's DAO, its staking fund and its storage; the rest
    /// is split 86/14. If the DAO can't be made, the whole deposit goes back.
    #[payable]
    pub fn found_clan(&mut self, name: String) -> Promise {
        require!(!self.paused, "Paused: no new money while we check something");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.min_found, "Deposit is below the minimum to found a clan");
        require!(!name.is_empty() && name.len() <= 40, "Clan name must be 1-40 characters");
        let founder = env::predecessor_account_id();
        let id = self.next_clan;
        self.next_clan += 1;

        // Block height in the name: nobody can register it ahead of us to block a founding.
        let dao_name = format!("adf-{id}-{}", env::block_height());
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
            gods: vec![God { account: founder.clone(), put_in: U128(0) }],
            total_in: U128(0),
            play: U128(0),
            reserve: U128(0),
            fee_due: U128(0),
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
        clan.play = U128(bps(net, PLAY_BPS));
        clan.reserve = U128(net - bps(net, PLAY_BPS));
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
            None => clan.gods.push(God { account: who.clone(), put_in: U128(amount) }),
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
        clan.play = U128(clan.play.0 + bps(net, PLAY_BPS));
        clan.reserve = U128(clan.reserve.0 + net - bps(net, PLAY_BPS));
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
        let before = env::storage_usage();
        clan.whisper = text;
        self.clans.insert(clan_id, clan.clone());
        self.clans.flush();
        // A longer whisper costs storage; the clan pays from play money.
        let cost = self.storage_cost_since(before);
        if cost > 0 {
            require!(clan.play.0 >= cost, "Clan can't afford to store this whisper");
            clan.play = U128(clan.play.0 - cost);
            self.clans.insert(clan_id, clan);
        }
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

    /// A god takes out their share. The clan dies when its last god leaves.
    pub fn withdraw(&mut self, clan_id: u32) -> Promise {
        let who = env::predecessor_account_id();
        let mut clan = self.live_clan(clan_id);
        let idx = clan.gods.iter().position(|g| g.account == who);
        require!(idx.is_some(), "Only a god of this clan can withdraw");
        let idx = idx.unwrap();

        // Settle the fee this clan owes so far, so the leaving god doesn't skip it.
        Self::settle_fee(&mut clan, &mut self.fees_pending);

        let put_in = clan.gods[idx].put_in.0;
        let last = clan.gods.len() == 1;
        let (play_out, reserve_out) = if last || clan.total_in.0 == 0 {
            (clan.play.0, clan.reserve.0)
        } else {
            (
                mul_div(clan.play.0, put_in, clan.total_in.0),
                mul_div(clan.reserve.0, put_in, clan.total_in.0),
            )
        };
        let mut payout = play_out + reserve_out;
        clan.play = U128(clan.play.0 - play_out);
        clan.reserve = U128(clan.reserve.0 - reserve_out);
        clan.total_in = U128(clan.total_in.0 - put_in);
        clan.gods.remove(idx);
        if last {
            payout += clan.staking_fund.0;
            clan.staking_fund = U128(0);
            clan.fee_due = U128(0);
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

    /// Nobody ruled within 24h: a god of the clan that contributed most may claim the gift.
    pub fn claim_gift(&mut self, gift_id: u64) {
        let mut gift = self.gifts.get(&gift_id).expect("No such gift").clone();
        require!(gift.status == GiftStatus::Pending, "Gift already settled");
        require!(
            env::block_timestamp() >= gift.created_ns + GIFT_WINDOW_NS,
            "The gift's own gods still have time to rule"
        );
        let who = env::predecessor_account_id();
        let contributor = self.clans.get(&gift.top_contributor).expect("No such clan");
        require!(
            contributor.gods.iter().any(|g| g.account == who),
            "Only a god of the top contributing clan can claim"
        );
        gift.status = GiftStatus::Claimed;
        gift.ruled_by = Some(who);
        self.gifts.insert(gift_id, gift);
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
        // The clan pays for its agent's storage out of play money (not counted as spend).
        let cost = self.storage_cost_since(before);
        require!(clan.play.0 >= cost, "Clan can't afford the agent's storage");
        clan.play = U128(clan.play.0 - cost);
        self.clans.insert(clan_id, clan);
    }

    /// One clan buys from another. Buying inside your own clan isn't spend, so it's refused here.
    pub fn trade(&mut self, buyer: u32, seller: u32, amount: U128, memo: String) {
        self.only_operator();
        require!(buyer != seller, "Buying inside your own clan isn't a trade");
        require!(memo.len() <= 200, "Memo too long");
        let mut b = self.live_clan(buyer);
        let mut s = self.live_clan(seller);
        require!(b.play.0 >= amount.0, "Buyer can't afford it");
        b.play = U128(b.play.0 - amount.0);
        b.fee_due = U128(b.fee_due.0 + bps(amount.0, FEE_BPS));
        // Sales income splits 86/14 like a deposit.
        s.play = U128(s.play.0 + bps(amount.0, PLAY_BPS));
        s.reserve = U128(s.reserve.0 + amount.0 - bps(amount.0, PLAY_BPS));
        self.clans.insert(buyer, b);
        self.clans.insert(seller, s);
        env::log_str(&format!("trade {buyer}->{seller} {} {memo}", amount.0));
    }

    /// Daily upkeep. Burned, and counted as spend. A clan that can't pay pays what it has.
    pub fn upkeep(&mut self, clan_id: u32, amount: U128) -> U128 {
        self.only_operator();
        let mut c = self.live_clan(clan_id);
        let paid = amount.0.min(c.play.0);
        c.play = U128(c.play.0 - paid);
        c.fee_due = U128(c.fee_due.0 + bps(paid, FEE_BPS));
        self.burned += paid;
        self.clans.insert(clan_id, c);
        U128(paid)
    }

    /// A Warden caught this clan (fake citation, copied claim). The bounty goes to our treasury
    /// with the next fee sweep. A clan that can't pay pays what it has.
    pub fn bounty(&mut self, clan_id: u32, amount: U128, memo: String) -> U128 {
        self.only_operator();
        require!(memo.len() <= 200, "Memo too long");
        let mut c = self.live_clan(clan_id);
        let paid = amount.0.min(c.play.0);
        c.play = U128(c.play.0 - paid);
        self.fees_pending += paid;
        self.clans.insert(clan_id, c);
        env::log_str(&format!("bounty {clan_id} {paid} {memo}"));
        U128(paid)
    }

    /// Record a gift from a clan to its gods.
    pub fn gift(&mut self, clan_id: u32, draft_hash: String, warden_passed: bool, top_contributor: u32) -> u64 {
        self.only_operator();
        require!(draft_hash.len() == 64, "draft_hash must be a hex sha256");
        let mut clan = self.live_clan(clan_id);
        require!(self.clans.get(&top_contributor).is_some(), "No such contributing clan");
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
                top_contributor,
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

    /// Take each clan's fee from its reserve and send the total to the treasury.
    pub fn sweep_fees(&mut self) -> PromiseOrValue<bool> {
        self.only_operator();
        let ids: Vec<u32> = self.clans.keys().copied().collect();
        for id in ids {
            let mut c = self.clans.get(&id).unwrap().clone();
            if c.fee_due.0 > 0 {
                Self::settle_fee(&mut c, &mut self.fees_pending);
                self.clans.insert(id, c);
            }
        }
        let amount = self.fees_pending;
        if amount == 0 {
            return PromiseOrValue::Value(false);
        }
        self.fees_pending = 0;
        PromiseOrValue::Promise(
            Promise::new(self.treasury.clone())
                .transfer(NearToken::from_yoctonear(amount))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_fees_sent(U128(amount)),
                ),
        )
    }

    #[private]
    pub fn on_fees_sent(&mut self, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_ok() {
            self.fees_paid += amount.0;
        } else {
            self.fees_pending += amount.0; // try again next sweep
        }
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
        treasury: Option<AccountId>,
        dao_deposit: Option<U128>,
        staking_deposit: Option<U128>,
        min_found: Option<U128>,
    ) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        if let Some(v) = operator { self.operator = v; }
        if let Some(v) = treasury { self.treasury = v; }
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
            treasury: self.treasury.clone(),
            dao_factory: self.dao_factory.clone(),
            dao_deposit: U128(self.dao_deposit),
            staking_deposit: U128(self.staking_deposit),
            min_found: U128(self.min_found),
            day: self.day,
            season: self.season.clone(),
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
        let liabilities: u128 = self
            .clans
            .values()
            .map(|c| c.play.0 + c.reserve.0 + c.staking_fund.0)
            .sum::<u128>()
            + self.fees_pending
            + self.owed_total;
        Totals {
            balance: U128(env::account_balance().as_yoctonear()),
            liabilities: U128(liabilities),
            storage_locked: U128(env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear()),
            fees_paid: U128(self.fees_paid),
            fees_pending: U128(self.fees_pending),
            burned: U128(self.burned),
            clans: self.clans.len(),
        }
    }

    // ---------------------------------------------------------------- internals

    fn only_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "Only the world operator");
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

    /// Move the fee owed from the reserve into fees_pending. If the reserve is short, the rest
    /// stays owed.
    fn settle_fee(c: &mut Clan, fees_pending: &mut u128) {
        let take = c.fee_due.0.min(c.reserve.0);
        c.reserve = U128(c.reserve.0 - take);
        c.fee_due = U128(c.fee_due.0 - take);
        *fees_pending += take;
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

#[cfg(test)]
mod tests;
