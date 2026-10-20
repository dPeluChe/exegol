extern crate napi_build;

fn main() {
  napi_build::setup();
  // libgit2's static build on MSVC calls the registry, token and CryptoAPI functions in advapi32
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
    println!("cargo:rustc-link-lib=advapi32");
  }
}
