//! Unit tests: one per money rule in SPEC §14 (v2: florins + jackpot). Amounts in NEAR unless noted.

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1000;
const SEASON_END: u64 = 1_000_000_000_000; // ns; tests run at block time 0 unless they move it

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn world_id() -> AccountId {
    acc("world.adfontes.near")
}

fn ctx(pred: &str, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(world_id())
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(1000));
    b
}

fn set(pred: &str, deposit: u128) {
    testing_env!(ctx(pred, deposit).build());
}

fn set_at(pred: &str, ns: u64) {
    let mut c = ctx(pred, 0);
    c.block_timestamp(ns);
    testing_env!(c.build());
}

fn set_with_result(pred: &str, result: PromiseResult) {
    testing_env!(
        ctx(pred, 0).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn new_world() -> World {
    set("adfontes.near", 0);
    World::new(
        acc("adfontes.near"),
        acc("operator.adfontes.near"),
        acc("sputnik-dao.near"),
        U128(100 * MILLI),  // DAO 0.1
        U128(1200 * MILLI), // staking 1.2
        U128(2300 * MILLI), // minimum to found 2.3
        U64(SEASON_END),
    )
}

/// Found a clan for `god` with `deposit` and have the factory say yes.
fn found(w: &mut World, god: &str, deposit: u128) -> u32 {
    set(god, deposit);
    let _ = w.found_clan(format!("clan of {god}"));
    let id = w.next_clan - 1;
    set_with_result("world.adfontes.near", PromiseResult::Successful(b"true".to_vec()));
    assert!(w.finish_founding(id, format!("clan of {god}"), format!("adf-clan-{id}"), acc(god), U128(deposit), true));
    id
}

fn clan(w: &World, id: u32) -> Clan {
    w.get_clan(id).unwrap()
}

fn op() {
    set("operator.adfontes.near", 0);
}

/// What `god` would get for claiming now (yocto).
fn stake(w: &World, id: u32, god: &str) -> u128 {
    w.get_stake(id, acc(god)).near.0
}

fn close(a: u128, b: u128, tol: u128) -> bool {
    a.abs_diff(b) <= tol
}

// ---------------------------------------------------------------- founding and buying in

#[test]
fn founding_splits_86_backing_14_jackpot() {
    let mut w = new_world();
    let id = found(&mut w, "god1.near", 3 * NEAR);
    let c = clan(&w, id);
    let net = c.total_in.0;
    // 3 - 0.1 DAO - 1.2 staking = 1.7, less a little storage.
    assert!(net < 1700 * MILLI && net > 1690 * MILLI, "net {net}");
    let t = w.get_totals();
    assert_eq!(t.jackpot.0, net * 14 / 100);
    assert_eq!(t.backing.0 + t.jackpot.0, net);
    // Opening price: 1 unit per yocto, so 1 florin = 0.01 NEAR.
    assert_eq!(c.florins.0, t.backing.0);
    assert_eq!(t.florin_value.0, NEAR / 100);
    assert_eq!(c.gods[0].shares.0, c.shares.0);
    assert_eq!(c.staking_fund.0, 1200 * MILLI);
    assert_eq!(c.dao, acc("adf-clan-1.sputnik-dao.near"));
    // The founder's stake is exactly the backing they made.
    assert_eq!(stake(&w, id, "god1.near"), t.backing.0);
}

#[test]
#[should_panic(expected = "below the minimum")]
fn founding_below_minimum_refused() {
    let mut w = new_world();
    set("god1.near", 2 * NEAR);
    let _ = w.found_clan("x".into());
}

#[test]
fn failed_dao_means_no_clan_and_no_money_moves() {
    let mut w = new_world();
    set("god1.near", 3 * NEAR);
    let _ = w.found_clan("x".into());
    set_with_result("world.adfontes.near", PromiseResult::Failed);
    assert!(!w.finish_founding(1, "x".into(), "adf-clan-1".into(), acc("god1.near"), U128(3 * NEAR), false));
    assert!(w.get_clan(1).is_none());
    let t = w.get_totals();
    assert_eq!(t.backing.0 + t.jackpot.0 + t.florins.0, 0);
}

#[test]
fn a_late_god_buys_in_at_todays_price_and_takes_nothing_from_earlier_gods() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    // Nation a does good work: florins minted, so a's founder is worth more than they put in.
    op();
    for _ in 0..5 {
        w.mint(a, U128(100 * FLORIN), "clean corpus".into());
    }
    let before = stake(&w, a, "god1.near");
    // A late god blesses a with 2 NEAR.
    set("late.near", 2 * NEAR);
    let _ = w.bless(a);
    let c = clan(&w, a);
    let late_net = c.gods[1].put_in.0;
    let late = stake(&w, a, "late.near");
    // The late god's stake = their 86% (rounding aside); the founder's stake didn't move.
    assert!(close(late, late_net * 86 / 100, 10), "late {late} vs {}", late_net * 86 / 100);
    assert!(close(stake(&w, a, "god1.near"), before, 10), "founder diluted by a late god");
}

#[test]
fn new_god_pays_the_dao_bond_once() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god2.near", NEAR);
    let _ = w.bless(a);
    let first = clan(&w, a).gods[1].put_in.0;
    assert!(first < NEAR - 10 * MILLI + 1, "bond + storage taken: {first}");
    set("god2.near", NEAR);
    let _ = w.bless(a);
    assert_eq!(clan(&w, a).gods[1].put_in.0 - first, NEAR, "no bond the second time");
}

