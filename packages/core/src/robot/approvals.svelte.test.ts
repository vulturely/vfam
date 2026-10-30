import { flushSync } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { approvalMessage, createApprovalWatch, type ApprovalNotice } from "./approvals.svelte";
import type { BuddyTurn } from "./buddy";
import type { FamBuddySession } from "./directory.svelte";
import type { ServerApprovalAlert } from "../repositories/fambuddyApprovals";

function turn(id: string, stage: BuddyTurn["stage"], review: number[] | null = [1]): BuddyTurn {
	return {
		scope: {
			family: "family",
			speaker: "speaker",
			device: "device",
			session: "session",
			turn: id,
			destination_revision: "provider",
		},
		stage,
		text: "never shown",
		review,
		expires_at: new Date(Date.now() + 60000).toISOString(),
		destination: "provider",
	};
}
function session(id: string, turns: BuddyTurn[], paired = true): FamBuddySession {
	return {
		registration: { id, name: id === "kitchen" ? "Kitchen" : "Bedroom", createdAt: "" },
		...(paired ? { pair: {} as never, service: {} as never } : {}),
		output: { settings: [], turns },
		busy: false,
		error: "",
	};
}

let stop: (() => void) | undefined;
afterEach(() => stop?.());

function setup(initial: FamBuddySession[], alerts?: Parameters<typeof createApprovalWatch>[3]) {
	const state = $state({ sessions: initial, signedIn: true });
	const directory = {
		get sessions() {
			return state.sessions;
		},
		refresh: vi.fn(async () => {}),
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
	};
	const notices: ApprovalNotice[] = [];
	const watch = createApprovalWatch(
		directory,
		(notice) => notices.push(notice),
		() => state.signedIn,
		alerts,
	);
	stop = () => watch.stop();
	return { state, directory, notices, watch };
}

it("watches paired FamBuddies and announces each waiting approval once", async () => {
	const { state, directory, notices, watch } = setup([
		session("kitchen", [turn("q", "QuestionPending"), turn("x", "AnswerApproved", null)]),
		session("bedroom", [], false),
	]);
	await watch.start();
	await watch.start();
	flushSync();
	expect(directory.refresh).toHaveBeenCalledOnce();
	expect(directory.acquire).toHaveBeenCalledWith("kitchen");
	expect(directory.acquire).not.toHaveBeenCalledWith("bedroom");
	expect(notices).toEqual([{ id: "kitchen", name: "Kitchen", kind: "question", turn: "q" }]);
	state.sessions = [
		session("kitchen", [turn("q", "QuestionPending"), turn("a", "AnswerPending", [2])]),
	];
	flushSync();
	expect(notices.at(-1)).toEqual({ id: "kitchen", name: "Kitchen", kind: "answer", turn: "a" });
	// A revised answer is a new review, announced again.
	state.sessions = [session("kitchen", [turn("a", "AnswerPending", [3])])];
	flushSync();
	expect(notices).toHaveLength(3);
	state.sessions = [session("kitchen", [turn("a", "AnswerPending", [3])])];
	flushSync();
	expect(notices).toHaveLength(3);
	expect(directory.acquire).toHaveBeenCalledOnce();
});

it("lets go when the parent signs out or a FamBuddy is removed, and reloads on sign-in", async () => {
	const { state, directory, notices, watch } = setup([session("kitchen", [])]);
	await watch.start();
	flushSync();
	state.signedIn = false;
	flushSync();
	expect(directory.release).toHaveBeenCalledWith("kitchen");
	state.sessions = [session("kitchen", [turn("q", "QuestionPending")])];
	flushSync();
	expect(notices).toEqual([]);
	state.signedIn = true;
	flushSync();
	expect(directory.refresh).toHaveBeenCalledTimes(2);
	expect(notices).toHaveLength(1);
	state.sessions = [];
	flushSync();
	expect(directory.release).toHaveBeenCalledTimes(2);
	state.sessions = [session("kitchen", [])];
	flushSync();
	watch.stop();
	expect(directory.release).toHaveBeenCalledTimes(3);
});

it("tries again after a failed watch and tolerates a failed reload", async () => {
	const { state, directory, watch } = setup([session("kitchen", [])]);
	directory.acquire.mockRejectedValueOnce(new Error("offline"));
	directory.refresh.mockRejectedValueOnce(new Error("offline"));
	await watch.start();
	flushSync();
	await Promise.resolve();
	state.sessions = [session("kitchen", [])];
	flushSync();
	expect(directory.acquire).toHaveBeenCalledTimes(2);
});

it("says which FamBuddy and what kind, never the text", () => {
	expect(approvalMessage({ id: "k", name: "Kitchen", kind: "question", turn: "t" })).toEqual({
		title: "Kitchen needs your approval",
		body: "A question is waiting for you in Chat.",
	});
	expect(approvalMessage({ id: "k", name: "Kitchen", kind: "answer", turn: "t" }).body).toBe(
		"An answer is waiting for you in Chat.",
	);
});

it("announces a family-server alert once, whichever source comes first", async () => {
	let send!: (alert: ServerApprovalAlert) => void;
	const unlisten = vi.fn();
	const alerts = {
		listen: vi.fn(async (handler: (alert: ServerApprovalAlert) => void) => {
			send = handler;
			return unlisten;
		}),
	};
	const { state, notices, watch } = setup([session("kitchen", [])], alerts);
	await watch.start();
	await Promise.resolve();
	const alert = (turnId: string, kind: "question" | "answer" = "question") => ({
		registrationId: "kitchen",
		name: "Kitchen",
		kind,
		turnId,
		at: "now",
	});
	send(alert("remote"));
	send(alert("remote"));
	expect(notices).toEqual([{ id: "kitchen", name: "Kitchen", kind: "question", turn: "remote" }]);
	// Seen directly first: the server's copy of the same turn and kind is not announced again.
	state.sessions = [session("kitchen", [turn("q", "QuestionPending")])];
	flushSync();
	send(alert("q"));
	expect(notices).toHaveLength(2);
	send(alert("q", "answer"));
	expect(notices).toHaveLength(3);
	state.signedIn = false;
	flushSync();
	send(alert("later"));
	expect(notices).toHaveLength(3);
	watch.stop();
	expect(unlisten).toHaveBeenCalled();
});

