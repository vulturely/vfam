import { isNativeServerError } from "../repositories/server";

/**
 * FamBuddy licenses come from the Swavan App Platform (SAP). Core features stay free;
 * a license unlocks the paid features below. The license token itself is never kept in
 * this app: it lives on the family server and on each FamBuddy.
 */
export type FamBuddyLicenseState = "none" | "valid" | "expired" | "unknown";

export interface FamBuddyLicense {
	/** "unknown" when the server or hub did not say, e.g. an older FamBuddy. */
	state: FamBuddyLicenseState;
	edition: string;
	/** SAP feature ids such as "fambuddy.live_camera"; empty unless valid. */
	features: string[];
	/** RFC 3339; empty without a license or when it never ends. */
	expires_at: string;
}

export const ON_DEVICE_AI = "fambuddy.on_device_ai";
export const REMOTE_ACCESS = "fambuddy.remote_access";
export const SERVER_ALERTS = "fambuddy.server_alerts";
export const LIVE_CAMERA = "fambuddy.live_camera";

export const LICENSE_FEATURES = [
	{ id: ON_DEVICE_AI, label: "On-device AI" },
	{ id: REMOTE_ACCESS, label: "Away-from-home access" },
	{ id: SERVER_ALERTS, label: "Server alerts & email" },
	{ id: LIVE_CAMERA, label: "Live camera" },
] as const;

export const NEEDS_LICENSE = "Needs a FamBuddy license";

const states: Record<number, FamBuddyLicenseState> = { 1: "none", 2: "valid", 3: "expired" };

/** Reads a license from either protocol message; both share the same state numbers. */
export function licenseFrom(value?: {
	state: number;
	edition: string;
	features: string[];
	expiresAt: string;
}): FamBuddyLicense {
	return {
		state: (value && states[value.state]) ?? "unknown",
		edition: value?.edition ?? "",
		features: [...(value?.features ?? [])],
		expires_at: value?.expiresAt ?? "",
	};
}

/** Whether a license includes a paid feature now. */
export function allows(license: FamBuddyLicense | undefined, feature: string) {
	return license?.state === "valid" && license.features.includes(feature);
}

/**
 * Whether a paid feature is known to be unavailable. A license that was not reported
 * (an older FamBuddy or server) does not hide anything; the device still decides.
 */
export function lacks(license: FamBuddyLicense | undefined, feature: string) {
	return !!license && license.state !== "unknown" && !allows(license, feature);
}

function day(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** "No license", "Active until 1 January 2027", "Expired on …" and so on. */
export function licenseSummary(license: FamBuddyLicense | undefined) {
	switch (license?.state) {
		case "valid":
			return license.expires_at ? `Active until ${day(license.expires_at)}` : "Active";
		case "expired":
			return license.expires_at ? `Expired on ${day(license.expires_at)}` : "Expired";
		case "none":
			return "No license";
		default:
			return "Not reported";
	}
}

/** A parent-facing reason a license could not be installed, removed, or read. */
export function licenseError(
	cause: unknown,
	fallback = "The FamBuddy license could not be saved.",
) {
	if (isNativeServerError(cause)) {
		switch (cause.kind) {
			case "invalid_argument":
				return "That is not a valid FamBuddy license. Copy the whole license key from Swavan and try again.";
			case "failed_precondition":
				return "This FamBuddy license cannot be used now. It has expired, is not valid yet, or is older than the one installed. Install your newest license from Swavan.";
			case "already_exists":
				return "This FamBuddy license is already used by another family.";
			case "permission_denied":
				return "Only a guardian of this family can manage its FamBuddy license.";
			case "unavailable":
			case "deadline_exceeded":
				return "Your family server could not be reached. Check your connection and try again.";
		}
	}
	return cause instanceof Error && cause.message ? cause.message : fallback;
}
