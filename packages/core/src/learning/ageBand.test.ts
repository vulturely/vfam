import { expect, it } from "vitest";
import { ageBandFromDob } from "./ageBand";
const today = new Date("2026-10-18T12:00:00Z");
it.each([
	["2023-10-18", "early_years"],
	["2020-10-19", "early_years"],
	["2020-10-18", "primary"],
	["2017-10-19", "primary"],
	["2017-10-18", "preteen"],
	["2013-10-19", "preteen"],
	["2013-10-18", "teen"],
	["2008-10-19", "teen"],
])("calculates the band for %s at birthday boundaries", (dob, expected) => {
	expect(ageBandFromDob(dob, today)).toBe(expected);
});
it.each(["", "bad", "2020-02-30", "2020-1-01", "2027-01-01", "2023-10-19", "2008-10-18"])(
	"rejects invalid or unsupported DOB %s",
	(dob) => {
		expect(() => ageBandFromDob(dob, today)).toThrow();
	},
);
