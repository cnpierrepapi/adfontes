//! Research, patents and figure kits as NEP-245 multi-tokens (his call 8 Nov), held by each
//! nation's Sputnik DAO. The world contract is the token contract.
//!
//!   r:<corpus id>  a piece of research. Copyable: every nation that learns it holds one copy.
//!   p:<draft id>   a passed patent draft. Supply 1, ever.
//!   k:<tool id>    a figure kit. One copy per nation that has it.
//!
//! The operator mints them as the game happens (and backfills what existed before); holders move
//! them with the standard calls (1 yoctoNEAR attached), a nation's gods through a DAO proposal.
//! Everything lives in raw storage keys ("mt:..."), outside the contract's state struct, so adding
//! it changed no stored layout: no migration, no wipe.
use crate::*;
use near_sdk::serde_json;

const GAS_MT_RESOLVE: Gas = Gas::from_tgas(15);
const GAS_MT_RESERVE: Gas = Gas::from_tgas(30); // kept back from the receiver's call for the resolve
const MT_MINT_MAX: usize = 50; // tokens per mint call

/// One mint: `amount` of `token_id` to `owner_id`; `title` names it the first time it's minted.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct MtMint {
    pub token_id: String,
    pub owner_id: AccountId,
    pub amount: U128,
    pub title: Option<String>,
}

/// NEP-245 Token. owner_id is set for one-of-a-kind tokens (patents), null for copyable ones.
#[near(serializers = [json])]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

/// What the world records about a token (mt_token_info, not part of the standard).
#[near(serializers = [json])]
pub struct MtInfo {
    pub token_id: String,
    pub kind: String,
    pub title: String,
    pub supply: U128,
    pub owner_id: Option<AccountId>,
}

fn rd(k: &str) -> Option<String> {
    env::storage_read(k.as_bytes()).and_then(|v| String::from_utf8(v).ok())
}
fn wr(k: &str, v: &str) {
    env::storage_write(k.as_bytes(), v.as_bytes());
}
fn rm(k: &str) {
    env::storage_remove(k.as_bytes());
}
fn num(k: &str) -> u128 {
    rd(k).and_then(|s| s.parse().ok()).unwrap_or(0)
}
fn kind_of(token_id: &str) -> &'static str {
    match token_id.split_once(':').map(|x| x.0) {
        Some("r") => "research",
        Some("p") => "patent",
        Some("k") => "kit",
        _ => env::panic_str("Token ids start with r:, p: or k:"),
    }
}
fn bal_key(owner: &AccountId, token: &str) -> String {
    format!("mt:b:{owner}|{token}")
}
fn event(name: &str, data: serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "nep245", "version": "1.0.0", "event": name, "data": [data] })));
}

/// The owner's token list (for mt_tokens_for_owner): append on first holding, swap-remove at zero.
fn owner_add(owner: &AccountId, token: &str) {
    let n = num(&format!("mt:on:{owner}"));
    wr(&format!("mt:oi:{owner}:{n}"), token);
    wr(&format!("mt:op:{owner}|{token}"), &n.to_string());
    wr(&format!("mt:on:{owner}"), &(n + 1).to_string());
}
fn owner_remove(owner: &AccountId, token: &str) {
    let n = num(&format!("mt:on:{owner}"));
    let Some(i) = rd(&format!("mt:op:{owner}|{token}")) else { return };
    let last = n - 1;
    if i != last.to_string() {
        let moved = rd(&format!("mt:oi:{owner}:{last}")).unwrap_or_default();
        wr(&format!("mt:oi:{owner}:{i}"), &moved);
        wr(&format!("mt:op:{owner}|{moved}"), &i);
    }
    rm(&format!("mt:oi:{owner}:{last}"));
    rm(&format!("mt:op:{owner}|{token}"));
    wr(&format!("mt:on:{owner}"), &last.to_string());
}
fn add_balance(owner: &AccountId, token: &str, amount: u128) {
    let k = bal_key(owner, token);
    let b = num(&k);
    if b == 0 {
        owner_add(owner, token);
    }
    wr(&k, &(b + amount).to_string());
}
fn take_balance(owner: &AccountId, token: &str, amount: u128) {
    let k = bal_key(owner, token);
    let b = num(&k);
    require!(amount > 0, "Amount must be at least 1");
    require!(b >= amount, "Not enough of that token");
    if b == amount {
        rm(&k);
        owner_remove(owner, token);
    } else {
        wr(&k, &(b - amount).to_string());
    }
}

/// Move tokens between holders (checked), with the owner of one-of-a-kind tokens kept in step.
fn move_tokens(from: &AccountId, to: &AccountId, tokens: &[String], amounts: &[U128], memo: Option<String>) {
    require!(from != to, "Sender and receiver are the same");
    require!(!tokens.is_empty() && tokens.len() == amounts.len(), "token_ids and amounts must match");
    for (t, a) in tokens.iter().zip(amounts) {
        require!(rd(&format!("mt:t:{t}")).is_some(), "No such token");
        take_balance(from, t, a.0);
        add_balance(to, t, a.0);
        if kind_of(t) == "patent" {
            wr(&format!("mt:h:{t}"), to.as_str());
        }
    }
    event("mt_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": tokens,
        "amounts": amounts.iter().map(|a| a.0.to_string()).collect::<Vec<_>>(), "memo": memo }));
}

