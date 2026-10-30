import { expect, it } from "vitest";
import { screenPinProblem } from "./screenPin";

it("accepts four to eight matching digits", () => {
	expect(screenPinProblem("1234", "1234")).toBeUndefined();
	expect(screenPinProblem("12345678", "12345678")).toBeUndefined();
});

it("explains why a screen PIN cannot be saved", () => {
	expect(screenPinProblem("12a4", "12a4")).toBe("Use digits only.");
	expect(screenPinProblem("1 34", "1 34")).toBe("Use digits only.");
	expect(screenPinProblem("123", "123")).toBe("Use 4 to 8 digits.");
	expect(screenPinProblem("", "")).toBe("Use 4 to 8 digits.");
	expect(screenPinProblem("123456789", "123456789")).toBe("Use 4 to 8 digits.");
	expect(screenPinProblem("1234", "4321")).toBe("The two PINs do not match.");
});
