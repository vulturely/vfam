use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", protoc);
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?).join("proto");
    let files = [
        "vulture/server/v1/control.proto",
        "vulture/server/v1/learning.proto",
        "vulture/server/v1/family_ai.proto",
        "vulture/server/v1/timetable.proto",
        "vulture/server/v1/robot.proto",
        "vulture/server/v1/fambuddy_relay.proto",
        "vulture/server/v1/fambuddy_registry.proto",
        "vulture/fambuddy/v1/gateway.proto",
    ];
    let proto_files: Vec<_> = files.iter().map(|file| root.join(file)).collect();
    for file in &proto_files {
        println!("cargo:rerun-if-changed={}", file.display());
    }
    let descriptor_path = PathBuf::from(std::env::var("OUT_DIR")?).join("proto_descriptor.bin");
    tonic_build::configure()
        .build_client(true)
        .build_server(std::env::var_os("CARGO_FEATURE_TRANSPORT_TESTS").is_some())
        .file_descriptor_set_path(&descriptor_path)
        .compile_well_known_types(true)
        .extern_path(".google.protobuf", "::pbjson_types")
        .boxed(".vulture.server.v1.CompleteFamilyAiJobResponse.result.practice")
        .compile_protos(&proto_files, &[root])?;
    let descriptors = std::fs::read(descriptor_path)?;
    pbjson_build::Builder::new()
        .register_descriptors(&descriptors)?
        .build(&[".vulture"])?;
    Ok(())
}
