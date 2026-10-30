import type { AgeBand } from "./types";

/** Match the server’s UTC DOB validation and age-band boundaries. */
export function ageBandFromDob(value: string, today = new Date()): AgeBand {
	const birth = new Date(`${value}T00:00:00Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		!Number.isFinite(birth.getTime()) ||
		birth.toISOString().slice(0, 10) !== value
	)
		throw new Error("Enter a valid date of birth.");
	const beforeBirthday =
		today.getUTCMonth() < birth.getUTCMonth() ||
		(today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
	const age = today.getUTCFullYear() - birth.getUTCFullYear() - Number(beforeBirthday);
	if (age < 3 || age > 17) throw new Error("Child learning profiles support ages 3–17.");
	return age <= 5 ? "early_years" : age <= 8 ? "primary" : age <= 12 ? "preteen" : "teen";
}
