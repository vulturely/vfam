import type { HelpAlertNotice, HelpAlertRepository } from "../repositories/helpAlerts";

/** Shows each help alert in the open window; the OS notification comes from the native app. */
export function createHelpAlertService(
	repository: HelpAlertRepository,
	show: (notice: HelpAlertNotice) => void,
) {
	let listening: Promise<() => void> | undefined;
	return {
		start() {
			listening ??= repository.listen(show).catch(() => {
				listening = undefined;
				return () => {};
			});
			return listening.then(() => undefined);
		},
		async stop() {
			const current = listening;
			listening = undefined;
			(await current)?.();
		},
	};
}
export type HelpAlertService = ReturnType<typeof createHelpAlertService>;
