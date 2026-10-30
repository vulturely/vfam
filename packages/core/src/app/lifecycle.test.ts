import { expect, it, vi } from "vitest";
import { createAppLifecycleRepository } from "../repositories/appLifecycle";
import { createAppLifecycleService } from "./lifecycle";

it("quits through the native command only in the desktop app", async () => {
	const invoke = vi.fn(async () => undefined);
	let desktop = true;
	const service = createAppLifecycleService(
		createAppLifecycleRepository({ invoke } as never, () => desktop),
	);
	expect(service.canExit()).toBe(true);
	await service.exit();
	expect(invoke).toHaveBeenCalledExactlyOnceWith("app_exit");
	desktop = false;
	expect(service.canExit()).toBe(false);
	await service.exit();
	expect(invoke).toHaveBeenCalledOnce();
});
