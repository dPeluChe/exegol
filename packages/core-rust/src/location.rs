use napi_derive::napi;

/// macOS Location Services for this app: "not-determined" | "restricted" | "denied" |
/// "granted", or "unsupported" off macOS. `request` shows the macOS prompt while undecided.
/// Main thread only. Chromium never asks macOS itself, so a page's geolocation would hang
#[napi]
pub fn location_authorization(request: bool) -> String {
  imp::status(request).to_string()
}

#[cfg(target_os = "macos")]
mod imp {
  use objc2::rc::Retained;
  use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
  use std::cell::RefCell;

  thread_local! {
    // Kept alive: macOS drops the prompt when its manager is released
    static MANAGER: RefCell<Option<Retained<CLLocationManager>>> = const { RefCell::new(None) };
  }

  pub fn status(request: bool) -> &'static str {
    MANAGER.with(|cell| {
      let mut slot = cell.borrow_mut();
      // SAFETY: plain Objective-C calls on the thread that runs the main process's JS (main)
      let manager = slot.get_or_insert_with(|| unsafe { CLLocationManager::new() });
      let status = unsafe { manager.authorizationStatus() };
      if request && status == CLAuthorizationStatus::NotDetermined {
        unsafe { manager.requestWhenInUseAuthorization() };
      }
      match status {
        CLAuthorizationStatus::NotDetermined => "not-determined",
        CLAuthorizationStatus::Restricted => "restricted",
        CLAuthorizationStatus::Denied => "denied",
        _ => "granted",
      }
    })
  }
}

#[cfg(not(target_os = "macos"))]
mod imp {
  pub fn status(_request: bool) -> &'static str {
    "unsupported"
  }
}
