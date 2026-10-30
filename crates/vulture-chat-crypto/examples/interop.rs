//! Local interoperability test driver. Nothing is logged except the requested public result.
use std::io::Read;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let result = vulture_chat_crypto::execute(
        std::path::Path::new(&args[1]),
        &args[2],
        serde_json::from_str(&input).unwrap(),
    );
    match result {
        Ok(output) => println!("{output}"),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}