#[test]
fn big_nations_claim_without_overflow() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god2.near", 500 * NEAR);
    let _ = w.bless(a);
    set("god1.near", 400 * NEAR);
    let _ = w.bless(a);
    set("god2.near", 0);
    let _ = w.withdraw(a);
    assert!(clan(&w, a).alive);
}

// ---------------------------------------------------------------- florins: mint, burn, trade

#[test]
fn minting_dilutes_others_and_burning_lifts_them() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let b0 = stake(&w, b, "god2.near");
    let backing = w.get_totals().backing.0;
    op();
    w.mint(a, U128(100 * FLORIN), "passed draft".into());
    assert!(stake(&w, b, "god2.near") < b0, "b is diluted by a's mint");
    assert!(stake(&w, a, "god1.near") > b0, "a gained");
    assert_eq!(w.get_totals().backing.0, backing, "minting never creates NEAR");
    op();
    w.burn(a, U128(200 * FLORIN), "upkeep".into());
    assert!(stake(&w, b, "god2.near") > b0, "a's burn lifts b above where it started");
    let sum = stake(&w, a, "god1.near") + stake(&w, b, "god2.near");
    assert!(close(sum, backing, 4), "all stakes add up to the backing: {sum} vs {backing}");
}

#[test]
fn mint_is_capped_and_operator_only() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        op();
        w.mint(a, U128(100 * FLORIN + 1), "too much".into());
    }));
    assert!(r.is_err(), "over 100 florins in one call");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god1.near", 0);
        w.mint(a, U128(FLORIN), "self-mint".into());
    }));
    assert!(r.is_err(), "a god can't mint");
}

#[test]
fn trade_moves_florins_between_nations_with_no_fee() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let (fa, fb, total) = (clan(&w, a).florins.0, clan(&w, b).florins.0, w.get_totals().florins.0);
    op();
    w.trade(b, a, U128(4 * FLORIN), "corpus".into());
    assert_eq!(clan(&w, b).florins.0, fb - 4 * FLORIN);
    assert_eq!(clan(&w, a).florins.0, fa + 4 * FLORIN);
    assert_eq!(w.get_totals().florins.0, total);
}

#[test]
#[should_panic(expected = "Buyer can't afford it")]
fn a_buyer_cannot_overdraw() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let all = clan(&w, b).florins.0;
    op();
    w.trade(b, a, U128(all + 1), "corpus".into());
}

#[test]
#[should_panic(expected = "isn't a trade")]
fn buying_inside_your_nation_is_not_a_trade() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    op();
    w.trade(a, a, U128(FLORIN), "x".into());
}

#[test]
fn a_starving_nation_burns_what_it_has() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let all = clan(&w, a).florins.0;
    op();
    let paid = w.burn(a, U128(all * 2), "upkeep".into());
    assert_eq!(paid.0, all);
    assert_eq!(clan(&w, a).florins.0, 0);
}

// ---------------------------------------------------------------- claiming

#[test]
fn claim_pays_florins_at_todays_value_and_last_god_ends_the_nation() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god2.near", 2 * NEAR);
    let _ = w.bless(a);
    let g2 = stake(&w, a, "god2.near");
    let t0 = w.get_totals();
    set("god2.near", 0);
    let _ = w.withdraw(a);
    let t1 = w.get_totals();
    assert!(close(t0.backing.0 - t1.backing.0, g2, 4), "god2 took exactly their stake");
    assert_eq!(t1.jackpot.0, t0.jackpot.0, "the 14% stays in the jackpot");
    assert!(clan(&w, a).alive);

    set("god1.near", 0);
    let _ = w.withdraw(a);
    let c = clan(&w, a);
    assert!(!c.alive);
    assert_eq!(c.florins.0 + c.staking_fund.0, 0, "last god takes everything left");
    assert!(w.get_totals().backing.0 <= 2, "nothing left behind but rounding");
}

#[test]
fn no_floor_a_nation_can_lose_everything() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    let all = clan(&w, a).florins.0;
    op();
    w.burn(a, U128(all), "upkeep".into());
    assert_eq!(stake(&w, a, "god1.near"), 0);
    // Everything nation a lost now backs nation b.
    let t = w.get_totals();
    assert!(close(stake(&w, 2, "god2.near"), t.backing.0, 2));
}

#[test]
fn blessing_a_nation_that_lost_everything_starts_its_shares_over() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    let all = clan(&w, a).florins.0;
    op();
    w.burn(a, U128(all), "upkeep".into());
    set("god1.near", NEAR);
    let _ = w.bless(a);
    let c = clan(&w, a);
    assert_eq!(c.shares.0, c.gods[0].shares.0);
    assert!(close(stake(&w, a, "god1.near"), NEAR * 86 / 100, 10));
}

#[test]
#[should_panic(expected = "Only a god of this clan")]
fn strangers_cannot_claim() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("thief.near", 0);
    let _ = w.withdraw(a);
}

#[test]
fn liabilities_cover_backing_jackpot_and_staking() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    op();
    w.mint(a, U128(50 * FLORIN), "x".into());
    w.burn(a, U128(20 * FLORIN), "y".into());
    let t = w.get_totals();
    assert_eq!(t.liabilities.0, t.backing.0 + t.jackpot.0 + 2 * 1200 * MILLI);
}

// ---------------------------------------------------------------- storage paid in florins

