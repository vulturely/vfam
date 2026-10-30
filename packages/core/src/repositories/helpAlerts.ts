import { isNativeApp } from "./nativeAuth";

/** A child's help request, as the native app announced it. */
export interface HelpAlertNotice {
	title: string;
	body: string;
	/** Where the guardian answers it. */
	screen: string;
	alert: {
		kind: string;
		profileId: string;
		childName: string;
		title: string;
		requestId: string;
		at: string;
	};
}

type Listen = (
	event: string,
	handler: (event: { payload: HelpAlertNotice }) => void,
) => Promise<() => void>;

async function tauriListen(...args: Parameters<Listen>) {
	const { listen } = await import("@tauri-apps/api/event");
	return listen<HelpAlertNotice>(...args);
}

/** Help alerts arrive from the native app, which listens even in the background. */
export function createHelpAlertRepository(
	native: () => boolean = isNativeApp,
	listen: Listen = tauriListen,
) {
	return {
		async listen(handler: (notice: HelpAlertNotice) => void): Promise<() => void> {
			if (!native()) return () => {};
			return listen("vulture:help-requested", (event) => handler(event.payload));
		},
	};
}
export type HelpAlertRepository = ReturnType<typeof createHelpAlertRepository>;
