<script lang="ts">
	import { DropdownMenu as Menu } from "bits-ui";
	import MoreHorizontal from "lucide-svelte/icons/ellipsis";
	import UiFilePenLine from "lucide-svelte/icons/file-pen-line";
	import UiUserPlus from "lucide-svelte/icons/user-plus";
	import Check from "lucide-svelte/icons/check";
	import Plus from "lucide-svelte/icons/plus";
	import Phone from "lucide-svelte/icons/phone";
	import Video from "lucide-svelte/icons/video";
	import Settings from "lucide-svelte/icons/settings-2";
	import CallScreen from "./CallScreen.svelte";
	import Paperclip from "lucide-svelte/icons/paperclip";
	import X from "lucide-svelte/icons/x";
	import LockKeyhole from "lucide-svelte/icons/lock-keyhole";
	import ChevronDown from "lucide-svelte/icons/chevron-down";
	import { AlertDialog, Dialog } from "bits-ui";
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiShieldCheck from "lucide-svelte/icons/shield-check";
	import UiShieldOff from "lucide-svelte/icons/shield-off";
	import UiUsers from "lucide-svelte/icons/users";
	import UiMessageCircle from "lucide-svelte/icons/message-circle";
	import UiTrash2 from "lucide-svelte/icons/trash-2";
	import UiDownload from "lucide-svelte/icons/download";
	import UiSend from "lucide-svelte/icons/send";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import ChatComposerEditor from "./ChatComposerEditor.svelte";
	import BuddyConversation from "../robot/BuddyConversation.svelte";
	import BuddyConversationList from "../robot/BuddyConversationList.svelte";
	import { renderChatRichText } from "../chat/richText";
	import { getContext, onMount, onDestroy, tick } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { ChatStatus, ChatRoom, ChatMessage, ChatDevice, ChatPayload } from "../chat/service";
	import type { ChatPeople, ChatPerson } from "../chat/people";
	import { createChatViewState } from "../chat/viewState.svelte";
	import { Button, ErrorToast, IconButton } from "../components/index";
	const runtime = getContext<Runtime>("vulture:runtime");
	function logChatUi(event: string, details: Record<string, unknown>) {
		if (import.meta.env.DEV) console.debug("[chat-ui]", event, details);
	}
	const emptyChatDocument = JSON.stringify({
		type: "doc",
		content: [{ type: "paragraph" }],
	});
	// Kept for the session, so returning to chat shows the same conversation at once.
	const view = runtime.services.chatView ?? createChatViewState();
	// Read before the first save-back below replaces them with this mount's values.
	const kept = {
		roomId: view.roomId,
		title: view.title,
		selectedPeer: view.selectedPeer,
		selectedChannel: view.selectedChannel,
	};
	let status = $state<ChatStatus | undefined>(view.status);
	/** A child's new device can read and send only after a parent approves it. */
	const awaitingApproval = $derived(
		status?.devices.some(
			(device) =>
				device.deviceId === status?.identity.deviceId && !device.approved && !device.revoked,
		) ?? false,
	);
	let members = $state<ChatPerson[]>(view.members);
	let me = $state<ChatPeople["self"] | undefined>(view.me);
	let roomId = $state("");
	let selectedBuddyId = $state(runtime.router?.current?.params?.["buddy"] ?? "");
	// Drafts stay in memory and are scoped to their intended conversation.
	const drafts = view.drafts;
	const roomMessagesCache = view.roomMessages;
	const pendingLocalMessages = view.pendingMessages;
	function activateRoom(next: string) {
		if (roomId)
			drafts.set(roomId, {
				text,
				richTextJson,
				files: files ? Array.from(files) : undefined,
			});
		channelAction = undefined;
		channelActionOpen = false;
		selectedBuddyId = "";
		roomId = next;
		const cachedMessages = roomMessagesCache.get(next);
		messages = cachedMessages ?? [];
		synchronized = cachedMessages !== undefined;
		messageLoading = false;
		const draft = drafts.get(next);
		text = draft?.text ?? "";
		richTextJson = draft?.richTextJson ?? emptyChatDocument;
		if (attachmentInput) {
			if (draft?.files && typeof DataTransfer !== "undefined") {
				const restored = new DataTransfer();
				for (const file of draft.files) restored.items.add(file);
				attachmentInput.files = restored.files;
				files = attachmentInput.files;
			} else {
				files = undefined;
				attachmentInput.value = "";
			}
		} else {
			files = undefined;
		}
		notice = "";
	}
	let channelForm = $state(false);
	let channelName = $state("");
	let channelMembers = $state<string[]>([]);
	let selectedChannel = $state(view.selectedChannel);
	let channelAction = $state<"rename" | "member" | undefined>();
	let channelActionOpen = $state(false);
	let channelActionRoomId = $state("");
	let channelActionName = $state("");
	let channelActionMember = $state("");
	function selectBuddy(id: string) {
		selectedBuddyId = id;
		roomId = "";
		selectedPeer = undefined;
		selectedChannel = "";
		messages = [];
		notice = "";
	}
	async function selectChannel(room: ChatRoom) {
		await run(async () => {
			activateRoom(room.roomId);
			selectedChannel = room.roomId;
			selectedPeer = undefined;
			title = room.name || "Private channel";
			await sync();
		});
	}
	async function createChannel(event: { preventDefault(): void }) {
		event.preventDefault();
		await run(async () => {
			const room = await runtime.services.chat.createChannel(channelName, channelMembers);
			if (status) status = { ...status, rooms: [...status.rooms, room] };
			channelForm = false;
			channelName = "";
			channelMembers = [];
			activateRoom(room.roomId);
			selectedChannel = room.roomId;
			selectedPeer = undefined;
			title = room.name || "Private channel";
			await sync();
		});
	}
	let title = $state(view.title);
	let messages = $state<ChatMessage[]>([]);
	let messageLoading = $state(false);
	let attachmentPreviews = $state<Record<string, string>>({});
	let loadingPreviews = $state(new Set<string>());
	const observedAttachments = new SvelteMap<Element, NonNullable<ChatPayload["attachment"]>>();
	let attachmentObserver: globalThis.IntersectionObserver | undefined;
	let text = $state("");
	let richTextJson = $state(emptyChatDocument);
	let files = $state<globalThis.FileList>();
	let draftImagePreview = $state<string>();
	let attachmentUploadPhase = $state<"preparing" | "uploading" | "saving">();
	let attachmentUploadProgress = $state(0);
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");
	let notifications = $state(view.notifications);
	let memberNames = $state<Record<string, string>>(view.memberNames);
	let selectedPeer = $state<string | undefined>(view.selectedPeer);
	let securityOpen = $state(view.securityOpen);
	let attachmentInput = $state<globalThis.HTMLInputElement>();
	let attachmentAccept = $state("*/*");
	function pickAttachment(kind: "image" | "file" | "video") {
		attachmentAccept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "*/*";
		attachmentInput?.click();
	}
	function addComposerFiles(selected: File[]) {
		const file = selected[0];
		if (!file) return;
		const transfer = new globalThis.DataTransfer();
		transfer.items.add(file);
		files = transfer.files;
		if (attachmentInput) attachmentInput.files = transfer.files;
	}
	$effect(() => {
		const file = files?.[0];
		if (!file?.type.startsWith("image/")) {
			draftImagePreview = undefined;
			return;
		}
		const previewUrl = URL.createObjectURL(file);
		draftImagePreview = previewUrl;
		return () => URL.revokeObjectURL(previewUrl);
	});
	let messagePane = $state<globalThis.HTMLOListElement>();
	let deleteOpen = $state(false),
		deleteId = $state("");
	let deleteTarget = $state<"message" | "channel">("message");
	const needsVerification = $derived(
		status?.devices.filter(
			(device) => !device.approved || status?.pins[device.deviceId] !== device.fingerprint,
		).length ?? 0,
	);
	function accountName(id: string) {
		return id === me?.id ? "You" : memberNames[id] || "Family member";
	}
	async function removeMessage() {
		await run(async () => {
			if (deleteTarget === "channel") {
				const deletingRoomId = deleteId;
				await runtime.services.chat.deleteChannel(deletingRoomId);
				roomMessagesCache.delete(deletingRoomId);
				if (status)
					status = {
						...status,
						rooms: status.rooms.filter((room) => room.roomId !== deletingRoomId),
					};
				if (roomId === deletingRoomId) {
					roomId = "";
					selectedChannel = "";
					selectedPeer = undefined;
					messages = [];
				}
			} else {
				const deleted = messages.find((message) => message.messageId === deleteId);
				if (deleted) {
					for (const [clientId, pending] of pendingLocalMessages) {
						if (
							pending.message.accountId === deleted.accountId &&
							pending.message.payload?.text === deleted.payload?.text &&
							Math.abs(pending.message.createdAt - deleted.createdAt) < 120
						)
							pendingLocalMessages.delete(clientId);
					}
				}
				await runtime.services.chat.remove(roomId, deleteId);
			}
			deleteOpen = false;
			deleteId = "";
			if (roomId) await sync();
		});
	}
	function editChannel(action: "rename" | "member", room: ChatRoom) {
		channelAction = action;
		channelActionOpen = true;
		channelActionRoomId = room.roomId;
		channelActionName = room.name || "";
		channelActionMember = "";
	}
	async function submitChannelAction(event: { preventDefault(): void }) {
		event.preventDefault();
		await run(async () => {
			if (channelAction === "rename") {
				const room = await runtime.services.chat.renameChannel(
					channelActionRoomId,
					channelActionName,
				);
				if (roomId === room.roomId) title = room.name || "Private channel";
				if (status)
					status = {
						...status,
						rooms: status.rooms.map((item) => (item.roomId === room.roomId ? room : item)),
					};
			} else if (channelAction === "member" && channelActionMember) {
				const room = await runtime.services.chat.addChannelMember(
					channelActionRoomId,
					channelActionMember,
				);
				if (status)
					status = {
						...status,
						rooms: status.rooms.map((item) => (item.roomId === room.roomId ? room : item)),
					};
			}
			channelAction = undefined;
			channelActionOpen = false;
			channelActionMember = "";
			if (roomId) await sync();
		});
	}
	let callActive = $state(false);
	let callPanel = $state<{
		show(): void;
		begin(video: boolean, accountId?: string): Promise<void>;
	}>();
	let disposed = false;
	let synchronized = false;
	let unsubscribeChat: (() => void) | undefined;
	let refreshPending = false;
	async function run(operation: () => Promise<void>) {
		if (busy || disposed) return;
		busy = true;
		error = "";
		try {
			await operation();
		} catch (cause) {
			if (!disposed)
				error = cause instanceof Error ? cause.message : "Chat unavailable. Please retry.";
		} finally {
			if (!disposed) busy = false;
		}
	}
	let refreshing = false;
	/** Background refreshes keep the screen usable; overlapping ones are folded into one. */
	async function quiet(operation: () => Promise<void>) {
		if (disposed) return;
		if (refreshing) {
			refreshPending = true;
			return;
		}
		refreshing = true;
		try {
			await operation();
		} catch (cause) {
			if (!disposed)
				error = cause instanceof Error ? cause.message : "Chat unavailable. Please retry.";
		} finally {
			refreshing = false;
			if (refreshPending && !disposed && roomId) {
				refreshPending = false;
				queueMicrotask(() => void quiet(refreshChatState));
			}
		}
	}
	function chatChanged() {
		if (disposed) return;
		// A parent's approval changes the family chat state; start again to pick it up.
		if (awaitingApproval) {
			void quiet(async () => {
				await load();
				await sync();
			});
			return;
		}
		if (!roomId) return;
		logChatUi("socket-change", { busy, roomSelected: true });
		void quiet(refreshChatState);
	}
	async function refreshChatState() {
		const rooms = await runtime.services.chat.refreshRooms();
		if (status) status = { ...status, rooms };
		if (roomId && !rooms.some((room) => room.roomId === roomId)) {
			roomMessagesCache.delete(roomId);
			roomId = "";
			selectedChannel = "";
			selectedPeer = undefined;
			messages = [];
			title = "Family group";
			return;
		}
		await sync();
	}
	async function toggleNotifications(event: globalThis.Event) {
		const checkbox = event.currentTarget as globalThis.HTMLInputElement;
		const enabled = checkbox.checked;
		checkbox.checked = false;
		notifications = false;
		if (!enabled) return;
		error = "";
		try {
			await runtime.services.chat.notify(true);
			if (!disposed) notifications = true;
		} catch (cause) {
			if (!disposed)
				error = cause instanceof Error ? cause.message : "Notifications are unavailable.";
		}
	}
	async function load() {
		const people = await runtime.services.chatPeople.load();
		const next = await runtime.services.chat.start(people.self.id, people.familyId);
		if (!disposed) {
			// Another person's conversations, messages and drafts must never carry over.
			if (view.owner && view.owner !== people.self.id) {
				view.reset();
				roomId = "";
				messages = [];
			}
			view.owner = people.self.id;
			me = people.self;
			memberNames = Object.fromEntries(
				people.members.flatMap((member) => (member.name ? [[member.accountId, member.name]] : [])),
			);
			if (
				next.devices.some(
					(device) => !device.approved || next.pins[device.deviceId] !== device.fingerprint,
				)
			)
				securityOpen = true;
			status = next;
			members = people.members;
		}
	}

	async function sync() {
		if (!roomId || awaitingApproval) return;
		const syncingRoomId = roomId;
		const syncStartedAt = globalThis.performance.now();
		const cacheHit = roomMessagesCache.has(syncingRoomId);
		const followLatest =
			!synchronized ||
			!messagePane ||
			messagePane.scrollHeight - messagePane.clientHeight - messagePane.scrollTop < 80;
		if (!roomMessagesCache.has(syncingRoomId)) messageLoading = true;
		let next: ChatMessage[];
		try {
			next = await runtime.services.chat.sync(syncingRoomId);
		} catch (cause) {
			if (roomId === syncingRoomId) messageLoading = false;
			logChatUi("messages-sync-failed", {
				durationMs: Math.round(globalThis.performance.now() - syncStartedAt),
			});
			throw cause;
		}
		const visibleMessages = [...next];
		const serverClientIds = new Set(next.map((message) => message.clientId));
		for (const [clientId, pending] of pendingLocalMessages) {
			if (pending.roomId !== syncingRoomId) continue;
			const matched =
				serverClientIds.has(clientId) ||
				next.some(
					(message) =>
						message.accountId === pending.message.accountId &&
						message.payload?.text === pending.message.payload?.text &&
						Math.abs(message.createdAt - pending.message.createdAt) < 120,
				);
			if (matched) pendingLocalMessages.delete(clientId);
			else visibleMessages.push(pending.message);
		}
		visibleMessages.sort((a, b) => a.sequence - b.sequence);
		roomMessagesCache.set(syncingRoomId, visibleMessages);
		if (roomId !== syncingRoomId || disposed) return;
		if (
			synchronized &&
			next.some(
				(m) => !messages.some((old) => old.messageId === m.messageId) && m.accountId !== me?.id,
			)
		) {
			notice = "New family message";
			if (notifications)
				void runtime.services.chat.notify().catch(() => {
					notice = "New family message. Notifications are unavailable.";
				});
		}
		messages = visibleMessages;
		synchronized = true;
		messageLoading = false;
		await tick();
		if (!disposed && followLatest && messagePane) messagePane.scrollTop = messagePane.scrollHeight;
		logChatUi("messages-synced", {
			durationMs: Math.round(globalThis.performance.now() - syncStartedAt),
			messageCount: visibleMessages.length,
			cacheHit,
		});
	}
	async function loadAttachmentPreview(attachment: NonNullable<ChatPayload["attachment"]>) {
		const key = attachment.objectKey;
		if (attachmentPreviews[key] || loadingPreviews.has(key)) return;
		loadingPreviews.add(key);
		try {
			const bytes = await runtime.services.chat.downloadAttachment(attachment);
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes)], { type: attachment.mediaType }),
			);
			if (disposed || !messages.some((message) => message.payload?.attachment?.objectKey === key))
				URL.revokeObjectURL(url);
			else attachmentPreviews = { ...attachmentPreviews, [key]: url };
		} catch {
			// Keep the download action available when inline preview cannot load.
		} finally {
			loadingPreviews.delete(key);
		}
	}
	function observeAttachment(
		node: HTMLDivElement,
		attachment: NonNullable<ChatPayload["attachment"]>,
	) {
		if (typeof globalThis.IntersectionObserver === "undefined") {
			void loadAttachmentPreview(attachment);
			return { update() {}, destroy() {} };
		}
		attachmentObserver ??= new globalThis.IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const current = observedAttachments.get(entry.target);
					attachmentObserver?.unobserve(entry.target);
					observedAttachments.delete(entry.target);
					if (current) void loadAttachmentPreview(current);
				}
			},
			{ root: messagePane, rootMargin: "160px 0px" },
		);
		observedAttachments.set(node, attachment);
		attachmentObserver.observe(node);
		return {
			update(next: NonNullable<ChatPayload["attachment"]>) {
				observedAttachments.set(node, next);
			},
			destroy() {
				attachmentObserver?.unobserve(node);
				observedAttachments.delete(node);
			},
		};
	}
	async function open(peer?: string) {
		await run(async () => {
			const room = await runtime.services.chat.open(peer);
			activateRoom(room.roomId);
			selectedPeer = peer;
			selectedChannel = "";
			title = peer ? `Conversation with ${accountName(peer)}` : "Family group";
			messages = [];
			synchronized = false;
			await sync();
		});
	}
	async function approve(device: ChatDevice) {
		await run(async () => {
			await runtime.services.chat.approve(device);
			await load();
		});
	}
	async function send(event?: { preventDefault(): void }) {
		event?.preventDefault();
		if (!text.trim() && !files?.length) return;
		if (busy || awaitingApproval) return;
		const sendStartedAt = globalThis.performance.now();
		const sendingText = text;
		const sendingRichText = richTextJson;
		const sendingFile = files?.[0];
		let optimistic: ChatMessage | undefined;
		if (sendingText.trim() && me) {
			const clientId = crypto.randomUUID();
			optimistic = {
				messageId: `pending:${clientId}`,
				clientId,
				sequence: Math.max(0, ...messages.map((message) => message.sequence)) + 1,
				generation: 0,
				deviceId: status?.identity.deviceId ?? "",
				accountId: me.id,
				createdAt: Math.floor(Date.now() / 1000),
				deleted: false,
				payload: {
					text: sendingText.trim(),
					...(sendingRichText ? { richText: sendingRichText } : {}),
				},
			};
			pendingLocalMessages.set(clientId, { roomId, message: optimistic });
			messages = [...messages, optimistic];
			roomMessagesCache.set(roomId, messages);
			await tick();
			if (messagePane) messagePane.scrollTop = messagePane.scrollHeight;
			logChatUi("optimistic-message", {
				elapsedMs: Math.round(globalThis.performance.now() - sendStartedAt),
			});
		}
		if (!sendingFile) {
			// Text sends never lock the screen: the box clears at once and the message
			// shows as sending; on failure the text comes back so nothing is lost.
			const sendingRoom = roomId;
			text = "";
			richTextJson = emptyChatDocument;
			drafts.delete(sendingRoom);
			error = "";
			try {
				await runtime.services.chat.send(
					sendingRoom,
					sendingText,
					undefined,
					undefined,
					sendingRichText,
				);
				logChatUi("message-send-accepted", {
					durationMs: Math.round(globalThis.performance.now() - sendStartedAt),
					hasAttachment: false,
				});
			} catch (cause) {
				if (optimistic) {
					pendingLocalMessages.delete(optimistic.clientId);
					const kept = (roomMessagesCache.get(sendingRoom) ?? []).filter(
						(message) => message.messageId !== optimistic?.messageId,
					);
					roomMessagesCache.set(sendingRoom, kept);
					if (roomId === sendingRoom) messages = kept;
				}
				if (disposed) return;
				error = cause instanceof Error ? cause.message : "Chat unavailable. Please retry.";
				if (roomId === sendingRoom && !text.trim()) {
					text = sendingText;
					richTextJson = sendingRichText;
				} else drafts.set(sendingRoom, { text: sendingText, richTextJson: sendingRichText });
			}
			return;
		}
		await run(async () => {
			const file = sendingFile;
			attachmentUploadProgress = 0;
			attachmentUploadPhase = file ? "preparing" : undefined;
			try {
				await runtime.services.chat.send(
					roomId,
					sendingText,
					file,
					(progress) => {
						attachmentUploadProgress = progress;
						attachmentUploadPhase = progress >= 1 ? "saving" : "uploading";
					},
					sendingRichText,
				);
				logChatUi("message-send-accepted", {
					durationMs: Math.round(globalThis.performance.now() - sendStartedAt),
					hasAttachment: Boolean(file),
				});
				text = "";
				richTextJson = emptyChatDocument;
				files = undefined;
				if (attachmentInput) attachmentInput.value = "";
				// Render local message now. Socket notification refreshes canonical
				// history without holding the composer open for a full resync.
			} catch (cause) {
				if (optimistic) {
					pendingLocalMessages.delete(optimistic.clientId);
					messages = messages.filter((message) => message.messageId !== optimistic?.messageId);
					roomMessagesCache.set(roomId, messages);
				}
				throw cause;
			} finally {
				attachmentUploadPhase = undefined;
				attachmentUploadProgress = 0;
			}
		});
	}
	async function download(attachment: NonNullable<ChatPayload["attachment"]>) {
		try {
			const bytes = await runtime.services.chat.downloadAttachment(attachment);
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes)], { type: attachment.mediaType }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = attachment.name;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Download failed.";
		}
	}
	// Everything the screen shows is written back, so it survives leaving the page.
	$effect(() => {
		Object.assign(view, {
			status,
			members,
			me,
			memberNames,
			roomId,
			title,
			selectedPeer,
			selectedChannel,
			securityOpen,
			notifications,
		});
	});
	/** Shows the kept conversation at once, then refreshes it quietly. */
	function restore() {
		if (!kept.roomId) return;
		activateRoom(kept.roomId);
		title = kept.title;
		selectedPeer = kept.selectedPeer;
		selectedChannel = kept.selectedChannel;
	}
	onMount(() => {
		if (!runtime.state.childSession) void runtime.services.fambuddy?.refresh();
		const resumed = status !== undefined;
		if (resumed) restore();
		void (resumed ? quiet : run)(async () => {
			if (resumed) {
				// The chat session may have been reset meanwhile; start it again if so.
				try {
					await refreshChatState();
				} catch {
					await load();
				}
			} else await load();
			if (!disposed) unsubscribeChat = runtime.services.chat.subscribe(chatChanged);
		});
		if (runtime.router?.current?.screen === "calls") void tick().then(() => callPanel?.show());
	});
	onDestroy(() => {
		disposed = true;
		// The open conversation's unsent text is kept like any other draft.
		if (roomId)
			drafts.set(roomId, {
				text,
				richTextJson,
				files: files ? Array.from(files) : undefined,
			});
		unsubscribeChat?.();
		attachmentObserver?.disconnect();
		observedAttachments.clear();
		for (const url of Object.values(attachmentPreviews)) URL.revokeObjectURL(url);
		attachmentPreviews = {};
		// Messages, drafts and the chat session stay for when chat is opened again.
	});
