use keyring_core::{api::CredentialStoreApi, Entry};

/// OS credential-store entry with platform-specific device-only protection.
pub fn entry(service: &str, user: &str) -> Result<Entry, ()> {
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new();
    #[cfg(target_os = "ios")]
    let store = apple_native_keyring_store::protected::Store::new();
    #[cfg(target_os = "android")]
    let store = android_native_keyring_store::Store::new();
    #[cfg(target_os = "windows")]
    let store = windows_native_keyring_store::Store::new();
    #[cfg(target_os = "linux")]
    let store = dbus_secret_service_keyring_store::Store::new();
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    )))]
    return Err(());
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    ))]
    {
        #[cfg(not(any(target_os = "ios", target_os = "windows")))]
        let modifiers = std::collections::HashMap::new();
        #[cfg(target_os = "ios")]
        let modifiers =
            std::collections::HashMap::from([("access-policy", "WhenUnlockedThisDeviceOnly")]);
        #[cfg(target_os = "windows")]
        let modifiers = std::collections::HashMap::from([("persistence", "Local")]);
        store
            .map_err(|_| ())?
            .build(service, user, Some(&modifiers))
            .map_err(|_| ())
    }
}