it("announces a question FamBuddy couldn't answer once per turn", async () => {
	const { state, notices, watch } = setup([
		session("kitchen", [turn("q", "QuestionPending"), turn("n", "NeedsParent", null)]),
	]);
	await watch.start();
	flushSync();
	expect(notices).toEqual([
		{ id: "kitchen", name: "Kitchen", kind: "question", turn: "q" },
		{ id: "kitchen", name: "Kitchen", kind: "needs_parent", turn: "n" },
	]);
	// The approved question later waits for a parent: that is announced too, once.
	state.sessions = [
		session("kitchen", [turn("q", "NeedsParent", null), turn("n", "NeedsParent", null)]),
	];
	flushSync();
	state.sessions = [session("kitchen", [turn("q", "NeedsParent", null)])];
	flushSync();
	expect(notices.slice(2)).toEqual([
		{ id: "kitchen", name: "Kitchen", kind: "needs_parent", turn: "q" },
	]);
});

it("treats a family-server alert for a waiting question as needing the parent", async () => {
	let send!: (alert: ServerApprovalAlert) => void;
	const alerts = {
		listen: vi.fn(async (handler: (alert: ServerApprovalAlert) => void) => {
			send = handler;
			return () => {};
		}),
	};
	const { notices, watch } = setup([session("kitchen", [turn("n", "NeedsParent", null)])], alerts);
	await watch.start();
	await Promise.resolve();
	flushSync();
	send({ registrationId: "kitchen", name: "Kitchen", kind: "question", turnId: "n", at: "now" });
	send({ registrationId: "other", name: "Other", kind: "question", turnId: "n", at: "now" });
	expect(notices).toEqual([
		{ id: "kitchen", name: "Kitchen", kind: "needs_parent", turn: "n" },
		{ id: "other", name: "Other", kind: "question", turn: "n" },
	]);
});

it("words a waiting question so the parent knows FamBuddy needs them", () => {
	expect(approvalMessage({ id: "k", name: "Kitchen", kind: "needs_parent", turn: "t" })).toEqual({
		title: "Kitchen needs you — a question is waiting",
		body: "FamBuddy couldn't answer it. Open it in Chat to help.",
	});
});

function serverAlerts() {
	let send!: (alert: ServerApprovalAlert) => void;
	const unlisten = vi.fn();
	const alerts = {
		listen: vi.fn(async (handler: (alert: ServerApprovalAlert) => void) => {
			send = handler;
			return unlisten;
		}),
	};
	const alert = (turnId: string, kind: "question" | "answer" = "question") =>
		send({ registrationId: "kitchen", name: "Kitchen", kind, turnId, at: "now" });
	return { alerts, alert, unlisten };
}

it("does not announce again what the family server announced first", async () => {
	const { alerts, alert } = serverAlerts();
	const { state, notices, watch } = setup([session("kitchen", [])], alerts);
	await watch.start();
	await Promise.resolve();
	alert("q");
	alert("n");
	expect(notices).toHaveLength(2);
	// The FamBuddy then shows the same question, and the question it couldn't answer.
	state.sessions = [
		session("kitchen", [turn("q", "QuestionPending"), turn("n", "NeedsParent", null)]),
	];
	flushSync();
	expect(notices).toHaveLength(2);
	// Its answer is new; a revision of that answer is announced again.
	state.sessions = [session("kitchen", [turn("q", "AnswerPending", [2])])];
	flushSync();
	state.sessions = [session("kitchen", [turn("q", "AnswerPending", [3])])];
	flushSync();
	expect(notices.slice(2)).toEqual([
		{ id: "kitchen", name: "Kitchen", kind: "answer", turn: "q" },
		{ id: "kitchen", name: "Kitchen", kind: "answer", turn: "q" },
	]);
	// A question seen directly first, then reported late by the server, still announces
	// that it later needs the parent.
	state.sessions = [session("kitchen", [turn("late", "QuestionPending")])];
	flushSync();
	alert("late");
	state.sessions = [session("kitchen", [turn("late", "NeedsParent", null)])];
	flushSync();
	expect(notices.slice(4).map((notice) => notice.kind)).toEqual(["question", "needs_parent"]);
});

it("lets go of the server listener when stopped before it was ready", async () => {
	const { alerts, unlisten } = serverAlerts();
	const { watch } = setup([], alerts);
	void watch.start();
	watch.stop();
	await Promise.resolve();
	await Promise.resolve();
	expect(unlisten).toHaveBeenCalledOnce();
});

it("forgets what it announced on sign-out and remembers a bounded number", async () => {
	const { alerts, alert } = serverAlerts();
	const { state, notices, watch } = setup([session("kitchen", [])], alerts);
	await watch.start();
	await Promise.resolve();
	flushSync();
	for (let index = 0; index <= 500; index++) alert(`t${index}`);
	expect(notices).toHaveLength(501);
	// The oldest one was forgotten; the newest is still remembered.
	alert("t0");
	alert("t500");
	expect(notices).toHaveLength(502);
	state.signedIn = false;
	flushSync();
	state.signedIn = true;
	flushSync();
	alert("t500");
	expect(notices).toHaveLength(503);
});
