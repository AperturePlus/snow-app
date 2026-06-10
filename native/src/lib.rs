use napi_derive::napi;

#[napi]
pub fn engine_info() -> String {
    format!(
        "snow-native {} on {} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

#[napi]
pub fn sum(a: i32, b: i32) -> i32 {
    a + b
}
