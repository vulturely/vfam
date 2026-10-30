//! Initialize the application context before using Android's Keystore adapter.
use jni::{objects::JObject, JNIEnv};

pub fn initialize(env: JNIEnv, class: JObject, context: JObject) {
    android_native_keyring_store::Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext(env, class, context);
}
