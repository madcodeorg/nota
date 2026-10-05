use std::{
  fmt::Write,
  time::{Duration, Instant},
};

use chrono::{DateTime, NaiveDateTime, Utc};
use napi::{Env, Error, Result, Status, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use rand::distr::{Alphanumeric, SampleString};
use sha3::{Digest, Sha3_256};

const DEFAULT_BITS: u32 = 20;
const MAX_BITS: u32 = 24;
const MAX_AGE_SECONDS: i64 = 300;
const CLOCK_SKEW_SECONDS: i64 = 30;
const MAX_RESOURCE_BYTES: usize = 1024;
const MAX_STAMP_BYTES: usize = 2048;
const MAX_MINT_TIME: Duration = Duration::from_secs(30);
const DATE_FORMAT: &str = "%Y%m%d%H%M%S";

fn valid_bits(bits: u32) -> bool {
  (1..=MAX_BITS).contains(&bits)
}

fn valid_resource(resource: &str) -> bool {
  !resource.is_empty() && resource.len() <= MAX_RESOURCE_BYTES && !resource.chars().any(|c| c == ':' || c.is_control())
}

fn has_proof(hash: &[u8], bits: u32) -> bool {
  let mut remaining = bits;
  for &byte in hash {
    if remaining <= byte.leading_zeros() {
      return true;
    }
    if byte != 0 {
      return false;
    }
    remaining -= 8;
  }
  remaining == 0
}

fn verify_stamp(response: &str, bits: u32, resource: &str, now: DateTime<Utc>) -> bool {
  if !valid_bits(bits) || !valid_resource(resource) || response.len() > MAX_STAMP_BYTES {
    return false;
  }

  let mut parts = response.split(':');
  let [
    Some(version),
    Some(claimed_bits),
    Some(date),
    Some(stamped_resource),
    Some(extension),
    Some(nonce),
    Some(counter),
  ] = std::array::from_fn::<_, 7, _>(|_| parts.next())
  else {
    return false;
  };
  if parts.next().is_some()
    || version != "1"
    || claimed_bits.is_empty()
    || !claimed_bits.bytes().all(|b| b.is_ascii_digit())
    || claimed_bits.parse::<u32>().ok() != Some(bits)
    || stamped_resource != resource
    || !extension.is_empty()
    || date.len() != 14
    || !date.bytes().all(|b| b.is_ascii_digit())
    || nonce.is_empty()
    || nonce.len() > 128
    || !nonce.bytes().all(|b| b.is_ascii_alphanumeric())
  {
    return false;
  }

  // Counters are wire text, not numbers: preserve decimal and hex encodings.
  let counter_digits = counter
    .strip_prefix("0x")
    .or_else(|| counter.strip_prefix("0X"))
    .unwrap_or(counter);
  if counter_digits.is_empty() || counter.len() > 64 || !counter_digits.bytes().all(|b| b.is_ascii_hexdigit()) {
    return false;
  }
  let Ok(timestamp) = NaiveDateTime::parse_from_str(date, DATE_FORMAT) else {
    return false;
  };
  let age = now.timestamp() - timestamp.and_utc().timestamp();
  if !(-CLOCK_SKEW_SECONDS..=MAX_AGE_SECONDS).contains(&age) {
    return false;
  }

  has_proof(&Sha3_256::digest(response.as_bytes()), bits)
}

fn mint_stamp(resource: &str, bits: u32) -> Result<String> {
  if !valid_bits(bits) || !valid_resource(resource) {
    return Err(Error::new(
      Status::InvalidArg,
      "Hashcash requires 1-24 bits and a nonempty resource of at most 1024 bytes without colons or control characters",
    ));
  }
  let nonce = Alphanumeric.sample_string(&mut rand::rng(), 16);
  let prefix = format!("1:{bits}:{}:{resource}::{nonce}:", Utc::now().format(DATE_FORMAT));
  let mut hasher = Sha3_256::new();
  hasher.update(prefix.as_bytes());
  let mut response = prefix;
  let prefix_len = response.len();
  let started = Instant::now();

  // Eight times the expected search, with a separate wall-clock limit.
  for counter in 0..(1_u64 << (bits + 3)) {
    if counter % 1024 == 0 && started.elapsed() >= MAX_MINT_TIME {
      break;
    }
    response.truncate(prefix_len);
    write!(&mut response, "{counter}").map_err(|_| Error::from_reason("Could not format hashcash counter"))?;
    let mut candidate = hasher.clone();
    candidate.update(&response.as_bytes()[prefix_len..]);
    if has_proof(&candidate.finalize(), bits) {
      return Ok(response);
    }
  }
  Err(Error::from_reason("Hashcash search exceeded its work limit"))
}

pub struct AsyncVerifyChallengeResponse {
  response: String,
  bits: u32,
  resource: String,
}

#[napi]
impl Task for AsyncVerifyChallengeResponse {
  type Output = bool;
  type JsValue = bool;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(verify_stamp(&self.response, self.bits, &self.resource, Utc::now()))
  }

  fn resolve(&mut self, _: Env, output: bool) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn verify_challenge_response(
  response: String,
  bits: u32,
  resource: String,
) -> AsyncTask<AsyncVerifyChallengeResponse> {
  AsyncTask::new(AsyncVerifyChallengeResponse {
    response,
    bits,
    resource,
  })
}

pub struct AsyncMintChallengeResponse {
  bits: Option<u32>,
  resource: String,
}

#[napi]
impl Task for AsyncMintChallengeResponse {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    mint_stamp(&self.resource, self.bits.unwrap_or(DEFAULT_BITS))
  }

  fn resolve(&mut self, _: Env, output: String) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn mint_challenge_response(resource: String, bits: Option<u32>) -> AsyncTask<AsyncMintChallengeResponse> {
  AsyncTask::new(AsyncMintChallengeResponse { bits, resource })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn now() -> DateTime<Utc> {
    NaiveDateTime::parse_from_str("20260914120000", DATE_FORMAT)
      .unwrap()
      .and_utc()
  }

  fn proof(prefix: &str, bits: u32) -> String {
    for counter in 0..100_000 {
      let stamp = format!("{prefix}{counter:x}");
      if has_proof(&Sha3_256::digest(stamp.as_bytes()), bits) {
        return stamp;
      }
    }
    panic!("test fixture search exhausted");
  }

  fn dated_stamp(offset: i64) -> String {
    let date = (now() + chrono::Duration::seconds(offset)).format(DATE_FORMAT);
    proof(&format!("1:8:{date}:test-resource::Nonce123:"), 8)
  }

  #[test]
  fn hashcash_roundtrip() {
    let resource = "test-resource".to_string();
    let mut mint = AsyncMintChallengeResponse {
      bits: Some(8),
      resource: resource.clone(),
    };
    let stamp = mint.compute().unwrap();

    let mut verify = AsyncVerifyChallengeResponse {
      response: stamp,
      bits: 8,
      resource,
    };
    assert!(verify.compute().unwrap());
  }

  #[test]
  fn accepts_decimal_and_hex_counters() {
    let decimal_stamp = (0..100_000)
      .map(|counter| format!("1:8:20260914120000:test-resource::Nonce123:{counter}"))
      .find(|stamp| has_proof(&Sha3_256::digest(stamp.as_bytes()), 8))
      .unwrap();
    assert!(verify_stamp(&decimal_stamp, 8, "test-resource", now()));
    for counter_prefix in ["", "0x", "0X"] {
      let stamp = proof(
        &format!("1:8:20260914120000:test-resource::Nonce123:{counter_prefix}"),
        8,
      );
      assert!(verify_stamp(&stamp, 8, "test-resource", now()));
    }
  }

  #[test]
  fn rejects_wrong_resource_and_bit_count() {
    let stamp = dated_stamp(0);
    assert!(!verify_stamp(&stamp, 8, "other-resource", now()));
    assert!(!verify_stamp(&stamp, 7, "test-resource", now()));
    assert!(!verify_stamp(&stamp, 9, "test-resource", now()));
    for bits in [0, 25, 256, 257, u32::MAX] {
      assert!(!verify_stamp(&stamp, bits, "test-resource", now()));
      assert!(mint_stamp("test-resource", bits).is_err());
    }
    assert!(valid_bits(MAX_BITS));
    assert_eq!(DEFAULT_BITS, 20);
  }

  #[test]
  fn checks_expiry_and_future_skew() {
    for offset in [-300, 0, 30] {
      assert!(verify_stamp(&dated_stamp(offset), 8, "test-resource", now()));
    }
    for offset in [-301, 31, 3600] {
      assert!(!verify_stamp(&dated_stamp(offset), 8, "test-resource", now()));
    }
  }

  #[test]
  fn rejects_malformed_stamps_even_with_valid_proof() {
    for prefix in [
      "2:8:20260914120000:test-resource::Nonce123:",
      "1:+8:20260914120000:test-resource::Nonce123:",
      "1:0:20260914120000:test-resource::Nonce123:",
      "1:25:20260914120000:test-resource::Nonce123:",
      "1:4294967296:20260914120000:test-resource::Nonce123:",
      "1:8:20260230120000:test-resource::Nonce123:",
      "1:8:20260914:test-resource::Nonce123:",
      "1:8:20260914120000:test-resource:extension:Nonce123:",
      "1:8:20260914120000:test-resource:::",
      "1:8:20260914120000:test-resource::bad nonce:",
      "1:8:20260914120000:test-resource::Nonce123:extra:",
      "1:8:20260914120000:test-resource::Nonce123:-",
      "1:8:20260914120000:test-resource::Nonce123:z",
    ] {
      assert!(!verify_stamp(&proof(prefix, 8), 8, "test-resource", now()), "{prefix}");
    }
    for stamp in ["", "1:8", "1:8:20260914120000:test-resource::Nonce123:"] {
      assert!(!verify_stamp(stamp, 8, "test-resource", now()));
    }
    assert!(!verify_stamp(
      &"a".repeat(MAX_STAMP_BYTES + 1),
      8,
      "test-resource",
      now()
    ));
  }

  #[test]
  fn rejects_invalid_resources_before_mining() {
    for resource in ["", "a:b", "a\nb", "a\0b", &"a".repeat(MAX_RESOURCE_BYTES + 1)] {
      assert!(mint_stamp(resource, 8).is_err());
      assert!(!verify_stamp(&dated_stamp(0), 8, resource, now()));
    }
  }

  #[test]
  fn checks_actual_proof_and_leading_zero_boundaries() {
    assert!(has_proof(&[0, 0, 0], 24));
    assert!(!has_proof(&[0, 0, 1], 24));
    assert!(has_proof(&[0, 0, 0x0f], 20));
    assert!(!has_proof(&[0, 0, 0x10], 20));
    assert!(!has_proof(&[0; 32], 257));
    assert!(!has_proof(&[], 8));

    let stamp = (0..1000)
      .map(|counter| format!("1:8:20260914120000:test-resource::Nonce123:{counter}"))
      .find(|stamp| !has_proof(&Sha3_256::digest(stamp.as_bytes()), 8))
      .unwrap();
    assert!(!verify_stamp(&stamp, 8, "test-resource", now()));
  }
}