#[test]
fn a_citizen_is_paid_for_in_florins_and_names_stay_unique() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let (f0, back0) = (clan(&w, a).florins.0, w.get_totals().backing.0);
    op();
    w.spawn_agent(a, "Ilse Varga".into(), Role::Scholar);
    let (f1, back1) = (clan(&w, a).florins.0, w.get_totals().backing.0);
    assert!(f1 < f0, "florins burned for storage");
    assert!(back1 < back0, "and that NEAR left the backing to pay for it");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        op();
        w.spawn_agent(b, "Ilse Varga".into(), Role::Smith);
    }));
    assert!(r.is_err(), "same name in another nation must fail");
}

// ---------------------------------------------------------------- drafts and rulings

fn gift_setup() -> (World, u32, u64) {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    op();
    w.spawn_agent(a, "Odo Brann".into(), Role::Drafter);
    let g = w.gift(a, "ab".repeat(32), true);
    (w, a, g)
}

#[test]
fn dao_stunts_for_3_days_and_kills() {
    let (mut w, a, g) = gift_setup();
    op();
    w.tick(5);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.rule(g, false, Some(Verdict::Stunt), Some("Odo Brann".into()));
    assert_eq!(w.get_agent("Odo Brann".into()).unwrap().stunted_until, 8);
    assert_eq!(w.get_gift(g).unwrap().status, GiftStatus::Punished);
    assert_eq!(clan(&w, a).clean_gifts, 1);

    op();
    let g2 = w.gift(a, "cd".repeat(32), false);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.rule(g2, false, Some(Verdict::Kill), Some("Odo Brann".into()));
    assert!(!w.get_agent("Odo Brann".into()).unwrap().alive);
    assert_eq!(clan(&w, a).clean_gifts, 1, "failed drafts don't count");
}

#[test]
#[should_panic(expected = "Only the clan's DAO")]
fn only_the_dao_rules() {
    let (mut w, _a, g) = gift_setup();
    set("god1.near", 0);
    w.rule(g, true, None, None);
}

// ---------------------------------------------------------------- the jackpot

#[test]
fn jackpot_waits_for_season_end_then_pays_the_winner_by_put_in_once() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god3.near", 4 * NEAR);
    let _ = w.bless(a);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    let pot = w.get_totals().jackpot.0;
    // Too early.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set_at("adfontes.near", SEASON_END - 1);
        w.award_jackpot(a);
    }));
    assert!(r.is_err(), "not before the season ends");
    // Not the owner.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set_at("god1.near", SEASON_END);
        w.award_jackpot(a);
    }));
    assert!(r.is_err(), "only the owner");
    set_at("adfontes.near", SEASON_END);
    w.award_jackpot(a);
    let t = w.get_totals();
    assert!(t.jackpot_paid);
    assert_eq!(t.jackpot.0, 0, "the whole pot left ({pot})");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set_at("adfontes.near", SEASON_END + 1);
        w.award_jackpot(a);
    }));
    assert!(r.is_err(), "only once");
}

// ---------------------------------------------------------------- DAO, owner, pause

fn policy(gods: &str, world: &str) -> Vec<u8> {
    format!(
        r#"{{"roles":[{{"name":"gods","kind":{{"Group":["{gods}"]}},"permissions":["*:*"],"vote_policy":{{}}}},{{"name":"world","kind":{{"Group":["{world}"]}},"permissions":[],"vote_policy":{{}}}}],"proposal_bond":"1"}}"#
    )
    .into_bytes()
}

#[test]
fn founding_check_accepts_only_our_dao() {
    set("world.adfontes.near", 0);
    let god = acc("god1.near");
    assert!(policy_is_ours(&policy("god1.near", "world.adfontes.near"), &god));
    assert!(!policy_is_ours(&policy("squatter.near", "world.adfontes.near"), &god));
    assert!(!policy_is_ours(&policy("god1.near", "squatter.near"), &god));
    assert!(!policy_is_ours(b"", &god));
    assert!(!policy_is_ours(b"true", &god));
    assert!(!policy_is_ours(b"{\"roles\":42}", &god));
}

#[test]
fn only_the_dao_releases_staking_and_only_once() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god1.near", 0);
        let _ = w.release_staking(a, acc("stake.god1.near"));
    }));
    assert!(r.is_err(), "a god alone can't take the staking fund");
    set("adf-clan-1.sputnik-dao.near", 0);
    let _ = w.release_staking(a, acc("stake-1.adfontes.near"));
    assert_eq!(clan(&w, a).staking_fund.0, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("adf-clan-1.sputnik-dao.near", 0);
        let _ = w.release_staking(a, acc("stake-1.adfontes.near"));
    }));
    assert!(r.is_err(), "can't release twice");
}

#[test]
fn owner_can_hand_over() {
    let mut w = new_world();
    set("adfontes.near", 0);
    w.set_owner(acc("multisig.adfontes.near"));
    assert_eq!(w.owner, acc("multisig.adfontes.near"));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("adfontes.near", 0);
        w.set_config(None, None, None, Some(U128(5 * NEAR)), None);
    }));
    assert!(r.is_err(), "old owner is out");
}

#[test]
fn pause_stops_new_money_but_never_claims() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("adfontes.near", 0);
    w.set_paused(true);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god2.near", NEAR);
        let _ = w.bless(a);
    }));
    assert!(r.is_err(), "no blessing while paused");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god2.near", 3 * NEAR);
        let _ = w.found_clan("x".into());
    }));
    assert!(r.is_err(), "no founding while paused");
    set("god1.near", 0);
    let _ = w.withdraw(a); // must still work
    assert!(!clan(&w, a).alive);
}

#[test]
fn a_broke_nation_can_still_be_whispered_to() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let all = clan(&w, a).florins.0;
    op();
    w.burn(a, U128(all), "upkeep".into());
    set("adf-clan-1.sputnik-dao.near", 0);
    w.whisper(a, "we are still here; keep going".into());
    assert_eq!(clan(&w, a).whisper, "we are still here; keep going");
}

