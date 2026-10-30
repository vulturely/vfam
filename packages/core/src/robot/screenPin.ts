/** Shortest and longest PIN the FamBuddy's own screen accepts. */
export const SCREEN_PIN_MIN = 4;
export const SCREEN_PIN_MAX = 8;

/** Why a new screen PIN cannot be saved yet, or undefined when it can. */
export function screenPinProblem(pin: string, confirmation: string): string | undefined {
	if (!/^\d*$/.test(pin)) return "Use digits only.";
	if (pin.length < SCREEN_PIN_MIN || pin.length > SCREEN_PIN_MAX)
		return `Use ${SCREEN_PIN_MIN} to ${SCREEN_PIN_MAX} digits.`;
	if (pin !== confirmation) return "The two PINs do not match.";
	return undefined;
}
