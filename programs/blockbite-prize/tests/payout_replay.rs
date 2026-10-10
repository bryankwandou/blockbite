//! Replays QA payout scenarios written by scripts/qa-payout-scenarios.ts
//! (tests/fixtures/qa-payout/*.txt) against the compiled prize program in
//! LiteSVM, with the real SPL Token + ATA programs, at the real program id,
//! USDC mint, vault and state addresses (signature verification off, like
//! prize.rs). Every instruction comes from the TypeScript code that runs in
//! production (lib/ranked/*, lib/solana/usdc.ts); this file only executes them
//! and checks the TS side's expectations plus its own invariant (the vault
//! never holds less than the state's `reserved`).
//!
//!   cargo build-sbf --arch v3 --manifest-path programs/blockbite-prize/Cargo.toml
//!   npx tsx --import ./scripts/pglite-neon-shim.ts scripts/qa-payout-scenarios.ts
//!   cargo test --manifest-path programs/blockbite-prize/Cargo.toml --test payout_replay -- --nocapture

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const PID: Address = Address::from_str_const("4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn");
const USDC: Address = Address::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const VAULT_AUTH: Address = Address::from_str_const("5Dpz47x9QHTdbgYWD6KA2tanbKbag7xp4c2NoVEV13DS");
const VAULT: Address = Address::from_str_const("9Pd853EqvQgNc2t4wAsXmTcynsEj6LWpKQiAbprpMqmj");
const STATE: Address = Address::from_str_const("FQBH9iXq8MqEh1pBcwa7kfEoYTXXyvxKSQgJz56BdBZw");
const POSTER: Address = Address::from_str_const("BDpy3zpYyQRvz8bFngN6tCvx2rk6PA1jtsWSo5FfoBgP");
const TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return vec![];
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex")).collect()
}

fn ix_of(f: &[&str]) -> Instruction {
    let metas = f[2..]
        .iter()
        .map(|m| {
            let (key, flags) = m.split_once(':').expect("meta");
            let key = Address::from_str_const(key);
            match flags {
                "sw" => AccountMeta::new(key, true),
                "s-" => AccountMeta::new_readonly(key, true),
                "-w" => AccountMeta::new(key, false),
                "--" => AccountMeta::new_readonly(key, false),
                f => panic!("bad flags {f}"),
            }
        })
        .collect();
    Instruction::new_with_bytes(Address::from_str_const(f[0]), &unhex(f[1]), metas)
}

