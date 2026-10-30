import { expect, it, vi } from "vitest";
import type { HelpAlertNotice, HelpAlertRepository } from "../repositories/helpAlerts";
import { createHelpAlertService } from "./service";

it("listens once, shows alerts and stops listening", async () => {
	const unlisten = vi.fn();
	let deliver: (notice: HelpAlertNotice) => void = () => {};
	const listen = vi.fn(async (handler: (notice: HelpAlertNotice) => void) => {
		deliver = handler;
		return unlisten;
	});
	const show = vi.fn();
	const service = createHelpAlertService({ listen } as HelpAlertRepository, show);
	await Promise.all([service.start(), service.start()]);
	expect(listen).toHaveBeenCalledTimes(1);
	const notice = { title: "Jamie needs help" } as HelpAlertNotice;
	deliver(notice);
	expect(show).toHaveBeenCalledWith(notice);
	await service.stop();
	expect(unlisten).toHaveBeenCalled();
	await service.stop();
});

it("tries again after a failed start", async () => {
	const listen = vi
		.fn()
		.mockRejectedValueOnce(new Error("no events"))
		.mockResolvedValueOnce(() => {});
	const service = createHelpAlertService({ listen } as unknown as HelpAlertRepository, vi.fn());
	await service.start();
	await service.start();
	expect(listen).toHaveBeenCalledTimes(2);
});
