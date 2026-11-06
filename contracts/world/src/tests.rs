//! Unit tests: one per money rule in SPEC §6b / §12b. Amounts in NEAR unless noted.

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1000;

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
        acc("treasury.adfontes.near"),
        acc("sputnik-dao.near"),
        U128(100 * MILLI),  // DAO 0.1
        U128(1200 * MILLI), // staking 1.2
        U128(2300 * MILLI), // minimum to found 2.3
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

#[test]
fn founding_pays_costs_then_splits_86_14() {
    let mut w = new_world();
    let id = found(&mut w, "god1.near", 3 * NEAR);
    let c = clan(&w, id);
    let net = c.total_in.0;
    // 3 - 0.1 DAO - 1.2 staking = 1.7, less a little storage.
    assert!(net < 1700 * MILLI && net > 1690 * MILLI, "net {net}");
    assert_eq!(c.play.0, net * 86 / 100);
    assert_eq!(c.play.0 + c.reserve.0, net);
    assert_eq!(c.staking_fund.0, 1200 * MILLI);
    assert_eq!(c.dao, acc("adf-clan-1.sputnik-dao.near"));
    assert_eq!(c.gods.len(), 1);
}

#[test]
#[should_panic(expected = "below the minimum")]
fn founding_below_minimum_refused() {
    let mut w = new_world();
    set("god1.near", 2 * NEAR);
    let _ = w.found_clan("x".into());
}

#[test]
fn failed_dao_means_no_clan() {
    let mut w = new_world();
    set("god1.near", 3 * NEAR);
    let _ = w.found_clan("x".into());
    set_with_result("world.adfontes.near", PromiseResult::Failed);
    assert!(!w.finish_founding(1, "x".into(), "adf-clan-1".into(), acc("god1.near"), U128(3 * NEAR), false));
    assert!(w.get_clan(1).is_none());
}

// "Only the contract can run the callback" (#[private]) is enforced on chain only; it's in
// tests/test_basics.rs.

#[test]
fn big_clans_withdraw_without_overflow() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god2.near", 500 * NEAR);
    w.bless(a);
    set("god1.near", 400 * NEAR);
    w.bless(a);
    set("god2.near", 0);
    let _ = w.withdraw(a);
    assert!(clan(&w, a).alive);
}

#[test]
fn spec_example_10_in_4_spent_fee_056() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    // Bless clan b with exactly 10 NEAR from its existing god (no new storage).
    set("god2.near", 10 * NEAR);
    w.bless(b);
    let before = clan(&w, b);
    set("operator.adfontes.near", 0);
    w.trade(b, a, U128(4 * NEAR), "corpus".into());
    let after = clan(&w, b);
    assert_eq!(before.play.0 - after.play.0, 4 * NEAR);
    assert_eq!(after.fee_due.0, 560 * MILLI); // 14% of 4
    let _ = w.sweep_fees();
    let swept = clan(&w, b);
    assert_eq!(after.reserve.0 - swept.reserve.0, 560 * MILLI);
    assert_eq!(swept.fee_due.0, 0);
}

#[test]
fn seller_income_splits_86_14() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let s0 = clan(&w, a);
    set("operator.adfontes.near", 0);
    w.trade(b, a, U128(NEAR), "tool".into());
    let s1 = clan(&w, a);
    assert_eq!(s1.play.0 - s0.play.0, 860 * MILLI);
    assert_eq!(s1.reserve.0 - s0.reserve.0, 140 * MILLI);
    assert_eq!(s1.fee_due.0, 0, "the seller owes no fee");
}

#[test]
#[should_panic(expected = "inside your own clan")]
fn buying_inside_your_clan_is_not_a_trade() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("operator.adfontes.near", 0);
    w.trade(a, a, U128(NEAR / 10), "x".into());
}

#[test]
#[should_panic(expected = "Only the world operator")]
fn only_operator_trades() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    set("god1.near", 0);
    w.trade(b, a, U128(1), "x".into());
}

#[test]
fn upkeep_is_burned_and_counts_as_spend() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let p0 = clan(&w, a).play.0;
    set("operator.adfontes.near", 0);
    let paid = w.upkeep(a, U128(300 * MILLI));
    assert_eq!(paid.0, 300 * MILLI);
    let c = clan(&w, a);
    assert_eq!(p0 - c.play.0, 300 * MILLI);
    assert_eq!(c.fee_due.0, 42 * MILLI);
    assert_eq!(w.get_totals().burned.0, 300 * MILLI);
}

#[test]
fn starving_clan_pays_what_it_has() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let p0 = clan(&w, a).play.0;
    set("operator.adfontes.near", 0);
    let paid = w.upkeep(a, U128(100 * NEAR));
    assert_eq!(paid.0, p0);
    assert_eq!(clan(&w, a).play.0, 0);
}

#[test]
fn withdraw_pays_shares_and_last_god_kills_the_clan() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    // A second god joins with 2 NEAR (pays its own storage).
    set("god2.near", 2 * NEAR);
    w.bless(a);
    let c = clan(&w, a);
    assert_eq!(c.gods.len(), 2);
    let g2_in = c.gods[1].put_in.0;
    let pot = c.play.0 + c.reserve.0;

    set("god2.near", 0);
    let _ = w.withdraw(a);
    let c2 = clan(&w, a);
    assert!(c2.alive, "clan lives while a god remains");
    assert_eq!(c2.gods.len(), 1);
    let paid_g2 = pot - (c2.play.0 + c2.reserve.0);
    let expect = mul_div(pot, g2_in, c.total_in.0);
    assert!(paid_g2.abs_diff(expect) <= 2, "paid {paid_g2} expected {expect}");

    set("god1.near", 0);
    let _ = w.withdraw(a);
    let c3 = clan(&w, a);
    assert!(!c3.alive);
    assert_eq!(c3.play.0 + c3.reserve.0 + c3.staking_fund.0, 0, "last god takes everything");
}

