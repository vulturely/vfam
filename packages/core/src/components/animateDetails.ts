/** Animate native details toggles and changes to the expanded body's height. */
export function animateDetails(
	node: globalThis.HTMLDetailsElement,
	onOpenChange?: (open: boolean) => void,
) {
	const summary = node.querySelector("summary")!;
	const body = node.querySelector<globalThis.HTMLElement>(".accordion-body");
	let expanded = node.open;
	let targetHeight = node.getBoundingClientRect().height;
	let animation: globalThis.Animation | undefined;
	const pixels = (value: string) => Number.parseFloat(value) || 0;
	function expandedHeight() {
		if (!body) return node.scrollHeight + node.offsetHeight - node.clientHeight;
		const style = globalThis.getComputedStyle(node);
		return (
			summary.getBoundingClientRect().height +
			body.getBoundingClientRect().height +
			pixels(style.paddingTop) +
			pixels(style.paddingBottom) +
			pixels(style.borderTopWidth) +
			pixels(style.borderBottomWidth)
		);
	}
	function closedHeight() {
		const style = globalThis.getComputedStyle(node);
		return (
			summary.getBoundingClientRect().height -
			pixels(globalThis.getComputedStyle(summary).borderBottomWidth) +
			pixels(style.borderTopWidth) +
			pixels(style.borderBottomWidth)
		);
	}
	function resize(start: number, end: number) {
		animation?.cancel();
		animation = undefined;
		targetHeight = end;
		if (!node.animate || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			node.open = expanded;
			node.style.height = "";
			node.style.overflow = "";
			targetHeight = node.getBoundingClientRect().height;
			return;
		}
		node.style.height = `${start}px`;
		node.style.overflow = "hidden";
		const current = node.animate([{ height: `${start}px` }, { height: `${end}px` }], {
			duration: 240,
			easing: "cubic-bezier(0.2, 0, 0, 1)",
		});
		animation = current;
		current.onfinish = () => {
			if (animation !== current) return;
			node.open = expanded;
			node.style.height = "";
			node.style.overflow = "";
			animation = undefined;
			targetHeight = node.getBoundingClientRect().height;
		};
	}
	function toggle(event: Event) {
		event.preventDefault();
		const start = node.getBoundingClientRect().height;
		expanded = !expanded;
		onOpenChange?.(expanded);
		node.open = true;
		resize(start, expanded ? expandedHeight() : closedHeight());
	}
	const observer =
		body && typeof globalThis.ResizeObserver === "function"
			? new globalThis.ResizeObserver(() => {
					if (!expanded || !node.open) return;
					const end = expandedHeight();
					if (Math.abs(end - targetHeight) < 0.5) return;
					resize(animation ? node.getBoundingClientRect().height : targetHeight, end);
				})
			: undefined;
	if (body) observer?.observe(body);
	summary.addEventListener("click", toggle);
	return {
		destroy() {
			observer?.disconnect();
			animation?.cancel();
			summary.removeEventListener("click", toggle);
		},
	};
}
