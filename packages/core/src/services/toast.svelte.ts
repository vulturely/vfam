import { SvelteMap } from "svelte/reactivity";

export type ToastKind = "error" | "success" | "info";

export interface ToastAction {
	label: string;
	run(): void;
}

export interface ToastItem {
	id: number;
	kind: ToastKind;
	message: string;
	action?: ToastAction;
}

const state = $state<{ items: ToastItem[] }>({ items: [] });
const dismissTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();
let nextId = 0;

function show(kind: ToastKind, message: string, action?: ToastAction) {
	const id = ++nextId;
	state.items.push({ id, kind, message, action });
	// Toasts with something to do stay longer, so there is time to act on them.
	dismissTimers.set(
		id,
		setTimeout(() => dismiss(id), action ? 20_000 : 6000),
	);
}

function dismiss(id: number) {
	const timer = dismissTimers.get(id);
	if (timer) clearTimeout(timer);
	dismissTimers.delete(id);
	const index = state.items.findIndex((item) => item.id === id);
	if (index >= 0) state.items.splice(index, 1);
}

export const toastService = {
	get items() {
		return state.items;
	},
	error(message: string) {
		show("error", message);
	},
	success(message: string) {
		show("success", message);
	},
	info(message: string, action?: ToastAction) {
		show("info", message, action);
	},
	dismiss,
	clear() {
		for (const timer of dismissTimers.values()) clearTimeout(timer);
		dismissTimers.clear();
		state.items.splice(0);
	},
};