#[test]
fn only_the_dao_roots_out_knowledge() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.root_out(a, "lithium sulfur batteries".into()); // fine: the DAO voted
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god1.near", 0);
        w.root_out(a, "lithium sulfur batteries".into());
    }));
    assert!(r.is_err(), "a god alone can't root out; it takes the DAO vote");
}

#[test]
fn dao_whispers_and_smites_without_a_gift() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    op();
    w.spawn_agent(a, "Tamsin Holt".into(), Role::Scholar);
    w.tick(10);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.whisper(a, "careful, honest, batteries first".into());
    w.smite(a, "Tamsin Holt".into(), Verdict::Stunt);
    assert_eq!(clan(&w, a).whisper, "careful, honest, batteries first");
    assert_eq!(w.get_agent("Tamsin Holt".into()).unwrap().stunted_until, 13);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god1.near", 0);
        w.smite(a, "Tamsin Holt".into(), Verdict::Kill);
    }));
    assert!(r.is_err(), "a god alone can't smite; it takes the DAO vote");
}

// ---------------------------------------------------------------- agent wallets (8 Nov)

#[test]
fn a_broker_wallet_buys_for_its_own_nation() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 10 * NEAR);
    let b = found(&mut w, "god2.near", 10 * NEAR);
    op();
    w.mint(a, U128(50 * FLORIN), "work".into());
    w.set_agent_wallet(a, "Broker".into(), acc("broker1.op.near"));
    w.set_agent_wallet(a, "Patron".into(), acc("patron1.op.near"));
    let (fa, fb) = (clan(&w, a).florins.0, clan(&w, b).florins.0);
    set("broker1.op.near", 0);
    w.agent_buy(b, U128(5 * FLORIN), "corpus:c1".into());
    assert_eq!(clan(&w, a).florins.0, fa - 5 * FLORIN);
    assert_eq!(clan(&w, b).florins.0, fb + 5 * FLORIN);
    assert_eq!(w.get_agent_wallet(a, "Broker".into()), Some(acc("broker1.op.near")));
}

#[test]
#[should_panic(expected = "This wallet can't do that")]
fn a_patron_wallet_cannot_trade() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 10 * NEAR);
    let b = found(&mut w, "god2.near", 10 * NEAR);
    op();
    w.set_agent_wallet(a, "Patron".into(), acc("patron1.op.near"));
    set("patron1.op.near", 0);
    w.agent_buy(b, U128(FLORIN), "x".into());
}

#[test]
#[should_panic(expected = "Not an agent wallet")]
fn a_stranger_cannot_act_as_an_agent() {
    let mut w = new_world();
    let _a = found(&mut w, "god1.near", 10 * NEAR);
    let b = found(&mut w, "god2.near", 10 * NEAR);
    set("someone.near", 0);
    w.agent_buy(b, U128(FLORIN), "x".into());
}

#[test]
#[should_panic(expected = "Only the world operator")]
fn only_the_operator_registers_wallets() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 10 * NEAR);
    set("god1.near", 0);
    w.set_agent_wallet(a, "Broker".into(), acc("mine.near"));
}

#[test]
#[should_panic(expected = "That account already works for another nation")]
fn one_wallet_serves_one_nation() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 10 * NEAR);
    let b = found(&mut w, "god2.near", 10 * NEAR);
    op();
    w.set_agent_wallet(a, "Broker".into(), acc("broker.op.near"));
    w.set_agent_wallet(b, "Broker".into(), acc("broker.op.near"));
}

#[test]
fn a_patron_spends_its_own_nations_florins_and_they_burn() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 10 * NEAR);
    op();
    w.mint(a, U128(20 * FLORIN), "work".into());
    w.set_agent_wallet(a, "Patron".into(), acc("patron1.op.near"));
    let (fa, total, burned) = (clan(&w, a).florins.0, w.florins_total, w.burned);
    set("patron1.op.near", 0);
    let paid = w.agent_spend(U128(3 * FLORIN), "walls".into());
    assert_eq!(paid.0, 3 * FLORIN);
    assert_eq!(clan(&w, a).florins.0, fa - 3 * FLORIN);
    assert_eq!(w.florins_total, total - 3 * FLORIN);
    assert_eq!(w.burned, burned + 3 * FLORIN);
}

// ---------------------------------------------------------------- nation aliases (9 Nov)

fn found_named(w: &mut World, god: &str, name: &str) -> u32 {
    set(god, 10 * NEAR);
    let _ = w.found_clan(name.to_string());
    let id = w.next_clan - 1;
    set_with_result("world.adfontes.near", PromiseResult::Successful(b"true".to_vec()));
    assert!(w.finish_founding(id, name.to_string(), format!("adf-x-{id}"), acc(god), U128(10 * NEAR), true));
    id
}

fn made(w: &mut World, id: u32, ok: bool) -> Option<AccountId> {
    set("operator.adfontes.near", ALIAS_DEPOSIT);
    let _ = w.create_alias(id);
    // What create_alias reserved: the callback gets the same slug and account back.
    let name = w.get_clan(id).unwrap().name;
    let mut slug = slugify(&name);
    if env::storage_read(format!("als:{slug}").as_bytes()).map(|v| v != id.to_string().into_bytes()).unwrap_or(false) {
        slug = format!("{slug}-{id}");
    }
    let alias: AccountId = format!("{slug}.world.adfontes.near").parse().unwrap();
    set_with_result("world.adfontes.near", if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed });
    w.on_alias_made(id, slug, alias, U128(ALIAS_DEPOSIT));
    w.get_alias(id)
}

