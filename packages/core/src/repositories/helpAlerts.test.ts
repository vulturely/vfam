import { expect, it, vi } from "vitest";
import { createHelpAlertRepository, type HelpAlertNotice } from "./helpAlerts";

const notice: HelpAlertNotice = {
	title: "Jamie needs help",
	body: "Jamie asked for help with Spelling.",
	screen: "learning:profiles",
	alert: {
		kind: "practice",
		profileId: "p",
		childName: "Jamie",
		title: "Spelling",
		requestId: "r",
		at: "now",
	},
};

it("hands native help alerts to the listener", async () => {
	const unlisten = vi.fn();
	const listen = vi.fn(
		async (_event: string, handler: (event: { payload: HelpAlertNotice }) => void) => {
			handler({ payload: notice });
			return unlisten;
		},
	);
	const handler = vi.fn();
	const stop = await createHelpAlertRepository(() => true, listen).listen(handler);
	expect(listen).toHaveBeenCalledWith("vulture:help-requested", expect.any(Function));
	expect(handler).toHaveBeenCalledWith(notice);
	stop();
	expect(unlisten).toHaveBeenCalled();
});

it("listens to nothing outside the native app", async () => {
	const listen = vi.fn();
	const stop = await createHelpAlertRepository(() => false, listen).listen(vi.fn());
	stop();
	expect(listen).not.toHaveBeenCalled();
});
