import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { FamBuddyDirectory } from "./directory.svelte";
import type { ServerApprovalAlert } from "../repositories/fambuddyApprovals";

/**
 * A question or answer waiting for a parent's approval, or a question the FamBuddy's
 * on-device AI could not answer, waiting for a parent. Never carries its text.
 */
export interface ApprovalNotice {
	/** The FamBuddy registration, to open its conversation. */
	id: string;
	name: string;
	kind: "question" | "answer" | "needs_parent";
	/** The waiting turn, so opening it can be acknowledged. */
	turn: string;
}

type Directory = Pick<FamBuddyDirectory, "sessions" | "refresh" | "acquire" | "release">;
/** How many announced approvals are remembered to avoid announcing them twice. */
const MAX_REMEMBERED = 500;

type Alerts = { listen(handler: (alert: ServerApprovalAlert) => void): Promise<() => void> };

/**
 * Keeps every paired FamBuddy watched while a parent is signed in, and announces each
 * question or answer that starts waiting for approval, once. A revised or edited answer
 * is a new review, so it is announced again.
 */
export function createApprovalWatch(
	directory: Directory,
	announce: (notice: ApprovalNotice) => void,
	active: () => boolean,
	alerts?: Alerts,
) {
	// Bookkeeping only: read with untrack, so updating it never re-runs the watch.
	const held = new SvelteSet<string>();
	// The review last announced for each waiting turn, seen directly on its FamBuddy.
	const reviews = new SvelteMap<string, { kind: ApprovalNotice["kind"]; review: string }>();
	// The same approval can come from the FamBuddy and from the family server; one
	// announcement per FamBuddy, turn and kind, whichever arrives first.
	const shown = new SvelteSet<string>();
	// Questions the family server announced before this app saw them on their FamBuddy.
	const fromServer = new SvelteSet<string>();
	let stopAlerts: (() => void) | undefined;
	let listening = 0;

	function once(notice: ApprovalNotice) {
		const key = `${notice.id}:${notice.turn}:${notice.kind}`;
		if (untrack(() => shown.has(key))) return false;
		shown.add(key);
		// The oldest key goes first, so a long-running app does not keep every turn it saw.
		if (untrack(() => shown.size) > MAX_REMEMBERED)
			shown.delete(untrack(() => shown.values().next().value as string));
		return true;
	}

	function forget() {
		untrack(() => {
			shown.clear();
			reviews.clear();
			fromServer.clear();
		});
	}
	let stopEffects: (() => void) | undefined;

	function hold() {
		const wanted = active()
			? directory.sessions
					.filter((session) => session.service && (session.pair || session.home))
					.map((session) => session.registration.id)
			: [];
		untrack(() => {
			for (const id of wanted) {
				if (held.has(id)) continue;
				held.add(id);
				directory.acquire(id).catch(() => held.delete(id));
			}
			for (const id of [...held]) {
				if (wanted.includes(id)) continue;
				held.delete(id);
				directory.release(id);
			}
		});
	}

	function scan() {
		if (!active()) return;
		const present: string[] = [];
		for (const session of directory.sessions) {
			for (const turn of session.output.turns) {
				const turnKey = `${session.registration.id}:${turn.scope.turn}`;
				if (turn.stage === "NeedsParent") {
					// It has no review to approve; announced once per turn.
					const notice: ApprovalNotice = {
						id: session.registration.id,
						name: session.registration.name,
						kind: "needs_parent",
						turn: turn.scope.turn,
					};
					// The family server announced it, as a question, before it showed up here.
					const announcedByServer = untrack(() => fromServer.delete(turnKey));
					if (once(notice) && !announcedByServer) announce(notice);
					continue;
				}
				if (!turn.review) continue;
				if (turn.stage !== "QuestionPending" && turn.stage !== "AnswerPending") continue;
				present.push(turnKey);
				untrack(() => fromServer.delete(turnKey));
				const kind = turn.stage === "QuestionPending" ? "question" : "answer";
				const review = turn.review.join(",");
				const previous = untrack(() => reviews.get(turnKey));
				if (previous?.kind === kind && previous.review === review) continue;
				untrack(() => reviews.set(turnKey, { kind, review }));
				const notice: ApprovalNotice = {
					id: session.registration.id,
					name: session.registration.name,
					kind,
					turn: turn.scope.turn,
				};
				// A revised answer is a new review of the same kind, announced again; anything
				// else is announced once, even when the family server's alert came first.
				const revised = previous?.kind === kind;
				if (once(notice) || revised) announce(notice);
			}
		}
		untrack(() => {
			for (const key of [...reviews.keys()]) if (!present.includes(key)) reviews.delete(key);
		});
	}

	/** The family server reports a question waiting for a parent as a question. */
	function waitsForParent(alert: ServerApprovalAlert) {
		const session = directory.sessions.find(
			(item) => item.registration.id === alert.registrationId,
		);
		return !!session?.output.turns.some(
			(turn) => turn.scope.turn === alert.turnId && turn.stage === "NeedsParent",
		);
	}

	return {
		async start() {
			if (stopEffects) return;
			const current = ++listening;
			void alerts
				?.listen((alert) => {
					if (!active()) return;
					const notice: ApprovalNotice = {
						id: alert.registrationId,
						name: alert.name,
						kind: waitsForParent(alert) ? "needs_parent" : alert.kind,
						turn: alert.turnId,
					};
					if (!once(notice)) return;
					if (notice.kind === "question")
						untrack(() => fromServer.add(`${notice.id}:${notice.turn}`));
					announce(notice);
				})
				.then((stop) => {
					// Stopped before the listener was ready: let go of it at once.
					if (current === listening) stopAlerts = stop;
					else stop();
				})
				.catch(() => {});
			let signedIn = false;
			stopEffects = $effect.root(() => {
				$effect(() => {
					// Signing in loads that parent's FamBuddies; signing out forgets what was shown.
					const now = active();
					if (now && !signedIn) void directory.refresh().catch(() => {});
					if (!now && signedIn) forget();
					signedIn = now;
				});
				$effect(() => {
					hold();
					scan();
				});
			});
		},
		stop() {
			listening++;
			stopEffects?.();
			stopEffects = undefined;
			stopAlerts?.();
			stopAlerts = undefined;
			for (const id of held) directory.release(id);
			held.clear();
		},
	};
}
export type ApprovalWatch = ReturnType<typeof createApprovalWatch>;

/** What the notification says: which FamBuddy, and whether a question or an answer waits. */
export function approvalMessage(notice: ApprovalNotice) {
	if (notice.kind === "needs_parent")
		return {
			title: `${notice.name} needs you — a question is waiting`,
			body: "FamBuddy couldn't answer it. Open it in Chat to help.",
		};
	return {
		title: `${notice.name} needs your approval`,
		body: `${notice.kind === "question" ? "A question" : "An answer"} is waiting for you in Chat.`,
	};
}
