#!/usr/bin/env bash
# Cargo runner for macOS. The linker gives every build a new ad-hoc signature, so
# the Keychain treats each rebuild as a new app and asks for the password again.
# Signing the app binary with one stable local identity keeps "Always Allow".
# Without that identity the binary runs unchanged.
set -euo pipefail
binary="$1"
shift
identity="${VFAM_DEV_SIGNING_IDENTITY:-VFam Development}"
if [[ "$(basename "$binary")" == "vfam" ]]; then
	if security find-identity -v -p codesigning 2>/dev/null | grep -Fq "\"$identity\""; then
		codesign --force --sign "$identity" --identifier com.swavan.vfam.dev "$binary" >/dev/null 2>&1 ||
			echo "warning: could not sign $binary with \"$identity\"; the Keychain may ask again." >&2
	else
		echo "note: no \"$identity\" code-signing identity; the Keychain asks again after each rebuild (see README)." >&2
	fi
fi
exec "$binary" "$@"
