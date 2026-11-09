//! The marketplace (his calls 9 Nov): only the agents trade. A nation's Broker lists what it holds
//! (research, figure kits, patents) at a price in florins and buys other nations' listings, always
//! signing from its own wallet. Gods have no part in it.
//!
//!   copy listing (research r:, kits k:): every buyer gets its own copy, the seller keeps theirs,
//!     until the seller takes it down. The copy is minted to the buyer by the engine's token sync on
//!     its next turn (the operator pays that storage, as for every token).
//!   sale listing (patents p:): one buyer; the patent moves to the buyer's Broker at once.
//!
//! The buyer nation's florins go to the seller nation, like any trade. Every sale is logged for the
//! engine, which teaches the buyer what it bought and pays patent royalties. At most 10 open
//! listings per nation keeps the contract's storage small. Raw storage keys ("mk:..."), so adding
//! it changed no stored layout.
use crate::*;
use near_sdk::serde_json;

const MAX_OPEN: u128 = 10;
const PRICE_MAX: u128 = 1_000 * FLORIN; // a sanity cap; the engine keeps prices near prices.mjs

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Listing {
    pub id: u64,
    pub seller: u32,
    pub token_id: String,
    pub price: U128,
    pub kind: String, // "copy" | "sale"
    pub open: bool,
    pub day: u32,
    pub reason: String,
    pub sold: u32,
}

#[near(serializers = [json])]
pub struct Sale {
    pub id: u64,
    pub listing: u64,
    pub buyer: u32,
    pub seller: u32,
    pub token_id: String,
    pub price: U128,
    pub day: u32,
    pub reason: String,
}

fn rd(k: &str) -> Option<String> {
    env::storage_read(k.as_bytes()).and_then(|v| String::from_utf8(v).ok())
}
fn wr(k: &str, v: &str) {
    env::storage_write(k.as_bytes(), v.as_bytes());
}
fn num(k: &str) -> u64 {
    rd(k).and_then(|s| s.parse().ok()).unwrap_or(0)
}
fn listing(id: u64) -> Listing {
    rd(&format!("mk:l:{id}")).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| env::panic_str("No such listing"))
}
fn save(l: &Listing) {
    wr(&format!("mk:l:{}", l.id), &serde_json::to_string(l).unwrap());
}
fn held(owner: &AccountId, token: &str) -> u128 {
    rd(&format!("mt:b:{owner}|{token}")).and_then(|s| s.parse().ok()).unwrap_or(0)
}

#[near]
impl World {
    /// A Broker puts something its nation holds up for sale, from its own wallet.
    pub fn market_list(&mut self, token_id: String, price: U128, reason: String) -> u64 {
        let clan = self.agent_clan("Broker");
        self.live_clan(clan);
        let me = env::predecessor_account_id();
        require!(price.0 > 0 && price.0 <= PRICE_MAX, "Price must be between 0 and 1000 florins");
        require!(held(&me, &token_id) >= 1, "You don't hold that token");
        require!(rd(&format!("mk:k:{clan}|{token_id}")).is_none(), "That's already listed");
        let open = num(&format!("mk:open:{clan}")) as u128;
        require!(open < MAX_OPEN, "A nation can have at most 10 open listings");
        let kind = if token_id.starts_with("p:") { "sale" } else { "copy" };
        let id = num("mk:n");
        let l = Listing { id, seller: clan, token_id: token_id.clone(), price, kind: kind.into(), open: true, day: self.day, reason: reason.chars().take(200).collect(), sold: 0 };
        save(&l);
        wr("mk:n", &(id + 1).to_string());
        wr(&format!("mk:open:{clan}"), &(open + 1).to_string());
        wr(&format!("mk:k:{clan}|{token_id}"), &id.to_string());
        env::log_str(&format!("market list {id} {clan} {token_id} {}", price.0));
        id
    }

    /// The Broker that listed it takes it down.
    pub fn market_delist(&mut self, listing_id: u64) {
        let clan = self.agent_clan("Broker");
        let mut l = listing(listing_id);
        require!(l.seller == clan, "Not your listing");
        require!(l.open, "That listing is already closed");
        self.close(&mut l);
        env::log_str(&format!("market delist {listing_id}"));
    }

    /// A Broker buys another nation's listing, from its own wallet, with its nation's florins.
    pub fn market_buy(&mut self, listing_id: u64, reason: String) -> u64 {
        let buyer = self.agent_clan("Broker");
        let me = env::predecessor_account_id();
        let mut l = listing(listing_id);
        require!(l.open, "That listing is closed");
        require!(l.seller != buyer, "That's your own listing");
        let seller_wallet = World::wallet_of(l.seller, "Broker").unwrap_or_else(|| env::panic_str("The seller has no Broker"));
        require!(held(&seller_wallet, &l.token_id) >= 1, "The seller no longer holds it");
        if l.kind == "copy" {
            require!(held(&me, &l.token_id) == 0 && rd(&format!("mk:b:{buyer}|{}", l.token_id)).is_none(), "You already have that");
        }
        // Pay: the buyer nation's florins to the seller nation (refused if it can't afford it).
        self.move_florins(buyer, l.seller, l.price.0, &format!("market {listing_id}"), "market");
        if l.kind == "sale" {
            crate::mt::transfer_internal(&seller_wallet, &me, &l.token_id, 1, "sold on the market");
            self.close(&mut l);
        } else {
            wr(&format!("mk:b:{buyer}|{}", l.token_id), &listing_id.to_string()); // its copy is minted on the next turn
            l.sold += 1;
            save(&l);
        }
        let id = num("mk:sn");
        let sale = Sale { id, listing: listing_id, buyer, seller: l.seller, token_id: l.token_id.clone(), price: l.price, day: self.day, reason: reason.chars().take(200).collect() };
        wr(&format!("mk:s:{id}"), &serde_json::to_string(&sale).unwrap());
        wr("mk:sn", &(id + 1).to_string());
        env::log_str(&format!("market sale {id} listing {listing_id} {} -> {buyer} {} {}", l.seller, l.token_id, l.price.0));
        id
    }

    // ------------------------------------------------------------ views

    pub fn market_listings(&self, from_index: Option<u64>, limit: Option<u32>) -> Vec<Listing> {
        let n = num("mk:n");
        let from = from_index.unwrap_or(0);
        (from..n.min(from + limit.unwrap_or(100).min(500) as u64)).filter_map(|i| rd(&format!("mk:l:{i}")).and_then(|s| serde_json::from_str(&s).ok())).collect()
    }

    pub fn market_sales(&self, from_index: Option<u64>, limit: Option<u32>) -> Vec<Sale> {
        let n = num("mk:sn");
        let from = from_index.unwrap_or(0);
        (from..n.min(from + limit.unwrap_or(100).min(500) as u64)).filter_map(|i| rd(&format!("mk:s:{i}")).and_then(|s| serde_json::from_str(&s).ok())).collect()
    }

    /// (listings ever made, sales ever made)
    pub fn market_count(&self) -> (U64, U64) {
        (U64(num("mk:n")), U64(num("mk:sn")))
    }
}

impl World {
    fn close(&mut self, l: &mut Listing) {
        l.open = false;
        save(l);
        let open = num(&format!("mk:open:{}", l.seller));
        wr(&format!("mk:open:{}", l.seller), &open.saturating_sub(1).to_string());
        env::storage_remove(format!("mk:k:{}|{}", l.seller, l.token_id).as_bytes());
    }
}
