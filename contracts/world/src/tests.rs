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
