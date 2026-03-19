#![deny(clippy::all)]

mod git;
mod processing;

pub use git::*;
pub use processing::*;

use napi_derive::napi;

/// Health check function to verify the native module is loaded correctly.
#[napi]
pub fn health_check() -> String {
  "exegol-core-rust is operational".to_string()
}

/// Returns the version of the native module.
#[napi]
pub fn native_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