/** Move tokens from one holder to another inside the contract (the market's patent sales). */
pub(crate) fn transfer_internal(from: &AccountId, to: &AccountId, token: &str, amount: u128, memo: &str) {
    move_tokens(from, to, &[token.to_string()], &[U128(amount)], Some(memo.to_string()));
}

#[near]
impl World {
    // ------------------------------------------------------------ minting (the world, as the game happens)

    /// The operator mints what the game made: clean research, a buyer's copy, a passed patent, a kit.
    /// A patent can only ever be minted once, as one. The operator pays the storage the mint adds
    /// (attach enough; the rest comes back), so tokens never eat into the NEAR the world owes its gods.
    #[payable]
    pub fn mt_mint_batch(&mut self, mints: Vec<MtMint>, memo: Option<String>) {
        require!(env::predecessor_account_id() == self.operator, "Only the world operator");
        let before = env::storage_usage();
        require!(!mints.is_empty() && mints.len() <= MT_MINT_MAX, "Mint 1 to 50 tokens per call");
        for m in &mints {
            let t = &m.token_id;
            require!(t.len() <= 64, "Token id too long");
            let kind = kind_of(t);
            require!(m.amount.0 > 0, "Amount must be at least 1");
            let supply = num(&format!("mt:s:{t}"));
            if rd(&format!("mt:t:{t}")).is_none() {
                // First mint: record it and add it to the list of every token.
                let title: String = m.title.clone().unwrap_or_default().chars().take(120).collect();
                wr(&format!("mt:t:{t}"), &json!({ "kind": kind, "title": title }).to_string());
                let n = num("mt:n");
                wr(&format!("mt:i:{n}"), t);
                wr("mt:n", &(n + 1).to_string());
            }
            if kind == "patent" {
                require!(supply == 0 && m.amount.0 == 1, "A patent is one of a kind");
                wr(&format!("mt:h:{t}"), m.owner_id.as_str());
            }
            wr(&format!("mt:s:{t}"), &(supply + m.amount.0).to_string());
            add_balance(&m.owner_id, t, m.amount.0);
            event("mt_mint", json!({ "owner_id": m.owner_id, "token_ids": [t], "amounts": [m.amount.0.to_string()], "memo": memo }));
        }
        let cost = (env::storage_usage().saturating_sub(before)) as u128 * env::storage_byte_cost().as_yoctonear();
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= cost, format!("Attach {cost} yoctoNEAR for the storage these tokens take"));
        if paid > cost {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(paid - cost)).detach();
        }
    }

    /// His call 9 Nov: a nation's tokens are the agents' to trade, so they live in its Broker's
    /// wallet, not its DAO. The operator moves what a nation's DAO holds, or what its previous Broker
    /// wallet holds (a Broker that got a new wallet), into that same nation's current Broker wallet,
    /// nowhere else, up to `limit` kinds a call. Returns how many moved.
    pub fn mt_move_to_broker(&mut self, clan_id: u32, limit: u32) -> u32 {
        require!(env::predecessor_account_id() == self.operator, "Only the world operator");
        let clan = self.clans.get(&clan_id).expect("No such clan").clone();
        let broker = World::wallet_of(clan_id, "Broker").unwrap_or_else(|| env::panic_str("That nation's Broker has no wallet yet"));
        let prev: Option<AccountId> = rd(&format!("aw:prev:{clan_id}:Broker")).and_then(|s| s.parse().ok());
        for from in [Some(clan.dao.clone()), prev].into_iter().flatten() {
            if from == broker { continue; }
            let n = num(&format!("mt:on:{from}")).min(limit.min(100) as u128);
            let tokens: Vec<String> = (0..n).filter_map(|i| rd(&format!("mt:oi:{from}:{i}"))).collect();
            if tokens.is_empty() { continue; }
            let amounts: Vec<U128> = tokens.iter().map(|t| U128(num(&bal_key(&from, t)))).collect();
            move_tokens(&from, &broker, &tokens, &amounts, Some("to the Broker's wallet".into()));
            return tokens.len() as u32;
        }
        0
    }

    // ------------------------------------------------------------ NEP-245 core: transfers

    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "This contract has no approvals: holders transfer their own tokens");
        move_tokens(&env::predecessor_account_id(), &receiver_id, &[token_id], &[amount], memo);
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(approvals.map(|a| a.iter().all(|x| x.is_none())).unwrap_or(true), "This contract has no approvals: holders transfer their own tokens");
        move_tokens(&env::predecessor_account_id(), &receiver_id, &token_ids, &amounts, memo);
    }

    #[payable]
    pub fn mt_transfer_call(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>, msg: String) -> Promise {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "This contract has no approvals: holders transfer their own tokens");
        self.transfer_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>, msg: String) -> Promise {
        near_sdk::assert_one_yocto();
        require!(approvals.map(|a| a.iter().all(|x| x.is_none())).unwrap_or(true), "This contract has no approvals: holders transfer their own tokens");
        self.transfer_call(receiver_id, token_ids, amounts, memo, msg)
    }

    /// After the receiver's mt_on_transfer: it says how much of each it didn't use; that goes back
    /// to the sender (as much as the receiver still holds). If the receiver failed, all of it goes
    /// back. Returns how much of each the receiver kept.
    #[private]
    pub fn mt_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) -> Vec<U128> {
        let unused: Vec<u128> = match env::promise_result_checked(0, 2_000) {
            Ok(bytes) => serde_json::from_slice::<Vec<U128>>(&bytes)
                .ok()
                .filter(|v| v.len() == amounts.len())
                .map(|v| v.iter().zip(&amounts).map(|(u, a)| u.0.min(a.0)).collect())
                .unwrap_or_else(|| amounts.iter().map(|a| a.0).collect()),
            Err(_) => amounts.iter().map(|a| a.0).collect(),
        };
        let mut kept = Vec::new();
        let (mut back_t, mut back_a) = (Vec::new(), Vec::new());
        for ((t, a), u) in token_ids.iter().zip(&amounts).zip(unused) {
            let back = u.min(num(&bal_key(&receiver_id, t)));
            if back > 0 {
                back_t.push(t.clone());
                back_a.push(U128(back));
            }
            kept.push(U128(a.0 - back));
        }
        if !back_t.is_empty() {
            move_tokens(&receiver_id, &sender_id, &back_t, &back_a, Some("refund".into()));
        }
        kept
    }

    // ------------------------------------------------------------ NEP-245 core: views

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids.into_iter().map(|t| {
            rd(&format!("mt:t:{t}"))?;
            let owner_id = rd(&format!("mt:h:{t}")).and_then(|s| s.parse().ok());
            Some(MtToken { token_id: t, owner_id })
        }).collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(num(&bal_key(&account_id, &token_id)))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(num(&bal_key(&account_id, t)))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        rd(&format!("mt:t:{token_id}")).map(|_| U128(num(&format!("mt:s:{token_id}"))))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    // ------------------------------------------------------------ NEP-245 enumeration

    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<MtToken> {
        let n = num("mt:n");
        let from = from_index.map(|x| x.0).unwrap_or(0);
        let lim = limit.unwrap_or(100).min(500) as u128;
        (from..n.min(from.saturating_add(lim)))
            .filter_map(|i| rd(&format!("mt:i:{i}")))
            .map(|t| MtToken { owner_id: rd(&format!("mt:h:{t}")).and_then(|s| s.parse().ok()), token_id: t })
            .collect()
    }

    pub fn mt_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u32>) -> Vec<MtToken> {
        let n = num(&format!("mt:on:{account_id}"));
        let from = from_index.map(|x| x.0).unwrap_or(0);
        let lim = limit.unwrap_or(100).min(500) as u128;
        (from..n.min(from.saturating_add(lim)))
            .filter_map(|i| rd(&format!("mt:oi:{account_id}:{i}")))
            .map(|t| MtToken { owner_id: rd(&format!("mt:h:{t}")).and_then(|s| s.parse().ok()), token_id: t })
            .collect()
    }

    /// What a token is (not part of the standard): kind, title, supply and, for a patent, its holder.
    pub fn mt_token_info(&self, token_id: String) -> Option<MtInfo> {
        let meta: serde_json::Value = serde_json::from_str(&rd(&format!("mt:t:{token_id}"))?).ok()?;
        Some(MtInfo {
            kind: meta["kind"].as_str().unwrap_or("").to_string(),
            title: meta["title"].as_str().unwrap_or("").to_string(),
            supply: U128(num(&format!("mt:s:{token_id}"))),
            owner_id: rd(&format!("mt:h:{token_id}")).and_then(|s| s.parse().ok()),
            token_id,
        })
    }

    /// How many token kinds exist (for paging mt_tokens).
    pub fn mt_count(&self) -> U128 {
        U128(num("mt:n"))
    }
}

impl World {
    fn transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>, msg: String) -> Promise {
        let sender = env::predecessor_account_id();
        move_tokens(&sender, &receiver_id, &token_ids, &amounts, memo);
        let gas = env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(GAS_MT_RESERVE).saturating_sub(GAS_MT_RESOLVE);
        let args = json!({ "sender_id": sender, "previous_owner_ids": vec![sender.clone(); token_ids.len()], "token_ids": token_ids,
            "amounts": amounts, "msg": msg });
        Promise::new(receiver_id.clone())
            .function_call("mt_on_transfer".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(0), gas)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_MT_RESOLVE).mt_resolve_transfer(sender, receiver_id, token_ids, amounts))
    }
}
