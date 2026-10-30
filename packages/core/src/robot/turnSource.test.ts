import { expect, it } from "vitest";
import { answeredBy, askedBy, cloudUnavailable, isFixedReply } from "./turnSource";

it("says who asked and how", () => {
	expect(askedBy({})).toBe("");
	expect(askedBy({ origin: { name: "Jamie", role: "child", channel: "voice" } })).toBe(
		"Jamie asked aloud",
	);
	expect(askedBy({ origin: { name: "", role: "child", channel: "voice" } })).toBe(
		"A child asked aloud",
	);
	expect(askedBy({ origin: { name: "", role: "parent", channel: "voice" } })).toBe(
		"A parent asked aloud",
	);
	expect(askedBy({ origin: { name: "", role: "parent", channel: "app" } })).toBe(
		"A parent asked in VFAM",
	);
	expect(askedBy({ origin: { name: "", role: "child", channel: "app" } })).toBe("Asked in VFAM");
	expect(askedBy({ origin: { name: "Sam", role: "child", channel: "" } })).toBe("Sam asked");
});

it("says which AI or person wrote the answer", () => {
	expect(answeredBy("provider")).toMatch(/AI provider/);
	expect(answeredBy("parent_device")).toMatch(/parent's device/);
	expect(answeredBy("local")).toBe("Answered on the FamBuddy");
	expect(answeredBy("cloud")).toMatch(/cloud AI a parent chose/);
	expect(answeredBy("parent")).toBe("Written by a parent");
	expect(answeredBy("unknown")).toBe("Answer source unknown");
});

it("recognises the fixed reply and a FamBuddy without a cloud AI", () => {
	expect(isFixedReply({ destination: "FamBuddy's fixed reply" })).toBe(true);
	expect(isFixedReply({ destination: "openai" })).toBe(false);
	expect(cloudUnavailable({ destination: "On-device AI" })).toMatch(/No cloud AI/);
	expect(cloudUnavailable({ destination: "openai gpt" })).toBe("");
});