</script>

<section class="chat-screen" aria-label="Private family chat">
	<header class="chat-page-header">
		<div class="chat-brand">
			<UiMessageCircle size={21} strokeWidth={1.6} aria-hidden="true" />
			<div>
				<h1>Chat &amp; calls</h1>
				<p><LockKeyhole size={11} aria-hidden="true" />End-to-end encrypted</p>
			</div>
		</div>
		<div class="header-actions">
			<IconButton
				icon={Settings}
				label={callActive ? "Return to call" : "Call settings"}
				active={callActive}
				onclick={() => callPanel?.show()}
			/>
			<IconButton
				label="Reload devices and conversations"
				icon={UiRefreshCw}
				disabled={busy}
				onclick={() => run(load)}
			/>
		</div>
	</header>
	<ErrorToast message={error} />
	{#if notice}<p class="feedback" role="status" aria-live="polite">
			{notice}
		</p>{/if}
	<div class="chat-layout">
		<aside class="chat-sidebar" aria-label="Chat conversations">
			<div class="conversation-heading">
				Conversations <IconButton
					icon={Plus}
					label="Create channel"
					disabled={busy || !status}
					onclick={() => (channelForm = !channelForm)}
				/>
			</div>
			{#if channelForm}
				<form class="channel-form" onsubmit={createChannel}>
					<label for="channel-name">Channel name</label>
					<div class="channel-name-row">
						<input
							id="channel-name"
							aria-label="Channel name"
							bind:value={channelName}
							maxlength="80"
							required
							placeholder="e.g. Weekend plans"
						/>
						<IconButton
							icon={Check}
							label="Save channel"
							type="submit"
							disabled={busy || !channelName.trim() || !channelMembers.length}
						/>
						<IconButton
							icon={X}
							label="Cancel channel"
							onclick={() => {
								channelForm = false;
								channelName = "";
								channelMembers = [];
							}}
						/>
					</div>
					<fieldset>
						<legend>Choose members</legend>
						{#each members.filter((member) => member.accountId !== me?.id) as member (member.accountId)}
							<label class="channel-member"
								><input
									type="checkbox"
									value={member.accountId}
									bind:group={channelMembers}
								/>{accountName(member.accountId)}</label
							>
						{/each}
					</fieldset>
					<small
						>Only selected members can access this channel. You’re included automatically.</small
					>
				</form>
			{/if}
			{#if busy && !status}<p class="sidebar-help" role="status">Connecting securely…</p>{/if}
			{#if status}
				<nav class="conversations" aria-label="Conversations">
					<button
						type="button"
						class:current={!!roomId && !selectedPeer && !selectedChannel}
						aria-label="Family group"
						aria-pressed={!!roomId && !selectedPeer && !selectedChannel}
						disabled={busy}
						onclick={() => open()}
						><span class="conversation-avatar"><UiUsers size={18} aria-hidden="true" /></span><span
							><strong>Family group</strong><small>Everyone in your family</small></span
						></button
					>
					{#each status.rooms.filter((room) => room.name) as room (room.roomId)}
						<div class="channel-row">
							<button
								type="button"
								class="channel-select"
								class:current={selectedChannel === room.roomId}
								aria-pressed={selectedChannel === room.roomId}
								disabled={busy}
								onclick={() => selectChannel(room)}
								><span class="conversation-avatar"><UiUsers size={18} aria-hidden="true" /></span
								><span
									><strong>{room.name}</strong><small
										>{room.participants.length} members · Private channel</small
									></span
								></button
							>
							<Menu.Root>
								<Menu.Trigger
									class="channel-row-menu-trigger"
									aria-label={`Actions for ${room.name}`}
									title="Channel actions"
									disabled={busy}><MoreHorizontal size={18} aria-hidden="true" /></Menu.Trigger
								>
								<Menu.Portal>
									<Menu.Content
										class="channel-menu-content"
										sideOffset={5}
										align="end"
										collisionPadding={8}
									>
										<Menu.Item
											class="channel-menu-item"
											onSelect={() => editChannel("rename", room)}
											><UiFilePenLine size={15} aria-hidden="true" />Rename channel</Menu.Item
										>
										{#if members.some((member) => !room.participants.includes(member.accountId))}
											<Menu.Item
												class="channel-menu-item"
												onSelect={() => editChannel("member", room)}
												><UiUserPlus size={15} aria-hidden="true" />Add member</Menu.Item
											>
										{/if}
										<Menu.Item
											class="channel-menu-item channel-menu-danger"
											onSelect={() => {
												deleteTarget = "channel";
												deleteId = room.roomId;
												deleteOpen = true;
											}}><UiTrash2 size={15} aria-hidden="true" />Delete channel</Menu.Item
										>
									</Menu.Content>
								</Menu.Portal>
							</Menu.Root>
						</div>
					{/each}
					{#each members.filter((member) => member.accountId !== me?.id) as member (member.accountId)}
						<button
							type="button"
							class:current={selectedPeer === member.accountId}
							aria-label={`Message ${member.accountId}`}
							aria-pressed={selectedPeer === member.accountId}
							disabled={busy}
							onclick={() => open(member.accountId)}
							><span class="conversation-avatar">{accountName(member.accountId).charAt(0)}</span
							><span
								><strong>{accountName(member.accountId)}</strong><small>Private conversation</small
								></span
							></button
						>
					{/each}
				</nav>
				{#if !me?.child}<BuddyConversationList
						sessions={runtime.services.fambuddy?.sessions ?? []}
						selectedId={selectedBuddyId}
						onSelect={selectBuddy}
					/>{/if}
				<details class="security" bind:open={securityOpen}>
					<summary
						><UiShieldCheck size={16} aria-hidden="true" /><span>Device security</span
						>{#if needsVerification}<span class="verification-count">{needsVerification}</span
							>{/if}<ChevronDown size={14} aria-hidden="true" /></summary
					>
					<div class="accordion-body security-body">
						<p>
							Device security is checked automatically when you sign in. Approved family devices
							connect securely. You’ll be warned if a known device’s key changes.
						</p>
						<p>
							<UiShieldCheck size={14} aria-hidden="true" />
							Security keys are managed by the app. No codes to compare.
						</p>
						{#each status.devices as device (device.deviceId)}
							<div class="device">
								<div class="device-heading">
									<strong
										>{accountName(device.accountId)} · {device.deviceId === status.identity.deviceId
											? "This device"
											: "Family device"}</strong
									>
									<div class="device-actions">
										{#if !device.approved && me?.manager}
											<IconButton
												icon={UiShieldCheck}
												label="Approve device"
												disabled={busy}
												onclick={() => approve(device)}
											/>
										{/if}
										{#if me?.manager || device.accountId === me?.id}
											<IconButton
												icon={UiShieldOff}
												label="Revoke device"
												class="device-revoke"
												disabled={busy}
												onclick={() =>
													run(async () => {
														await runtime.services.chat.revoke(device.deviceId);
														roomId = "";
														messages = [];
														await load();
													})}
											/>
										{/if}
									</div>
								</div>
								<span
									>{!device.approved
										? "Pending guardian approval"
										: status.pins[device.deviceId] === device.fingerprint
											? "Security key registered automatically"
											: "Security key changed — chat paused"}</span
								>
							</div>
						{/each}
						<p>
							New devices are registered after sign-in. Pending devices need a guardian to allow
							access. Earlier history cannot be recovered without an existing device.
						</p>

						<label class="chat-notifications"
							><input
								type="checkbox"
								checked={notifications}
								onchange={(event) => void toggleNotifications(event)}
							/><span>Notifications without message previews</span></label
						>
					</div>
				</details>
			{:else if !busy}<p class="sidebar-help">Use refresh to reconnect.</p>{/if}
		</aside>
		<div class="conversation-pane">
			{#if selectedBuddyId}
				{#key selectedBuddyId}<BuddyConversation id={selectedBuddyId} />{/key}
			{:else}
				<header class="conversation-header">
					<div>
						<h2>{roomId ? title : "Your family, together"}</h2>
						<p>
							{roomId
								? "Private messages · 30-day history"
								: "Choose a conversation to get started."}
						</p>
					</div>
					{#if roomId}<div class="header-actions">
							<IconButton
								icon={Phone}
								label="Start audio call"
								onclick={() => void callPanel?.begin(false, selectedPeer)}
							/><IconButton
								icon={Video}
								label="Start video call"
								onclick={() => void callPanel?.begin(true, selectedPeer)}
							/><IconButton
								icon={UiRefreshCw}
								label="Refresh messages"
								disabled={busy}
								onclick={() => run(sync)}
							/><IconButton
								icon={UiTrash2}
								label="Discard unsent messages"
								disabled={busy}
								onclick={() =>
									run(async () => {
										await runtime.services.chat.discardPending(roomId);
										await sync();
									})}
							/>
						</div>{/if}
				</header>
				{#if roomId}
					<ol class="messages" aria-label="Messages" bind:this={messagePane}>
						{#if awaitingApproval}<li class="empty-messages" role="status">
								<LockKeyhole size={28} strokeWidth={1.2} aria-hidden="true" />
								<p>
									Waiting for a parent to approve this device. A parent can approve it in Chat under
									Device security; messages appear here once it is approved.
								</p>
							</li>
						{:else if messageLoading && !messages.length}<li class="messages-loading" role="status">
								<LoaderCircle size={24} aria-hidden="true" />
								<span>Loading messages…</span>
							</li>
						{:else if !messages.length}<li class="empty-messages">
								<UiMessageCircle size={28} strokeWidth={1.2} aria-hidden="true" />
								<p>No messages yet. Start the conversation.</p>
							</li>
						{:else}{#each messages as message (message.messageId)}
								<li class:own={message.accountId === me?.id}>
									<div class="message-bubble">
										<div class="message-meta">
											<strong>{accountName(message.accountId)}</strong><time
												datetime={new Date(message.createdAt * 1000).toISOString()}
												>{new Date(message.createdAt * 1000).toLocaleTimeString([], {
													hour: "numeric",
													minute: "2-digit",
												})}</time
											>
										</div>
										{#if message.unavailable}<p>
												This message is unavailable on this device.
											</p>{:else if message.payload}
											{#if message.payload.richText}<div class="body rich-body">
													<!-- Rich text serializer escapes user text and only emits allowlisted tags and URL schemes. -->
													<!-- eslint-disable-next-line svelte/no-at-html-tags -->
													{@html renderChatRichText(message.payload.richText)}
												</div>{:else}<p class="body">
													{message.payload.text}
												</p>{/if}
											{#if message.payload.attachment}
												{@const attachment = message.payload.attachment}
												{#if attachment.mediaType.startsWith("image/") || attachment.mediaType.startsWith("video/")}
													<div class="attachment-display" use:observeAttachment={attachment}>
														{#if attachmentPreviews[attachment.objectKey] && attachment.mediaType.startsWith("image/")}
															<img
																class="message-attachment-image"
																src={attachmentPreviews[attachment.objectKey]}
																alt={attachment.name}
															/>
														{:else if attachmentPreviews[attachment.objectKey] && attachment.mediaType.startsWith("video/")}
															<!-- svelte-ignore a11y_media_has_caption -->
															<video
																class="message-attachment-video"
																src={attachmentPreviews[attachment.objectKey]}
																controls
																playsinline
																preload="metadata"
																aria-label={attachment.name}
															></video>
														{:else if loadingPreviews.has(attachment.objectKey)}
															<p class="attachment-loading">
																Loading {attachment.name}…
															</p>
														{:else}
															<p class="attachment-loading">Preview loads when visible.</p>
														{/if}
														<Button
															icon={UiDownload}
															variant="ghost"
															onclick={() => download(attachment)}
															>Download {attachment.name}</Button
														>
													</div>
												{:else}
													<Button
														icon={UiDownload}
														variant="ghost"
														onclick={() => download(attachment)}>Download {attachment.name}</Button
													>
												{/if}
											{/if}{/if}
									</div>
									{#if message.accountId === me?.id || me?.manager}<IconButton
											icon={UiTrash2}
											label="Delete message"
											disabled={busy}
											onclick={() => {
												deleteTarget = "message";
												deleteId = message.messageId;
												deleteOpen = true;
											}}
										/>{/if}
								</li>
							{/each}{/if}
					</ol>
					<form class="composer" onsubmit={send}>
						{#if files?.length}<div class="attachment-preview">
								{#if draftImagePreview}<img
										class="attachment-draft-image"
										src={draftImagePreview}
										alt="Preview of {files[0].name}"
									/>{:else}<Paperclip size={13} aria-hidden="true" />{/if}<span
									>{files[0].name}</span
								><IconButton
									icon={X}
									label="Remove attachment"
									disabled={busy}
									onclick={() => {
										files = undefined;
										if (attachmentInput) attachmentInput.value = "";
									}}
								/>
							</div>{/if}
						<div class="composer-row">
							<div class="message-input">
								{#if attachmentUploadPhase}<div
										class="attachment-progress"
										role="status"
										aria-live="polite"
									>
										<div class="attachment-progress-caption">
											<span>
												{attachmentUploadPhase === "preparing"
													? "Preparing image…"
													: attachmentUploadPhase === "saving"
														? "Finishing upload…"
														: "Uploading image…"}
											</span>
											{#if attachmentUploadPhase === "uploading"}<span
													>{Math.round(attachmentUploadProgress * 100)}%</span
												>{/if}
										</div>
										<div
											class="attachment-progress-track"
											role="progressbar"
											aria-label="Image upload progress"
											aria-valuemin="0"
											aria-valuemax="100"
											aria-valuenow={attachmentUploadPhase === "uploading"
												? Math.round(attachmentUploadProgress * 100)
												: undefined}
										>
											<span
												class:attachment-progress-indeterminate={attachmentUploadPhase !==
													"uploading"}
												style:width={`${Math.round(attachmentUploadProgress * 100)}%`}
											></span>
										</div>
									</div>{/if}
								<p class="composer-hint">
									<LockKeyhole size={10} aria-hidden="true" />Only approved family devices can read
									your messages.<span>Enter sends · Shift+Enter for a new line</span>
								</p>
								<ChatComposerEditor
									bind:docJson={richTextJson}
									bind:text
									disabled={busy}
									onSend={() => void send()}
									onPickAttachment={pickAttachment}
									onFilesAdded={addComposerFiles}
								>
									{#snippet actions()}<input
											class="file-input"
											type="file"
											accept={attachmentAccept}
											aria-label="Encrypted attachment (up to 20 MiB)"
											bind:files
											bind:this={attachmentInput}
											disabled={busy}
										/><IconButton
											icon={UiSend}
											label="Send encrypted message"
											type="submit"
											disabled={busy || awaitingApproval || (!text.trim() && !files?.length)}
										/>{/snippet}
								</ChatComposerEditor>
							</div>
						</div>
					</form>
				{:else}<div class="conversation-empty">
						<span><UiUsers size={40} strokeWidth={1} aria-hidden="true" /></span>
						<h3>A private space for your family</h3>
						<p>Messages and attachments stay encrypted between approved devices.</p>
					</div>{/if}
			{/if}
		</div>
	</div>
	<CallScreen embedded bind:this={callPanel} onActiveChange={(active) => (callActive = active)} />
</section>

<Dialog.Root bind:open={channelActionOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="chat-channel-overlay" />
		<Dialog.Content class="chat-channel-dialog">
			<form class="channel-management-form" onsubmit={submitChannelAction}>
				<Dialog.Title>
					{channelAction === "rename" ? "Rename channel" : "Add a member"}
				</Dialog.Title>
				{#if channelAction === "rename"}
					<label for="channel-management-input">Channel name</label>
					<input
						id="channel-management-input"
						maxlength="80"
						bind:value={channelActionName}
						required
					/>
				{:else}
					<label for="channel-management-input">Add a member</label>
					<select id="channel-management-input" bind:value={channelActionMember} required>
						<option value="" disabled>Select a family member</option>
						{#each members.filter((member) => !(status?.rooms.find((room) => room.roomId === channelActionRoomId)?.participants ?? []).includes(member.accountId)) as member (member.accountId)}
							<option value={member.accountId}>
								{accountName(member.accountId)}
							</option>
						{/each}
					</select>
				{/if}
				<div class="delete-actions">
					<Button
						type="submit"
						disabled={busy || (channelAction === "member" && !channelActionMember)}
						>{channelAction === "rename" ? "Save" : "Add member"}</Button
					>
					<Button
						variant="ghost"
						disabled={busy}
						onclick={() => {
							channelAction = undefined;
							channelActionOpen = false;
						}}>Cancel</Button
					>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}
	><AlertDialog.Portal
		><AlertDialog.Overlay class="chat-delete-overlay" /><AlertDialog.Content
			class="chat-delete-dialog"
			><AlertDialog.Title
				>{deleteTarget === "channel"
					? "Delete this channel?"
					: "Delete this message?"}</AlertDialog.Title
			><AlertDialog.Description
				>{deleteTarget === "channel"
					? "This removes the channel and its messages from chat for all members."
					: "This removes the relay copy and synchronized local copies. Downloaded files and screenshots may remain with recipients."}</AlertDialog.Description
			>
			<div class="delete-actions">
				<Button variant="ghost" disabled={busy} onclick={() => (deleteOpen = false)}>Cancel</Button
				><Button
					icon={UiTrash2}
					variant="danger"
					disabled={busy}
					onclick={() => void removeMessage()}
					>{deleteTarget === "channel" ? "Delete channel" : "Delete message"}</Button
				>
			</div></AlertDialog.Content
		></AlertDialog.Portal
	></AlertDialog.Root
>

<style>
	.channel-form {
		display: grid;
		gap: 0.7rem;
		padding: 0.8rem;
		border-bottom: 1px solid var(--v-border, #ffffff18);
	}
	.channel-form label {
		font-size: 0.8rem;
	}
	.channel-name-row {
		display: flex;
		align-items: center;
	}
	.channel-form input:not([type="checkbox"]) {
		min-width: 0;
		flex: 1;
		outline: none;
		box-shadow: none;
		width: 100%;
		background: transparent;
		color: inherit;
		border: 0;
		padding: 0.5rem 0;
	}
	.channel-form fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
		max-height: 160px;
		overflow: auto;
	}
	.channel-form legend,
	.channel-form small {
		font-size: 0.7rem;
		opacity: 0.65;
	}
	.channel-member {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.channel-management-form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--v-border);
	}
	.channel-management-form label {
		font-size: 0.72rem;
		color: var(--v-muted);
	}
	.channel-management-form input,
	.channel-management-form select {
		min-width: 0;
		width: min(18rem, 45vw);
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--v-border);
		border-radius: 6px;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	:global(.channel-menu-content) {
		z-index: 120;
		min-width: 160px;
		padding: 4px;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--v-surface) 92%, transparent);
		backdrop-filter: blur(20px);
		color: var(--v-fg);
	}
	:global(.channel-menu-item) {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		border-radius: 5px;
		font-size: 0.78rem;
		cursor: pointer;
		outline: none;
	}
	:global(.channel-menu-item[data-highlighted]) {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	:global(.channel-menu-danger) {
		color: var(--v-danger);
	}
	.conversation-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.chat-screen {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		margin: auto;
		color: var(--v-fg);
		border: 1px solid var(--v-border);
		border-radius: 22px;
		background: var(--v-glass, var(--v-surface));
		backdrop-filter: blur(20px);
		overflow: hidden;
	}
	.chat-page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--v-border);
	}
	.chat-brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	h1 {
		font-size: 1rem;
		font-weight: 600;
	}
	.chat-brand p {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
		margin-top: 0.2rem;
	}
	p,
	time,
	small {
		color: var(--v-muted);
	}
	.chat-layout {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}
	.chat-sidebar {
		border-right: 1px solid var(--v-border);
		overflow-y: auto;
		min-width: 0;
	}
	.conversation-heading {
		padding: 1rem 0.9rem 0.5rem;
		font-size: 0.7rem;
		color: var(--v-muted);
	}
	.conversations {
		padding: 0.35rem;
		display: grid;
		gap: 0.2rem;
	}
	.conversations button {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		min-width: 0;
		width: 100%;
		text-align: left;
		border: 0;
		border-radius: 8px;
		padding: 0.6rem;
		color: var(--v-fg);
		background: transparent;
		font: inherit;
		cursor: pointer;
	}
	.channel-row {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		min-width: 0;
	}
	.conversations button.channel-select {
		flex: 1 1 auto;
		width: auto;
	}
	:global(.conversations .channel-row-menu-trigger) {
		display: grid;
		place-items: center;
		flex: 0 0 32px;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--v-border);
		border-radius: 6px;
		background: color-mix(in srgb, var(--v-fg) 5%, var(--v-surface));
		color: var(--v-fg);
		opacity: 1;
	}
	:global(.conversations .channel-row-menu-trigger:hover) {
		background: color-mix(in srgb, var(--v-primary) 12%, var(--v-surface));
		color: var(--v-fg);
	}
	.conversations button.current,
	.conversations button:hover {
		background: color-mix(in srgb, var(--v-primary) 8%, transparent);
	}
	.conversations button:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: -2px;
	}
	.conversations button > span:last-child {
		min-width: 0;
		display: grid;
		gap: 0.2rem;
	}
	.conversations strong {
		font-size: 0.78rem;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.conversations small {
		font-size: 0.65rem;
	}
	.conversation-avatar {
		width: 32px;
		height: 32px;
		flex: 0 0 32px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--v-primary-text, var(--v-primary));
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
	}
	.security {
		border-top: 1px solid var(--v-border);
		margin-top: 0.6rem;
	}
	.security summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.85rem 0.75rem;
		font-size: 0.72rem;
		cursor: pointer;
		list-style: none;
		color: var(--v-muted);
	}
	.security summary::-webkit-details-marker {
		display: none;
	}
	.security summary > span:first-of-type {
		flex: 1;
	}
	.security[open] summary > :global(svg:last-child) {
		transform: rotate(180deg);
	}
	.verification-count {
		font-size: 0.65rem;
		color: var(--v-primary-text, var(--v-primary));
	}
	.security[open] .security-body {
		animation: chat-details-in 180ms ease-out;
	}
	@keyframes chat-details-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.security[open] .security-body {
			animation: none;
		}
	}
	.security-body {
		padding: 0 0.75rem 0.75rem;
		display: grid;
		gap: 0.75rem;
	}
	.security-body p,
	.device,
	.chat-notifications {
		font-size: 0.68rem;
		line-height: 1.5;
	}
	.device {
		border-top: 1px solid var(--v-border);
		padding-top: 0.6rem;
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}
	.device-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.device-heading strong {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.device-actions {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}
	.device-actions :global(.device-revoke) {
		color: var(--v-danger);
	}
	.device-actions :global(.v-icon-btn::after) {
		top: 50%;
		right: calc(100% + 8px);
		left: auto;
		transform: translateY(-50%);
	}
	.device > span {
		color: var(--v-muted);
	}
	.security-body :global(.v-btn) {
		min-height: 30px;
		height: auto;
		padding: 0.4rem;
		font-size: 0.7rem;
		border-radius: 6px;
	}
	.chat-notifications {
		display: flex;
		gap: 0.4rem;
		align-items: flex-start;
		color: var(--v-muted);
	}
	.chat-notifications input {
		accent-color: var(--v-primary);
	}
	.conversation-pane {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.conversation-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--v-border);
	}
	.conversation-header > div:first-child {
		min-width: 0;
	}
	h2 {
		font-size: 0.85rem;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.conversation-header p {
		font-size: 0.68rem;
		margin-top: 0.25rem;
	}
	.header-actions {
		display: flex;
	}
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--v-border) transparent;
		list-style: none;
		padding: 1rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.messages::-webkit-scrollbar {
		width: 6px;
	}
	.messages::-webkit-scrollbar-track {
		background: transparent;
	}
	.messages::-webkit-scrollbar-thumb {
		border: 1px solid transparent;
		border-radius: 999px;
		background: var(--v-border);
		background-clip: content-box;
	}
	.messages li {
		display: flex;
		align-items: flex-start;
		gap: 0.3rem;
		min-width: 0;
	}
	.messages li.own {
		flex-direction: row-reverse;
	}
	.messages .messages-loading {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.messages-loading :global(svg) {
		color: var(--v-primary);
		animation: message-loading-spin 900ms linear infinite;
	}
	@keyframes message-loading-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.message-bubble {
		min-width: 0;
		max-width: 80%;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--v-border);
		border-radius: 12px 12px 12px 3px;
		background: color-mix(in srgb, var(--v-fg) 3%, transparent);
	}
	.own .message-bubble {
		border-radius: 12px 12px 3px 12px;
		background: color-mix(in srgb, var(--v-primary) 9%, transparent);
	}
	.message-meta {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.3rem;
		font-size: 0.63rem;
	}
	.message-meta strong {
		font-weight: 500;
		color: var(--v-muted);
	}
	.message-bubble p {
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--v-fg);
	}
	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.rich-body :global(p),
	.rich-body :global(h1),
	.rich-body :global(h2),
	.rich-body :global(h3),
	.rich-body :global(ul),
	.rich-body :global(ol),
	.rich-body :global(blockquote),
	.rich-body :global(pre) {
		margin: 0.2rem 0;
	}
	.rich-body :global(h1) {
		font-size: 1.15rem;
	}
	.rich-body :global(h2) {
		font-size: 1.05rem;
	}
	.rich-body :global(h3) {
		font-size: 0.95rem;
	}
	.rich-body :global(ul),
	.rich-body :global(ol) {
		padding-left: 1.3rem;
	}
	.rich-body :global(blockquote) {
		border-left: 2px solid var(--v-border);
		padding-left: 0.65rem;
		color: var(--v-muted);
	}
	.rich-body :global(pre) {
		max-width: 100%;
		overflow-x: auto;
		border-radius: 0.35rem;
		background: var(--v-surface);
		padding: 0.4rem;
	}
	.rich-body :global(a) {
		color: var(--v-primary);
		text-decoration: underline;
		overflow-wrap: anywhere;
	}
	.message-bubble :global(.v-btn) {
		min-height: 32px;
		height: auto;
		max-width: 100%;
		font-size: 0.72rem;
		padding: 0.4rem 0;
	}
	.message-bubble :global(.v-btn-label) {
		overflow-wrap: anywhere;
		white-space: normal;
	}
	.messages .empty-messages,
	.conversation-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.75rem;
		padding: 1rem;
	}
	.conversation-empty > span {
		color: var(--v-muted);
	}
	.conversation-empty h3 {
		font-size: 0.9rem;
		font-weight: 500;
	}
	.conversation-empty p,
	.empty-messages p {
		font-size: 0.75rem;
		line-height: 1.5;
		max-width: 30ch;
	}
	.composer {
		padding: 0;
	}
	.composer-row {
		display: block;
	}
	.message-input {
		position: relative;
		width: 100%;
		min-width: 0;
		border-radius: 0;
		padding: 0.2rem 0.5rem 0.3rem;
		border: 0;
		outline: none;
		background: var(--v-surface);
	}
	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		clip-path: inset(50%);
		overflow: hidden;
	}
	.composer-hint {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0 0 0.25rem;
		color: var(--v-muted);
		font-size: 0.6rem;
		line-height: 1.5;
	}
	.composer-hint span {
		margin-left: 0.4rem;
		padding-left: 0.4rem;
		border-left: 1px solid var(--v-border);
	}
	.attachment-preview {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		padding: 0.2rem 0.4rem;
		color: var(--v-muted);
	}
	.attachment-preview span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.attachment-draft-image {
		width: 2.5rem;
		height: 2.5rem;
		flex: 0 0 auto;
		border-radius: 0.4rem;
		object-fit: cover;
	}
	.attachment-progress {
		display: grid;
		gap: 0.2rem;
		padding: 0.2rem 0 0;
		color: var(--v-muted);
	}
	.attachment-progress-caption {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.65rem;
		line-height: 1.2;
	}
	.attachment-progress-track {
		position: relative;
		height: 0.22rem;
		overflow: hidden;
		border-radius: 999px;
		background: var(--v-border);
	}
	.attachment-progress-track > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--v-primary);
		transition: width 120ms linear;
	}
	.attachment-progress-track > .attachment-progress-indeterminate {
		width: 35% !important;
		animation: attachment-progress-sweep 1.2s ease-in-out infinite alternate;
	}
	@keyframes attachment-progress-sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(285%);
		}
	}
	.message-attachment-image,
	.message-attachment-video {
		display: block;
		max-width: min(100%, 28rem);
		max-height: 24rem;
		margin: 0.5rem 0;
		border-radius: 0.65rem;
		object-fit: contain;
	}
	.message-attachment-video {
		width: 100%;
		background: #000;
	}
	.attachment-loading {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.feedback {
		font-size: 0.75rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--v-border);
		overflow-wrap: anywhere;
	}
	.sidebar-help {
		padding: 1rem;
		font-size: 0.75rem;
	}
	.chat-page-header :global(.v-icon-btn::after),
	.header-actions :global(.v-icon-btn::after),
	.composer :global(.v-icon-btn::after) {
		right: 0;
		left: auto;
		transform: none;
	}
	.composer :global(.v-icon-btn::after) {
		top: auto;
		bottom: calc(100% + 8px);
	}
	:global(.chat-delete-overlay) {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.4);
		backdrop-filter: blur(5px);
		z-index: 100;
	}
	:global(.chat-channel-overlay) {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.4);
		backdrop-filter: blur(5px);
		z-index: 100;
	}
	:global(.chat-channel-dialog) {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(380px, calc(100vw - 40px));
		box-sizing: border-box;
		padding: 1.25rem;
		border: 1px solid var(--v-border);
		border-radius: 16px;
		background: var(--v-surface);
		color: var(--v-fg);
		z-index: 101;
		display: grid;
		gap: 0.8rem;
	}
	:global(.chat-channel-dialog h2) {
		margin: 0;
		font-size: 1rem;
	}
	.channel-management-form {
		display: grid;
		gap: 0.7rem;
	}
	.channel-management-form input,
	.channel-management-form select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	:global(.chat-delete-dialog) {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(380px, calc(100vw - 40px));
		box-sizing: border-box;
		padding: 1.25rem;
		border: 1px solid var(--v-border);
		border-radius: 16px;
		background: var(--v-surface);
		color: var(--v-fg);
		z-index: 101;
		display: grid;
		gap: 0.8rem;
	}
	:global(.chat-delete-dialog h2) {
		margin: 0;
		font-size: 1rem;
	}
	:global(.chat-delete-dialog p) {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.delete-actions {
		display: flex;
		justify-content: end;
		gap: 0.5rem;
	}
	@media (max-width: 760px) {
		.chat-screen {
			height: 100%;
			border-radius: 0;
		}
	}
	@media (max-width: 650px) {
		.chat-layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
		.chat-sidebar {
			max-height: 28dvh;
			border-right: 0;
			border-bottom: 1px solid var(--v-border);
		}
		.conversation-heading {
			display: none;
		}
		.conversations {
			display: flex;
			overflow-x: auto;
		}
		.conversations button {
			width: auto;
			flex: 0 0 auto;
			padding: 0.45rem 0.6rem;
		}
		.conversations small {
			display: none;
		}
		.conversations strong {
			white-space: nowrap;
		}
		.conversation-avatar {
			width: 26px;
			height: 26px;
			flex-basis: 26px;
			font-size: 0.75rem;
		}
		.security {
			margin-top: 0;
		}
		.security summary {
			padding: 0.45rem 0.75rem;
		}
		.conversation-header {
			padding: 0.65rem 0.75rem;
		}
		.messages {
			padding: 0.7rem;
		}
		.message-bubble {
			max-width: 82%;
		}
	}
</style>
