import { expect, it } from "vitest";
import { NativeServerError } from "../repositories/server";
import {
	LIVE_CAMERA,
	REMOTE_ACCESS,
	allows,
	lacks,
	licenseError,
	licenseFrom,
	licenseSummary,
	type FamBuddyLicense,
} from "./license";

const valid: FamBuddyLicense = {
	state: "valid",
	edition: "Family",
	features: [LIVE_CAMERA],
	expires_at: "2027-03-04T00:00:00Z",
};
const date = (value: string) =>
	new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

it("reads either protocol license and keeps unreported ones unknown", () => {
	expect(
		licenseFrom({ state: 2, edition: "Family", features: [LIVE_CAMERA], expiresAt: "x" }),
	).toEqual({ state: "valid", edition: "Family", features: [LIVE_CAMERA], expires_at: "x" });
	expect(licenseFrom({ state: 1, edition: "", features: [], expiresAt: "" }).state).toBe("none");
	expect(licenseFrom({ state: 3, edition: "", features: [], expiresAt: "" }).state).toBe("expired");
	expect(licenseFrom({ state: 0, edition: "", features: [], expiresAt: "" }).state).toBe("unknown");
	expect(licenseFrom(undefined)).toEqual({
		state: "unknown",
		edition: "",
		features: [],
		expires_at: "",
	});
});

it("knows which paid features are on, and never hides what was not reported", () => {
	expect(allows(valid, LIVE_CAMERA)).toBe(true);
	expect(allows(valid, REMOTE_ACCESS)).toBe(false);
	expect(allows({ ...valid, state: "expired" }, LIVE_CAMERA)).toBe(false);
	expect(allows(undefined, LIVE_CAMERA)).toBe(false);
	expect(lacks(valid, LIVE_CAMERA)).toBe(false);
	expect(lacks(valid, REMOTE_ACCESS)).toBe(true);
	expect(lacks({ ...valid, state: "none", features: [] }, LIVE_CAMERA)).toBe(true);
	expect(lacks({ ...valid, state: "unknown" }, REMOTE_ACCESS)).toBe(false);
	expect(lacks(undefined, REMOTE_ACCESS)).toBe(false);
});

it("summarises a license for parents", () => {
	expect(licenseSummary(valid)).toBe(`Active until ${date(valid.expires_at)}`);
	expect(licenseSummary({ ...valid, expires_at: "" })).toBe("Active");
	expect(licenseSummary({ ...valid, state: "expired" })).toBe(
		`Expired on ${date(valid.expires_at)}`,
	);
	expect(licenseSummary({ ...valid, state: "expired", expires_at: "" })).toBe("Expired");
	expect(licenseSummary({ ...valid, expires_at: "soon" })).toBe("Active until soon");
	expect(licenseSummary({ ...valid, state: "none" })).toBe("No license");
	expect(licenseSummary(undefined)).toBe("Not reported");
});

it("explains each family-server refusal in plain words", () => {
	const error = (kind: string) => licenseError(new NativeServerError(kind, "raw"));
	expect(error("invalid_argument")).toMatch(/not a valid FamBuddy license/);
	expect(error("failed_precondition")).toMatch(/expired, is not valid yet, or is older/);
	expect(error("already_exists")).toBe("This FamBuddy license is already used by another family.");
	expect(error("permission_denied")).toMatch(/Only a guardian/);
	expect(error("unavailable")).toMatch(/could not be reached/);
	expect(error("deadline_exceeded")).toMatch(/could not be reached/);
	expect(error("internal")).toBe("raw");
	expect(licenseError({ kind: "already_exists", message: "plain" })).toMatch(/another family/);
	expect(licenseError(new Error("Device offline."))).toBe("Device offline.");
	expect(licenseError(new Error(""), "Fallback.")).toBe("Fallback.");
	expect(licenseError("nope")).toBe("The FamBuddy license could not be saved.");
});
