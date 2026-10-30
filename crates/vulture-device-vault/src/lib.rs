//! FamBuddy private application storage: encrypted files and SQLite references.
mod files;
mod keys;
mod leases;
mod service;
pub use service::execute;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::initialize as initialize_android;
