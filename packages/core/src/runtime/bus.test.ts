import { expect, it, vi } from "vitest";
import { createBus } from "./bus";

it("publishes events to topic subscribers and unsubscribes them", () => {
	const bus = createBus();
	const first = vi.fn();
	const second = vi.fn();
	const unsubscribeFirst = bus.subscribe<number>("changed", first);
	bus.subscribe<number>("changed", second);

	bus.publish("changed", 1);
	unsubscribeFirst();
	bus.publish("changed", 2);
	unsubscribeFirst();

	expect(first).toHaveBeenCalledOnce();
	expect(first).toHaveBeenCalledWith(1);
	expect(second).toHaveBeenNthCalledWith(1, 1);
	expect(second).toHaveBeenNthCalledWith(2, 2);
});

it("ignores topics without subscribers", () => {
	expect(() => createBus().publish("missing", { value: 1 })).not.toThrow();
});
