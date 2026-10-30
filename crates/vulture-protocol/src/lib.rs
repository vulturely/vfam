// Generated tonic/pbjson APIs use framework-owned error and formatting signatures.
#[allow(clippy::result_large_err, clippy::useless_borrows_in_formatting)]
pub mod server {
    pub mod v1 {
        tonic::include_proto!("vulture.server.v1");
        include!(concat!(env!("OUT_DIR"), "/vulture.server.v1.serde.rs"));
    }
}

#[allow(clippy::result_large_err, clippy::useless_borrows_in_formatting)]
pub mod fambuddy {
    pub mod v1 {
        tonic::include_proto!("vulture.fambuddy.v1");
        include!(concat!(env!("OUT_DIR"), "/vulture.fambuddy.v1.serde.rs"));
    }
}

#[cfg(test)]
mod tests {
    use super::{fambuddy, server};

    #[test]
    fn protobuf_json_preserves_binary_and_integer_values() {
        let document = server::v1::TaskDocument {
            id: "document".into(),
            task_id: "task".into(),
            name: "private.txt".into(),
            url: String::new(),
            object_key: "key".into(),
            content_type: "text/plain".into(),
            size: i64::MAX,
            image: false,
            uploaded_at: "now".into(),
        };
        let json = serde_json::to_string(&document).expect("serialize document");
        assert!(json.contains(&format!("\"size\":\"{}\"", i64::MAX)));
        let decoded: server::v1::TaskDocument =
            serde_json::from_str(&json).expect("deserialize document");
        assert_eq!(decoded, document);

        let command = fambuddy::v1::ParentCommandRequest {
            command: Some(fambuddy::v1::parent_command_request::Command::Approve(
                fambuddy::v1::ApproveTurn {
                    device: "device".into(),
                    turn: "turn".into(),
                    review: vec![0, 127, 255],
                },
            )),
        };
        let json = serde_json::to_string(&command).expect("serialize command");
        let decoded: fambuddy::v1::ParentCommandRequest =
            serde_json::from_str(&json).expect("deserialize command");
        assert_eq!(decoded, command);
    }
}