#[test]
fn withdraw_settles_the_fee_first() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    set("operator.adfontes.near", 0);
    w.trade(b, a, U128(NEAR), "x".into());
    set("god2.near", 0);
    let _ = w.withdraw(b);
    assert_eq!(w.get_totals().fees_pending.0, 140 * MILLI);
}

#[test]
#[should_panic(expected = "Only a god of this clan")]
fn strangers_cannot_withdraw() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("thief.near", 0);
    let _ = w.withdraw(a);
}

#[test]
fn agent_names_are_unique_forever() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    set("operator.adfontes.near", 0);
    w.spawn_agent(a, "Ilse Varga".into(), Role::Scholar);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("operator.adfontes.near", 0);
        w.spawn_agent(b, "Ilse Varga".into(), Role::Smith);
    }));
    assert!(r.is_err(), "same name in another clan must fail");
}

fn gift_setup() -> (World, u32, u64) {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let _b = found(&mut w, "god2.near", 3 * NEAR);
    set("operator.adfontes.near", 0);
    w.spawn_agent(a, "Odo Brann".into(), Role::Drafter);
    let g = w.gift(a, "ab".repeat(32), true, 2);
    (w, a, g)
}

#[test]
fn dao_stunts_for_3_days_and_kills() {
    let (mut w, a, g) = gift_setup();
    set("operator.adfontes.near", 0);
    w.tick(5);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.rule(g, false, Some(Verdict::Stunt), Some("Odo Brann".into()));
    assert_eq!(w.get_agent("Odo Brann".into()).unwrap().stunted_until, 8);
    assert_eq!(w.get_gift(g).unwrap().status, GiftStatus::Punished);
    assert_eq!(clan(&w, a).clean_gifts, 1);

    set("operator.adfontes.near", 0);
    let g2 = w.gift(a, "cd".repeat(32), false, a);
    set("adf-clan-1.sputnik-dao.near", 0);
    w.rule(g2, false, Some(Verdict::Kill), Some("Odo Brann".into()));
    assert!(!w.get_agent("Odo Brann".into()).unwrap().alive);
    assert_eq!(clan(&w, a).clean_gifts, 1, "failed gifts don't count");
}

#[test]
#[should_panic(expected = "Only the clan's DAO")]
fn only_the_dao_rules() {
    let (mut w, _a, g) = gift_setup();
    set("god1.near", 0);
    w.rule(g, true, None, None);
}

#[test]
fn unruled_gift_goes_to_top_contributor_after_24h() {
    let (mut w, _a, g) = gift_setup();
    // Too early.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set("god2.near", 0);
        w.claim_gift(g);
    }));
    assert!(r.is_err());
    // After 24h, a god of the contributing clan (2) can claim.
    let mut c = ctx("god2.near", 0);
    c.block_timestamp(GIFT_WINDOW_NS + 1);
    testing_env!(c.build());
    w.claim_gift(g);
    let gift = w.get_gift(g).unwrap();
    assert_eq!(gift.status, GiftStatus::Claimed);
    assert_eq!(gift.ruled_by, Some(acc("god2.near")));
}

#[test]
fn liabilities_add_up() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let b = found(&mut w, "god2.near", 3 * NEAR);
    let before = w.get_totals().liabilities.0;
    set("operator.adfontes.near", 0);
    w.trade(b, a, U128(NEAR), "x".into());
    let _ = w.sweep_fees();
    // A trade moves money between clans; the fee leaves the clans for the treasury.
    assert_eq!(before - w.get_totals().liabilities.0, 140 * MILLI);
}

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
    // A DAO someone registered under the name first: different god, or not our world.
    assert!(!policy_is_ours(&policy("squatter.near", "world.adfontes.near"), &god));
    assert!(!policy_is_ours(&policy("god1.near", "squatter.near"), &god));
    // Garbage or an empty reply never panics; it means refund.
    assert!(!policy_is_ours(b"", &god));
    assert!(!policy_is_ours(b"true", &god));
    assert!(!policy_is_ours(b"{\"roles\":42}", &god));
}

#[test]
fn warden_bounty_goes_to_the_treasury() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    let p0 = clan(&w, a).play.0;
    set("operator.adfontes.near", 0);
    let paid = w.bounty(a, U128(200 * MILLI), "fake citation".into());
    assert_eq!(paid.0, 200 * MILLI);
    assert_eq!(p0 - clan(&w, a).play.0, 200 * MILLI);
    assert_eq!(w.get_totals().fees_pending.0, 200 * MILLI);
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
        w.set_config(None, None, None, None, Some(U128(5 * NEAR)));
    }));
    assert!(r.is_err(), "old owner is out");
}

#[test]
fn leaving_god_pays_the_removal_bond_last_god_does_not() {
    let mut w = new_world();
    let a = found(&mut w, "god1.near", 3 * NEAR);
    set("god2.near", 2 * NEAR);
    let _ = w.bless(a);
    let before = w.get_totals().liabilities.0;
    let c = clan(&w, a);
    let share = mul_div(c.play.0 + c.reserve.0, c.gods[1].put_in.0, c.total_in.0);
    set("god2.near", 0);
    let _ = w.withdraw(a);
    // The god's share left the clan; bond is paid out of it (so the clan doesn't pay).
    assert!((before - w.get_totals().liabilities.0).abs_diff(share) <= 2);
}

#[test]
fn pause_stops_new_money_but_never_withdrawals() {
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
    set("operator.adfontes.near", 0);
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
