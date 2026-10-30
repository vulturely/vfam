import { expect, it, vi } from "vitest";
import { createApprovalNoticeRepository } from "./fambuddyApprovals";

it("asks the native app to show the notice, and does nothing in a browser", async () => {
	const invoke = vi.fn(async () => undefined);
	await createApprovalNoticeRepository({ invoke } as never, () => true).show("Title", "Body");
	expect(invoke).toHaveBeenCalledWith("fambuddy_approval_notice", {
		input: { title: "Title", body: "Body" },
	});
	await createApprovalNoticeRepository({ invoke } as never, () => false).show("T", "B");
	expect(invoke).toHaveBeenCalledOnce();
});

it("hears the family server's approval alerts in the native app only", async () => {
	const unlisten = vi.fn();
	let deliver!: (event: { payload: unknown }) => void;
	const listen = vi.fn(async (_event: string, handler: (event: { payload: never }) => void) => {
		deliver = handler as never;
		return unlisten;
	});
	const handler = vi.fn();
	const stop = await createApprovalNoticeRepository({} as never, () => true, listen).listen(
		handler,
	);
	expect(listen).toHaveBeenCalledWith("vulture:fambuddy-approval", expect.any(Function));
	deliver({ payload: { turnId: "t" } });
	expect(handler).toHaveBeenCalledWith({ turnId: "t" });
	stop();
	expect(unlisten).toHaveBeenCalled();
	const browser = await createApprovalNoticeRepository({} as never, () => false, listen).listen(
		handler,
	);
	browser();
	expect(listen).toHaveBeenCalledOnce();
});