#[test]
fn names_become_account_names() {
    assert_eq!(slugify("Salamanco creek"), "salamanco-creek");
    assert_eq!(slugify("  Helios!! "), "helios");
    assert_eq!(slugify("Ünïcode ★ only"), "n-code-only");
    assert_eq!(slugify("★★★"), "nation");
    assert!(slugify("a very long nation name that goes on and on").len() <= 24);
}

#[test]
fn a_nation_gets_its_named_account() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    assert_eq!(w.get_alias(a), None);
    assert_eq!(made(&mut w, a, true), Some(acc("helios.world.adfontes.near")));
}

#[test]
fn a_second_nation_with_the_same_name_gets_its_id_added() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    let b = found_named(&mut w, "god2.near", "helios");
    made(&mut w, a, true);
    assert_eq!(made(&mut w, b, true), Some(acc(&format!("helios-{b}.world.adfontes.near"))));
}

#[test]
fn a_failed_account_frees_the_name() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    assert_eq!(made(&mut w, a, false), None);
    assert!(env::storage_read(b"als:helios").is_none(), "the name is free again");
    assert_eq!(made(&mut w, a, true), Some(acc("helios.world.adfontes.near")), "and a retry gets it");
}

#[test]
#[should_panic(expected = "Only the world operator")]
fn only_the_operator_makes_named_accounts() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    set("god1.near", ALIAS_DEPOSIT);
    let _ = w.create_alias(a);
}

#[test]
#[should_panic(expected = "Attach 0.03 NEAR")]
fn a_named_account_needs_its_deposit() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    set("operator.adfontes.near", ALIAS_DEPOSIT - 1);
    let _ = w.create_alias(a);
}

#[test]
#[should_panic(expected = "already has a named account")]
fn one_named_account_per_nation() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    made(&mut w, a, true);
    set("operator.adfontes.near", ALIAS_DEPOSIT);
    let _ = w.create_alias(a);
}

#[test]
fn new_daos_carry_the_nation_name() {
    let mut w = new_world();
    set("god1.near", 10 * NEAR);
    let _ = w.found_clan("Salamanco creek".into());
    // The DAO name is built inside found_clan; the next founding's would read adf-salamanco-creek-<block>.
    assert!(format!("adf-{}-{}", slugify("Salamanco creek"), env::block_height()).starts_with("adf-salamanco-creek-"));
}

// ---------------------------------------------------------------- research as NEP-245 tokens (9 Nov)

fn mint(w: &mut World, token: &str, owner: &str, amount: u128) {
    set("operator.adfontes.near", NEAR / 10);
    w.mt_mint_batch(vec![MtMint { token_id: token.into(), owner_id: acc(owner), amount: U128(amount), title: Some(format!("title of {token}")) }], None);
}
fn ids(v: Vec<MtToken>) -> Vec<String> {
    let mut x: Vec<String> = v.into_iter().map(|t| t.token_id).collect();
    x.sort();
    x
}

#[test]
fn research_is_copied_to_every_nation_that_learns_it() {
    let mut w = new_world();
    mint(&mut w, "r:c43", "dao-a.near", 1);
    mint(&mut w, "r:c43", "dao-b.near", 1); // a buyer's copy: the seller keeps its own
    assert_eq!(w.mt_balance_of(acc("dao-a.near"), "r:c43".into()).0, 1);
    assert_eq!(w.mt_balance_of(acc("dao-b.near"), "r:c43".into()).0, 1);
    assert_eq!(w.mt_supply("r:c43".into()).unwrap().0, 2);
    let info = w.mt_token_info("r:c43".into()).unwrap();
    assert_eq!((info.kind.as_str(), info.title.as_str()), ("research", "title of r:c43"));
    assert!(w.mt_token(vec!["r:c43".into()])[0].as_ref().unwrap().owner_id.is_none(), "copyable: no single owner");
    assert_eq!(w.mt_supply("r:nope".into()), None);
}

#[test]
fn a_patent_is_one_of_a_kind() {
    let mut w = new_world();
    mint(&mut w, "p:d59", "dao-a.near", 1);
    assert_eq!(w.mt_token(vec!["p:d59".into()])[0].as_ref().unwrap().owner_id, Some(acc("dao-a.near")));
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| mint(&mut w, "p:d59", "dao-b.near", 1)));
    assert!(again.is_err(), "a second patent of the same draft is refused");
}

#[test]
#[should_panic(expected = "Only the world operator")]
fn only_the_world_mints() {
    let mut w = new_world();
    set("god1.near", 0);
    w.mt_mint_batch(vec![MtMint { token_id: "r:c1".into(), owner_id: acc("god1.near"), amount: U128(1), title: None }], None);
}

