//! A nation's named account (his call 9 Nov): helios.<world> instead of adf-1-276695713.<factory>.
//! It holds nothing for long: `forward()` sends everything above its own storage cost to the
//! nation's Sputnik DAO. Anyone may call it (the engine does every turn). No keys, no owner, no
//! upgrade: the world deploys it once and the only thing it can ever do is pay the one DAO.
//!
//! Written on NEAR's raw host functions (no SDK) so the code is a few KB and an alias costs ~0.03 NEAR.
#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }

#[allow(dead_code)]
#[link(wasm_import_module = "env")]
extern "C" {
    fn input(register_id: u64);
    fn read_register(register_id: u64, ptr: u64);
    fn register_len(register_id: u64) -> u64;
    fn current_account_id(register_id: u64);
    fn predecessor_account_id(register_id: u64);
    fn account_balance(balance_ptr: u64);
    fn storage_usage() -> u64;
    fn storage_write(key_len: u64, key_ptr: u64, value_len: u64, value_ptr: u64, register_id: u64) -> u64;
    fn storage_read(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
    fn promise_batch_create(account_id_len: u64, account_id_ptr: u64) -> u64;
    fn promise_batch_action_transfer(promise_index: u64, amount_ptr: u64);
    fn value_return(value_len: u64, value_ptr: u64);
    fn panic_utf8(len: u64, ptr: u64) -> !;
    fn log_utf8(len: u64, ptr: u64);
}

const KEY: &[u8] = b"dao";
const BYTE_COST: u128 = 10_000_000_000_000_000_000; // yoctoNEAR per byte of storage (NEAR's rate)
const KEEP: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR kept back for gas headroom
static mut BUF: [u8; 256] = [0; 256];

fn fail(msg: &str) -> ! { unsafe { panic_utf8(msg.len() as u64, msg.as_ptr() as u64) } }

/// Read register 0 into BUF; returns its length (max 256: account ids are at most 64 bytes).
fn reg() -> usize {
    unsafe {
        let n = register_len(0) as usize;
        if n > 256 { fail("too long") }
        read_register(0, core::ptr::addr_of_mut!(BUF) as u64);
        n
    }
}

/// `init` with the DAO account as the raw input bytes (not JSON). Once, and only by the account
/// that created this one (its parent, the world contract).
#[no_mangle]
pub extern "C" fn init() {
    unsafe {
        if storage_read(KEY.len() as u64, KEY.as_ptr() as u64, 1) == 1 { fail("already set") }
        current_account_id(0);
        let mut me = [0u8; 64];
        let m = reg();
        if m > 64 { fail("too long") }
        me[..m].copy_from_slice(&BUF[..m]);
        predecessor_account_id(0);
        let p = reg();
        // The parent: this account is "<name>.<parent>".
        if !(m > p + 1 && me[m - p - 1] == b'.' && me[m - p..m] == BUF[..p]) { fail("only the parent account may set it up") }
        input(0);
        let d = reg();
        if d < 2 || d > 64 { fail("bad DAO account") }
        storage_write(KEY.len() as u64, KEY.as_ptr() as u64, d as u64, core::ptr::addr_of!(BUF) as u64, 1);
    }
}

/// Send everything above this account's own storage cost (and a little gas headroom) to the DAO.
#[no_mangle]
pub extern "C" fn forward() {
    unsafe {
        if storage_read(KEY.len() as u64, KEY.as_ptr() as u64, 0) != 1 { fail("not set up") }
        let d = reg();
        let mut bal = [0u8; 16];
        account_balance(bal.as_mut_ptr() as u64);
        let balance = u128::from_le_bytes(bal);
        let locked = storage_usage() as u128 * BYTE_COST + KEEP;
        if balance <= locked { return; }
        let amount = (balance - locked).to_le_bytes();
        let p = promise_batch_create(d as u64, core::ptr::addr_of!(BUF) as u64);
        promise_batch_action_transfer(p, amount.as_ptr() as u64);
        let msg = b"forwarded to the nation's DAO";
        log_utf8(msg.len() as u64, msg.as_ptr() as u64);
    }
}

/// View: the DAO this account forwards to.
#[no_mangle]
pub extern "C" fn dao() {
    unsafe {
        if storage_read(KEY.len() as u64, KEY.as_ptr() as u64, 0) != 1 { fail("not set up") }
        let d = reg();
        // JSON string so near-api's view call can parse it.
        let mut out = [0u8; 70];
        out[0] = b'"';
        out[1..1 + d].copy_from_slice(&BUF[..d]);
        out[1 + d] = b'"';
        value_return((d + 2) as u64, out.as_ptr() as u64);
    }
}
