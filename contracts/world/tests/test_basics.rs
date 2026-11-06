//! Local-chain test: deploy the real wasm, found nothing yet (needs a DAO factory), but check
//! init, config and the operator-only guard against a real NEAR node.

use near_api::{NearToken, Signer};
use near_sdk::serde_json::{Value, json};

#[tokio::test]
async fn deploys_and_guards() -> testresult::TestResult<()> {
    let wasm = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap(),
    )?;

    for name in ["world.sandbox", "operator.sandbox", "stranger.sandbox"] {
        sandbox.create_account(name.parse()?).initial_balance(NearToken::from_near(50)).send().await?;
    }
    near_api::Contract::deploy("world.sandbox".parse()?)
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "owner": "world.sandbox", "operator": "operator.sandbox",
                "treasury": "stranger.sandbox", "dao_factory": "sputnik.sandbox",
                "dao_deposit": "100000000000000000000000",
                "staking_deposit": "1200000000000000000000000",
                "min_found": "2300000000000000000000000"
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    let world = near_api::Contract("world.sandbox".parse()?);
    let cfg: Value = world.call_function("get_config", ()).read_only().fetch_from(&net).await?.data;
    assert_eq!(cfg["operator"], "operator.sandbox");
    assert_eq!(cfg["day"], 0);

    // A stranger can't tick the world.
    let r = world
        .call_function("tick", json!({ "day": 1 }))
        .transaction()
        .with_signer("stranger.sandbox".parse()?, signer.clone())
        .send_to(&net)
        .await?;
    assert!(r.is_failure(), "stranger must not tick");

    // The operator can.
    world
        .call_function("tick", json!({ "day": 1 }))
        .transaction()
        .with_signer("operator.sandbox".parse()?, signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let cfg: Value = world.call_function("get_config", ()).read_only().fetch_from(&net).await?.data;
    assert_eq!(cfg["day"], 1);

    // Nobody but the contract itself can run the founding callback (it would mint a clan).
    let r = world
        .call_function(
            "on_clan_founded",
            json!({ "id": 1, "name": "x", "dao_name": "adf-clan-1", "founder": "stranger.sandbox", "deposit": "3000000000000000000000000" }),
        )
        .transaction()
        .with_signer("stranger.sandbox".parse()?, signer.clone())
        .send_to(&net)
        .await?;
    assert!(r.is_failure(), "callback must be private");
    let clan: Value = world.call_function("get_clan", json!({ "clan_id": 1 })).read_only().fetch_from(&net).await?.data;
    assert!(clan.is_null());
    Ok(())
}