fn token_account(owner: &Address, amount: u64) -> Account {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(USDC.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    Account { lamports: 2_039_280, data: d, owner: TOKEN, executable: false, rent_epoch: 0 }
}

fn bal(svm: &LiteSVM, a: &Address) -> u64 {
    svm.get_account(a).map(|x| u64::from_le_bytes(x.data[64..72].try_into().unwrap())).unwrap_or(0)
}

fn reserved(svm: &LiteSVM) -> u64 {
    svm.get_account(&STATE).map(|x| u64::from_le_bytes(x.data[8..16].try_into().unwrap())).unwrap_or(0)
}

fn run(path: &std::path::Path) -> usize {
    let mut svm = LiteSVM::new().with_sigverify(false);
    let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/blockbite_prize.so")).expect("cargo build-sbf first");
    svm.add_program(PID, &so).unwrap();
    let mut m = vec![0u8; 82];
    m[44] = 6;
    m[45] = 1;
    svm.set_account(USDC, Account { lamports: 1_461_600, data: m, owner: TOKEN, executable: false, rent_epoch: 0 }).unwrap();
    svm.set_account(VAULT, token_account(&VAULT_AUTH, 0)).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&POSTER, 1_000_000_000).unwrap();

    let text = std::fs::read_to_string(path).unwrap();
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let mut checks = 0;
    let mut cur: Option<(String, String, Vec<Instruction>)> = None;
    for (n, line) in text.lines().enumerate().map(|(i, l)| (i + 1, l)) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.is_empty() || f[0].starts_with('#') {
            continue;
        }
        let at = format!("{name}:{n}");
        match f[0] {
            "time" => {
                let mut c: Clock = svm.get_sysvar();
                c.unix_timestamp = f[1].parse().unwrap();
                c.slot += 1;
                svm.set_sysvar(&c);
                svm.expire_blockhash();
            }
            "fund" => {
                svm.airdrop(&Address::from_str_const(f[1]), f[2].parse().unwrap()).unwrap();
            }
            "usdc" => {
                svm.set_account(Address::from_str_const(f[1]), token_account(&Address::from_str_const(f[2]), f[3].parse().unwrap())).unwrap();
            }
            "tx" => cur = Some((f[1].to_string(), f[2..].join(" "), vec![])),
            "ix" => cur.as_mut().expect("ix outside tx").2.push(ix_of(&f[1..])),
            "end" => {
                let (expect, label, ixs) = cur.take().expect("end outside tx");
                let msg = Message::new(&ixs, Some(&payer.pubkey()));
                let mut tx = Transaction::new_unsigned(msg);
                tx.partial_sign(&[&payer], svm.latest_blockhash());
                let r = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err));
                svm.expire_blockhash();
                match (expect.as_str(), &r) {
                    ("ok", Ok(())) => {}
                    ("err", Err(_)) => {}
                    (e, Err(err)) if e.starts_with("err:") => {
                        assert!(err.contains(&format!("Custom({})", &e[4..])), "{at} [{label}]: wanted {e}, got {err}");
                    }
                    (e, r) => panic!("{at} [{label}]: wanted {e}, got {r:?}"),
                }
                checks += 1;
                assert!(bal(&svm, &VAULT) >= reserved(&svm), "{at} [{label}]: vault {} < reserved {}", bal(&svm, &VAULT), reserved(&svm));
            }
            "expect_bal" => {
                let got = bal(&svm, &Address::from_str_const(f[1]));
                assert_eq!(got, f[2].parse::<u64>().unwrap(), "{at}: balance of {}", f[1]);
                checks += 1;
            }
            "expect_vault" => {
                assert_eq!(bal(&svm, &VAULT), f[1].parse::<u64>().unwrap(), "{at}: vault");
                checks += 1;
            }
            "expect_reserved" => {
                assert_eq!(reserved(&svm), f[1].parse::<u64>().unwrap(), "{at}: reserved");
                checks += 1;
            }
            "expect_closed" => {
                let a = svm.get_account(&Address::from_str_const(f[1]));
                assert!(a.map(|x| x.lamports == 0 || x.data.is_empty()).unwrap_or(true), "{at}: {} not closed", f[1]);
                checks += 1;
            }
            "expect_state" => {
                // expect_state <byte offset> <u64>: high-water marks
                let d = svm.get_account(&STATE).unwrap().data;
                let o: usize = f[1].parse().unwrap();
                assert_eq!(u64::from_le_bytes(d[o..o + 8].try_into().unwrap()), f[2].parse::<u64>().unwrap(), "{at}: state[{o}]");
                checks += 1;
            }
            t => panic!("{at}: unknown op {t}"),
        }
    }
    checks
}

#[test]
fn replay_all_qa_scenarios() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/qa-payout");
    let mut files: Vec<_> = std::fs::read_dir(&dir).expect("run scripts/qa-payout-scenarios.ts first").map(|e| e.unwrap().path()).collect();
    files.retain(|p| p.extension().map(|e| e == "txt").unwrap_or(false));
    files.sort();
    assert!(!files.is_empty());
    let mut total = 0;
    for f in &files {
        let n = run(f);
        println!("{}: {n} checks passed", f.file_name().unwrap().to_string_lossy());
        total += n;
    }
    println!("TOTAL {total} checks in {} scenarios", files.len());
}