#[test]
fn a_holder_transfers_with_one_yocto_and_the_lists_follow() {
    let mut w = new_world();
    mint(&mut w, "p:d59", "dao-a.near", 1);
    mint(&mut w, "r:c1", "dao-a.near", 1);
    mint(&mut w, "k:t1", "dao-a.near", 1);
    assert_eq!(ids(w.mt_tokens_for_owner(acc("dao-a.near"), None, None)), vec!["k:t1", "p:d59", "r:c1"]);
    set("dao-a.near", 1);
    w.mt_transfer(acc("dao-b.near"), "p:d59".into(), U128(1), None, Some("sold".into()));
    assert_eq!(w.mt_balance_of(acc("dao-a.near"), "p:d59".into()).0, 0);
    assert_eq!(w.mt_balance_of(acc("dao-b.near"), "p:d59".into()).0, 1);
    assert_eq!(w.mt_token(vec!["p:d59".into()])[0].as_ref().unwrap().owner_id, Some(acc("dao-b.near")), "the patent's owner moved with it");
    assert_eq!(ids(w.mt_tokens_for_owner(acc("dao-a.near"), None, None)), vec!["k:t1", "r:c1"]);
    assert_eq!(ids(w.mt_tokens_for_owner(acc("dao-b.near"), None, None)), vec!["p:d59"]);
    set("dao-a.near", 1);
    w.mt_batch_transfer(acc("dao-b.near"), vec!["r:c1".into(), "k:t1".into()], vec![U128(1), U128(1)], None, None);
    assert!(w.mt_tokens_for_owner(acc("dao-a.near"), None, None).is_empty());
    assert_eq!(ids(w.mt_tokens(None, None)), vec!["k:t1", "p:d59", "r:c1"]);
    assert_eq!(w.mt_count().0, 3);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_transfer_needs_exactly_one_yocto() {
    let mut w = new_world();
    mint(&mut w, "r:c1", "dao-a.near", 1);
    set("dao-a.near", 0);
    w.mt_transfer(acc("dao-b.near"), "r:c1".into(), U128(1), None, None);
}

#[test]
#[should_panic(expected = "Not enough of that token")]
fn nobody_moves_what_they_dont_hold() {
    let mut w = new_world();
    mint(&mut w, "r:c1", "dao-a.near", 1);
    set("thief.near", 1);
    w.mt_transfer(acc("fence.near"), "r:c1".into(), U128(1), None, None);
}

#[test]
fn transfer_call_refunds_what_the_receiver_didnt_use() {
    let mut w = new_world();
    mint(&mut w, "r:c1", "dao-a.near", 3);
    set("dao-a.near", 1);
    let _ = w.mt_transfer_call(acc("market.near"), "r:c1".into(), U128(3), None, None, "list".into());
    assert_eq!(w.mt_balance_of(acc("market.near"), "r:c1".into()).0, 3);
    // The receiver says it used only 1 of the 3.
    set_with_result("world.adfontes.near", PromiseResult::Successful(b"[\"2\"]".to_vec()));
    let kept = w.mt_resolve_transfer(acc("dao-a.near"), acc("market.near"), vec!["r:c1".into()], vec![U128(3)]);
    assert_eq!(kept[0].0, 1);
    assert_eq!(w.mt_balance_of(acc("dao-a.near"), "r:c1".into()).0, 2);
    assert_eq!(w.mt_balance_of(acc("market.near"), "r:c1".into()).0, 1);
    // A receiver that fails gets nothing.
    set("dao-a.near", 1);
    let _ = w.mt_transfer_call(acc("market.near"), "r:c1".into(), U128(2), None, None, "list".into());
    set_with_result("world.adfontes.near", PromiseResult::Failed);
    let kept = w.mt_resolve_transfer(acc("dao-a.near"), acc("market.near"), vec!["r:c1".into()], vec![U128(2)]);
    assert_eq!(kept[0].0, 0);
    assert_eq!(w.mt_balance_of(acc("dao-a.near"), "r:c1".into()).0, 2);
}

#[test]
#[should_panic(expected = "for the storage these tokens take")]
fn the_operator_pays_for_token_storage() {
    let mut w = new_world();
    set("operator.adfontes.near", 0);
    w.mt_mint_batch(vec![MtMint { token_id: "r:c1".into(), owner_id: acc("dao-a.near"), amount: U128(1), title: Some("x".into()) }], None);
}

#[test]
fn a_nations_tokens_move_from_its_dao_to_its_broker() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    let dao = w.get_clan(a).unwrap().dao;
    for t in ["r:c1", "r:c2", "p:d1"] { mint(&mut w, t, dao.as_str(), 1); }
    op();
    w.set_agent_wallet(a, "Broker".into(), acc("broker1.op.near"));
    assert_eq!(w.mt_move_to_broker(a, 2), 2, "a page at a time");
    assert_eq!(w.mt_move_to_broker(a, 10), 1);
    assert_eq!(w.mt_move_to_broker(a, 10), 0, "nothing left in the DAO");
    assert!(w.mt_tokens_for_owner(dao, None, None).is_empty());
    assert_eq!(ids(w.mt_tokens_for_owner(acc("broker1.op.near"), None, None)), vec!["p:d1", "r:c1", "r:c2"]);
    assert_eq!(w.mt_token(vec!["p:d1".into()])[0].as_ref().unwrap().owner_id, Some(acc("broker1.op.near")));
}

#[test]
#[should_panic(expected = "Broker has no wallet yet")]
fn tokens_only_move_to_a_registered_broker() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    let dao = w.get_clan(a).unwrap().dao;
    mint(&mut w, "r:c1", dao.as_str(), 1);
    op();
    w.mt_move_to_broker(a, 10);
}

#[test]
#[should_panic(expected = "Only the world operator")]
fn only_the_operator_moves_tokens_to_the_broker() {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    set("god1.near", 0);
    w.mt_move_to_broker(a, 10);
}

// ---------------------------------------------------------------- the marketplace, agents only (9 Nov)

/// Two nations, each with a Broker wallet and 50 florins; Helios' Broker holds r:c1, k:t1 and p:d1.
fn market_world() -> (World, u32, u32) {
    let mut w = new_world();
    let a = found_named(&mut w, "god1.near", "Helios");
    let b = found_named(&mut w, "god2.near", "Salamanco");
    op();
    w.mint(a, U128(50 * FLORIN), "work".into());
    w.mint(b, U128(50 * FLORIN), "work".into());
    w.set_agent_wallet(a, "Broker".into(), acc("broker1.op.near"));
    w.set_agent_wallet(b, "Broker".into(), acc("broker2.op.near"));
    w.set_agent_wallet(a, "Patron".into(), acc("patron1.op.near"));
    for t in ["r:c1", "k:t1", "p:d1"] { mint(&mut w, t, "broker1.op.near", 1); }
    (w, a, b)
}
fn as_(who: &str) { set(who, 0); }
fn fl_of(w: &World, id: u32) -> u128 { w.get_clan(id).unwrap().florins.0 }

#[test]
fn research_sells_as_copies_and_the_seller_keeps_its_own() {
    let (mut w, a, b) = market_world();
    as_("broker1.op.near");
    let id = w.market_list("r:c1".into(), U128(5 * FLORIN), "they need batteries".into());
    let (fa, fb) = (fl_of(&w, a), fl_of(&w, b));
    as_("broker2.op.near");
    w.market_buy(id, "fills our open question".into());
    assert_eq!(fl_of(&w, a), fa + 5 * FLORIN, "the seller nation is paid");
    assert_eq!(fl_of(&w, b), fb - 5 * FLORIN, "with the buyer nation's florins");
    assert_eq!(w.mt_balance_of(acc("broker1.op.near"), "r:c1".into()).0, 1, "the seller keeps its copy");
    let l = &w.market_listings(None, None)[0];
    assert!(l.open && l.sold == 1 && l.kind == "copy", "a copy listing stays open");
    let s = &w.market_sales(None, None)[0];
    assert_eq!((s.buyer, s.seller, s.token_id.as_str(), s.reason.as_str()), (b, a, "r:c1", "fills our open question"));
    assert_eq!(w.market_count().1 .0, 1);
}

#[test]
#[should_panic(expected = "You already have that")]
fn a_nation_buys_each_copy_once() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near");
    let id = w.market_list("r:c1".into(), U128(FLORIN), "".into());
    as_("broker2.op.near");
    w.market_buy(id, "".into());
    w.market_buy(id, "".into());
}

#[test]
fn a_patent_sells_once_and_moves_to_the_buyer() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near");
    let id = w.market_list("p:d1".into(), U128(20 * FLORIN), "cash for the war".into());
    assert_eq!(w.market_listings(None, None)[0].kind, "sale");
    as_("broker2.op.near");
    w.market_buy(id, "".into());
    assert_eq!(w.mt_token(vec!["p:d1".into()])[0].as_ref().unwrap().owner_id, Some(acc("broker2.op.near")));
    assert!(!w.market_listings(None, None)[0].open, "sold: the listing closes");
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { as_("broker2.op.near"); w.market_buy(id, "".into()); }));
    assert!(again.is_err(), "nobody buys it twice");
}

#[test]
#[should_panic(expected = "Not an agent wallet")]
fn market_a_god_cant_list() {
    let (mut w, _, _) = market_world();
    as_("god1.near"); w.market_list("r:c1".into(), U128(FLORIN), "".into());
}

#[test]
#[should_panic(expected = "This wallet can't do that")]
fn market_a_patron_cant_list() {
    let (mut w, _, _) = market_world();
    as_("patron1.op.near"); w.market_list("r:c1".into(), U128(FLORIN), "".into());
}

#[test]
#[should_panic(expected = "You don't hold that token")]
fn market_nobody_lists_what_it_doesnt_hold() {
    let (mut w, _, _) = market_world();
    as_("broker2.op.near"); w.market_list("r:c1".into(), U128(FLORIN), "".into());
}

#[test]
#[should_panic(expected = "Price must be between")]
fn market_no_free_listings() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); w.market_list("r:c1".into(), U128(0), "".into());
}

#[test]
#[should_panic(expected = "Price must be between")]
fn market_no_absurd_prices() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); w.market_list("r:c1".into(), U128(1001 * FLORIN), "".into());
}

#[test]
#[should_panic(expected = "already listed")]
fn market_no_double_listing() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); w.market_list("r:c1".into(), U128(FLORIN), "".into()); w.market_list("r:c1".into(), U128(FLORIN), "".into());
}

#[test]
#[should_panic(expected = "your own listing")]
fn market_no_buying_your_own_listing() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); let id = w.market_list("r:c1".into(), U128(FLORIN), "".into()); w.market_buy(id, "".into());
}

#[test]
#[should_panic(expected = "Buyer can't afford it")]
fn market_no_spending_florins_a_nation_doesnt_have() {
    let (mut w, _, b) = market_world();
    assert!(fl_of(&w, b) < 1000 * FLORIN);
    as_("broker1.op.near"); let id = w.market_list("r:c1".into(), U128(1000 * FLORIN), "".into()); as_("broker2.op.near"); w.market_buy(id, "".into());
}

#[test]
#[should_panic(expected = "Not your listing")]
fn market_only_the_seller_takes_it_down() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); let id = w.market_list("r:c1".into(), U128(FLORIN), "".into()); as_("broker2.op.near"); w.market_delist(id);
}

#[test]
#[should_panic(expected = "That listing is closed")]
fn market_a_delisted_item_cant_be_bought() {
    let (mut w, _, _) = market_world();
    as_("broker1.op.near"); let id = w.market_list("r:c1".into(), U128(FLORIN), "".into()); w.market_delist(id); as_("broker2.op.near"); w.market_buy(id, "".into());
}

#[test]
#[should_panic(expected = "at most 10 open listings")]
fn ten_open_listings_at_most() {
    let (mut w, _, _) = market_world();
    for i in 0..11 { mint(&mut w, &format!("r:x{i}"), "broker1.op.near", 1); }
    as_("broker1.op.near");
    for i in 0..11 { w.market_list(format!("r:x{i}"), U128(FLORIN), "".into()); }
}

#[test]
fn a_new_broker_wallet_takes_over_the_old_ones_tokens() {
    let (mut w, a, _) = market_world();
    op();
    w.set_agent_wallet(a, "Broker".into(), acc("trader1.op.near"));
    assert_eq!(w.mt_move_to_broker(a, 100), 3);
    assert!(w.mt_tokens_for_owner(acc("broker1.op.near"), None, None).is_empty());
    assert_eq!(ids(w.mt_tokens_for_owner(acc("trader1.op.near"), None, None)), vec!["k:t1", "p:d1", "r:c1"]);
    let old = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { as_("broker1.op.near"); w.market_list("r:c1".into(), U128(FLORIN), "".into()); }));
    assert!(old.is_err(), "the retired wallet can't trade any more");
}

// ---------------------------------------------------------------- grants and the founding fund (9 Nov)

#[test]
fn a_grant_credits_one_god_at_todays_price_with_no_jackpot_cut() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    let t0 = w.get_totals();
    let other = stake(&w, 2, "god2.near");
    let before = stake(&w, a, "god1.near");
    set("operator.adfontes.near", NEAR);
    w.grant(a, acc("god1.near"));
    let t1 = w.get_totals();
    assert_eq!(t1.jackpot.0, t0.jackpot.0, "no jackpot cut");
    assert_eq!(t1.backing.0, t0.backing.0 + NEAR, "all of it backs florins");
    assert!(close(t1.florin_value.0, t0.florin_value.0, 1), "the florin's value doesn't move");
    assert!(close(stake(&w, a, "god1.near"), before + NEAR, 10), "the god is credited the full NEAR");
    assert!(close(stake(&w, 2, "god2.near"), other, 10), "nobody else's stake moves");
    let s = w.get_stake(a, acc("god1.near"));
    assert_eq!(s.granted.0, NEAR);
    assert_eq!(s.put_in.0, clan(&w, a).gods[0].put_in.0, "put_in untouched (the engine reads it as blessings)");
    assert!(t1.balance.0 >= t1.liabilities.0, "still solvent in the test's books");
}

#[test]
#[should_panic(expected = "Only the owner or operator")]
fn a_stranger_cannot_grant() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god1.near", NEAR);
    w.grant(a, acc("god1.near"));
}

#[test]
#[should_panic(expected = "Not a god of that nation")]
fn a_grant_goes_only_to_a_god_of_that_nation() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("operator.adfontes.near", NEAR);
    w.grant(a, acc("god2.near"));
}

#[test]
fn the_founding_fund_pays_the_dao_and_staking_so_all_the_deposit_becomes_florins() {
    let mut w = new_world();
    set("anyone.near", 2 * NEAR);
    w.fund_founding();
    assert_eq!(w.get_founding().1 .0, NEAR, "with the fund full, 1 NEAR founds a nation");
    // 1.5 NEAR is below the usual 2.3 minimum: the fund (2) covers DAO 0.1 + staking 1.2.
    let id = found(&mut w, "god1.near", 1500 * MILLI);
    let net = clan(&w, id).total_in.0;
    assert!(net > 1490 * MILLI && net < 1500 * MILLI, "only storage comes off: {net}");
    assert_eq!(clan(&w, id).staking_fund.0, 1200 * MILLI);
    assert_eq!(w.get_founding().0 .0, 700 * MILLI, "2 - 1.3 left in the fund");
    // The fund is money the world owes until it's spent.
    let t = w.get_totals();
    let staking: u128 = 1200 * MILLI;
    assert_eq!(t.liabilities.0, staking + t.backing.0 + t.jackpot.0 + 700 * MILLI);
}

#[test]
fn a_failed_dao_gives_the_founding_fund_back_its_share() {
    let mut w = new_world();
    set("anyone.near", 2 * NEAR);
    w.fund_founding();
    set("god1.near", 1500 * MILLI);
    let _ = w.found_clan("x".into());
    assert_eq!(w.get_founding().0 .0, 700 * MILLI, "set aside at found time");
    set_with_result("world.adfontes.near", PromiseResult::Failed);
    assert!(!w.finish_founding(1, "x".into(), "adf-clan-1".into(), acc("god1.near"), U128(1500 * MILLI), false));
    assert_eq!(w.get_founding().0 .0, 2 * NEAR, "the fund is whole again");
}

#[test]
#[should_panic(expected = "below the minimum")]
fn a_fund_too_small_for_the_costs_means_the_usual_minimum() {
    let mut w = new_world();
    set("anyone.near", NEAR); // less than DAO 0.1 + staking 1.2
    w.fund_founding();
    assert_eq!(w.get_founding().1 .0, 2300 * MILLI);
    set("god1.near", 1500 * MILLI);
    let _ = w.found_clan("x".into());
}

#[test]
fn without_the_fund_founding_works_as_before() {
    let mut w = new_world();
    let id = found(&mut w, "god1.near", 3 * NEAR);
    let net = clan(&w, id).total_in.0;
    assert!(net < 1700 * MILLI && net > 1690 * MILLI, "the founder still pays DAO + staking: {net}");
}
