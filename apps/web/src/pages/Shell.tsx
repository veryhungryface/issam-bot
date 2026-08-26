import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type {
  Bot,
  BotSection,
  ComputerMode,
  ComputerStatus,
  Me,
  ProductEvent,
  Routine,
  SearchHit,
  TaughtSkill,
  ThreadMessage,
  ThreadSnapshot,
  VoiceInfo,
  VoiceStatus,
} from "@rakazo/contracts";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
} from "@rakazo/contracts";
import {
  abortableDelay,
  attachmentsForBot,
  cronFromPreset,
  defaultCronPreset,
  groupBotsForSidebar,
  inferAttachmentMimeType,
  isActive,
  presetFromCron,
  speechFromBlocks,
} from "@rakazo/core";
import { BotAvatar, Button } from "@rakazo/ui-web";
import {
  ArrowUp,
  ChevronLeft,
  Cpu,
  Gauge,
  LogOut,
  Menu as MenuIcon,
  Mic,
  Monitor,
  Paperclip,
  Phone,
  Plus,
  Puzzle,
  Settings,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  type Dispatch,
  lazy,
  memo,
  type RefObject,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SkillDraftCard } from "../components/teach/SkillDraftCard";
import { TeachCaptureOverlay } from "../components/teach/TeachCaptureOverlay";
import { TeachComputerSection } from "../components/teach/TeachComputerSection";
import { TeachRecordingChrome, TeachStopButton } from "../components/teach/TeachRecordingChrome";
import { decodeArtifactBase64, openArtifact } from "../lib/artifact-open";
import { authClient } from "../lib/auth";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { createClientNonce } from "../lib/client-nonce";
import { dictation } from "../lib/dictation";
import { koreanStatusLabel } from "../lib/korean-labels";
import {
  isBrowserbaseDisconnectedMessage,
  pollBrowserbaseLiveViewRecovery,
  screenIframeSandbox,
} from "../lib/live-view";
import { revokePendingAttachmentPreviews } from "../lib/pending-attachments";
import { markAfterPaint, markOnce } from "../lib/performance";
import { rpc } from "../lib/rpc";
import {
  computerPanelAutoBoot,
  isComputerStatusEvent,
  isThreadSnapshotEvent,
  matchesOptimisticUserMessage,
  mergeThreadSnapshot,
  prependThreadMessagePage,
  reduceComputerStatus,
  reduceThreadSnapshot,
  userHoldsComputerControl,
} from "../lib/thread-events";
import { speaker } from "../lib/tts";
import type { ContextMenuPosition } from "./BotContextMenu";
import { HostComputerPrompt } from "./HostComputerPrompt";
import { formatKoreanCron } from "./RoutineSchedule";
import { WindowChrome } from "./WindowChrome";
import { WorkspaceSearchResults } from "./WorkspaceSearch";

const BotContextMenu = lazy(() =>
  import("./BotContextMenu").then((module) => ({
    default: module.BotContextMenu,
  })),
);
const ModelSettingsOverlay = lazy(() =>
  import("./ModelSettingsOverlay").then((module) => ({
    default: module.ModelSettingsOverlay,
  })),
);
const PluginsOverlay = lazy(() =>
  import("./PluginsOverlay").then((module) => ({
    default: module.PluginsOverlay,
  })),
);
const RoutineSchedule = lazy(() =>
  import("./RoutineSchedule").then((module) => ({
    default: module.RoutineSchedule,
  })),
);
const VoiceSettingsOverlay = lazy(() =>
  import("./VoiceSettingsOverlay").then((module) => ({
    default: module.VoiceSettingsOverlay,
  })),
);
const CallView = lazy(() => import("./CallView").then((module) => ({ default: module.CallView })));

type Panel = "computer" | "settings" | "routine" | "create" | null;

type PendingAttachment = {
  id: string;
  botId: string;
  file: File;
  previewUrl?: string;
};

const ATTACHMENT_ACCEPT = ATTACHMENT_ALLOWED_MIME_TYPES.join(",");
const SUSPENDED_COMPUTER_MESSAGE =
  "다음 작업을 보내면 에이전트가 자동으로 새 브라우저를 시작합니다. 지금 직접 조작하려면 직접 제어를 누르세요.";

export function ShellPage() {
  const { botId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = authClient.useSession();
  const [bots, setBots] = useState<Bot[]>([]);
  const [botSections, setBotSections] = useState<BotSection[]>([]);
  const [archivedBots, setArchivedBots] = useState<Bot[]>([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Record<string, ThreadMessage>>({});
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesBotId, setRoutinesBotId] = useState<string | null>(null);
  const [taughtSkills, setTaughtSkills] = useState<TaughtSkill[]>([]);
  const [taughtSkillsBotId, setTaughtSkillsBotId] = useState<string | null>(null);
  const [teachBusy, setTeachBusy] = useState(false);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [botMenu, setBotMenu] = useState<{
    botId: string;
    position: ContextMenuPosition;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null);
  const [clearTarget, setClearTarget] = useState<Bot | null>(null);
  const [newSectionBot, setNewSectionBot] = useState<Bot | null>(null);
  const [booting, setBooting] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [initialBotsLoaded, setInitialBotsLoaded] = useState(false);
  const [bootstrapMe, setBootstrapMe] = useState<Me | null>();
  const [routineDraft, setRoutineDraft] = useState({
    name: "",
    prompt: "",
    schedule: defaultCronPreset(),
  });
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [deleteRoutineTarget, setDeleteRoutineTarget] = useState<Routine | null>(null);
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [runningRoutine, setRunningRoutine] = useState(false);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [screenNotice, setScreenNotice] = useState<string | null>(null);
  const [computerOpen, setComputerOpen] = useState(false);
  const [computerOpeningMessage, setComputerOpeningMessage] = useState<string | null>(null);
  const [computerOpenError, setComputerOpenError] = useState<string | null>(null);
  const [screenFrameLoaded, setScreenFrameLoaded] = useState(false);
  const [remoteText, setRemoteText] = useState("");
  const [remoteTextOpen, setRemoteTextOpen] = useState(false);
  const [remoteTextBusy, setRemoteTextBusy] = useState(false);
  const [remoteTextError, setRemoteTextError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [usage, setUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    runs: number;
  } | null>(null);
  const autoBooted = useRef<string | null>(null);
  const routineSavePending = useRef(false);
  const routineRunPending = useRef(false);
  const bootstrappedThread = useRef<ThreadSnapshot | null>(null);
  const expandedHistoryThread = useRef<string | null>(null);
  const historyEpoch = useRef(0);
  const initiallyScrolledThread = useRef<string | null>(null);
  const messageScroll = useRef<HTMLDivElement>(null);
  const followLatestMessage = useRef(true);
  const pinnedAroundRef = useRef<{
    botId: string;
    messageId: string;
    threadId: string;
    messages: ThreadMessage[];
    olderCursor: number | null;
  } | null>(null);
  const manuallyUnread = useRef(new Set<string>());
  const computerVisible = useRef(false);
  const screenFrame = useRef<HTMLIFrameElement>(null);
  const remoteTextInput = useRef<HTMLInputElement>(null);
  const computerOpenRequest = useRef(0);
  const liveViewRecovery = useRef<AbortController | null>(null);
  computerVisible.current = panel === "computer" || computerOpen;
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenBotId = useRef<string | null>(null);
  const snapshotCache = useRef(new Map<string, ThreadSnapshot>());

  const active = bots.find((b) => b.id === botId) ?? bots[0];
  const activeSnapshot = active
    ? snapshot?.botId === active.id
      ? snapshot
      : (snapshotCache.current.get(active.id) ?? null)
    : null;
  const activeRunInProgress = Boolean(activeSnapshot?.run && isActive(activeSnapshot.run.status));
  const transcriptMessages = useMemo(() => {
    const messages = activeSnapshot?.messages ?? [];
    const optimistic = active ? optimisticMessages[active.id] : undefined;
    return optimistic ? [...messages, optimistic] : messages;
  }, [active, activeSnapshot?.messages, optimisticMessages]);
  const activePendingAttachments = useMemo(
    () => attachmentsForBot(pendingAttachments, active?.id),
    [active?.id, pendingAttachments],
  );
  const activeRoutines = routinesBotId === active?.id ? routines : [];
  const activeTaughtSkills = taughtSkillsBotId === active?.id ? taughtSkills : [];
  const recordingSkill = activeTaughtSkills.find((skill) => skill.status === "recording") ?? null;
  const routeBotId = useRef<string | undefined>(botId);
  routeBotId.current = botId;
  const activeBotId = useRef<string | undefined>(active?.id);
  activeBotId.current = active?.id;
  const screenRequest = useRef(0);
  const contextBot = botMenu ? bots.find((bot) => bot.id === botMenu.botId) : undefined;
  const closeBotMenu = useCallback(() => setBotMenu(null), []);
  useEffect(() => {
    if (snapshot) snapshotCache.current.set(snapshot.botId, snapshot);
  }, [snapshot]);
  const updateBotUnread = useCallback((id: string, unread: boolean) => {
    setBots((current) => {
      const bot = current.find((candidate) => candidate.id === id);
      if (!bot || bot.unread === unread) return current;
      return current.map((candidate) =>
        candidate.id === id ? { ...candidate, unread } : candidate,
      );
    });
  }, []);
  const markBotRead = useCallback(
    async (id: string) => {
      await rpc.threads.markRead({ botId: id });
      manuallyUnread.current.delete(id);
      updateBotUnread(id, false);
    },
    [updateBotUnread],
  );
  const markBotUnread = useCallback(
    async (id: string) => {
      manuallyUnread.current.add(id);
      try {
        await rpc.threads.markUnread({ botId: id });
      } catch (err) {
        manuallyUnread.current.delete(id);
        throw err;
      }
      updateBotUnread(id, true);
    },
    [updateBotUnread],
  );
  // A bot the user marked unread by hand stays unread until they open it again,
  // otherwise the auto-read below would undo the action on the next window focus.
  const markBotReadIfVisible = useCallback(
    (id: string) => {
      if (manuallyUnread.current.has(id)) return;
      if (document.visibilityState === "visible" && document.hasFocus()) {
        void markBotRead(id).catch(() => undefined);
      }
    },
    [markBotRead],
  );

  async function refreshBots(includeArchived = false) {
    markOnce("rk:renderer:bots-request-start");
    const [list, sections, archived] = await Promise.all([
      rpc.bots.list(),
      rpc.botSections.list(),
      includeArchived ? rpc.bots.listArchived() : Promise.resolve(null),
    ]);
    markOnce("rk:renderer:bots-response");
    setBots(list);
    setBotSections(sections);
    setInitialBotsLoaded(true);
    if (archived) setArchivedBots(archived);
    if (includeArchived && list.length === 0 && archived?.length === 0) {
      navigate("/onboarding", { replace: true });
      return;
    }
    const currentBotId = routeBotId.current;
    if (!currentBotId || !list.some((bot) => bot.id === currentBotId)) {
      navigate(list[0] ? `/app/${list[0].id}` : "/app", { replace: true });
    }
  }

  async function refreshThread(id: string) {
    const scrollElement = messageScroll.current;
    const stickToEnd =
      !scrollElement ||
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 80;
    markOnce("rk:renderer:thread-request-start");
    const pin = pinnedAroundRef.current;
    const keepPin = pin?.botId === id;
    const epoch = historyEpoch.current;
    const [view] = await Promise.all([rpc.threads.open({ botId: id }), refreshComputerScreen(id)]);
    const { thread: snap, routines, skills } = view;
    markOnce("rk:renderer:thread-response");
    // The epoch check drops a response that raced a conversation clear, which would otherwise
    // re-apply the deleted messages and cursor over the emptied snapshot.
    if (activeBotId.current !== id || epoch !== historyEpoch.current) return snap;
    setSnapshot((prev) => {
      let merged = mergeThreadSnapshot(prev, snap, expandedHistoryThread.current === snap.threadId);
      if (keepPin && merged) {
        merged = {
          ...merged,
          messages: pin.messages,
          olderCursor: pin.olderCursor,
        };
      }
      return merged;
    });
    setComputer(snap.computer);
    setRoutines(routines);
    setRoutinesBotId(id);
    setTaughtSkills(skills);
    setTaughtSkillsBotId(id);
    if (!keepPin && stickToEnd) {
      window.requestAnimationFrame(() => {
        const element = messageScroll.current;
        if (element) element.scrollTop = element.scrollHeight;
      });
    }
    return snap;
  }

  async function refreshComputerScreen(id: string, excludedUrl?: string | null) {
    if (!computerVisible.current) return null;
    const request = ++screenRequest.current;
    const screen = await rpc.computer.screenUrl({ botId: id }).catch(() => ({ url: null }));
    if (
      request !== screenRequest.current ||
      activeBotId.current !== id ||
      !computerVisible.current
    ) {
      return null;
    }
    if (screen.url && screen.url === excludedUrl) return null;
    setScreenUrl(screen.url);
    if (screen.url) setScreenNotice(null);
    return screen.url;
  }

  async function loadOlderMessages() {
    if (!active || activeSnapshot?.olderCursor == null || loadingOlder) return;
    pinnedAroundRef.current = null;
    const scrollElement = messageScroll.current;
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const epoch = historyEpoch.current;
    setLoadingOlder(true);
    try {
      const page = await rpc.threads.messages({
        botId: active.id,
        before: activeSnapshot.olderCursor,
      });
      if (epoch !== historyEpoch.current) return;
      expandedHistoryThread.current = page.threadId;
      setSnapshot((prev) => prependThreadMessagePage(prev, page));
      window.requestAnimationFrame(() => {
        const element = messageScroll.current;
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void takeInitialBootstrap(botId)
      .then((bootstrap) => {
        if (cancelled) return;
        setBootstrapMe(bootstrap.me);
        setBots(bootstrap.bots);
        setBotSections(bootstrap.botSections);
        setArchivedBots(bootstrap.archivedBots);
        setInitialBotsLoaded(true);
        if (bootstrap.thread) {
          bootstrappedThread.current = bootstrap.thread;
          setSnapshot(bootstrap.thread);
          setComputer(bootstrap.thread.computer);
          setRoutines(bootstrap.routines);
          setRoutinesBotId(bootstrap.thread.botId);
          markOnce("rk:renderer:bots-response");
          markOnce("rk:renderer:thread-response");
        }
        if (bootstrap.bots.length === 0 && bootstrap.archivedBots.length === 0) {
          navigate("/onboarding", { replace: true });
          return;
        }
        const selectedBotId = bootstrap.thread?.botId ?? bootstrap.bots[0]?.id;
        if (selectedBotId && selectedBotId !== botId) {
          navigate(`/app/${selectedBotId}`, { replace: true });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setBootstrapMe(null);
        void refreshBots(true);
      });
    let refreshTimer: number | undefined;
    const refreshVisibleBots = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshBots().catch(() => undefined), 50);
    };
    window.addEventListener("focus", refreshVisibleBots);
    document.addEventListener("visibilitychange", refreshVisibleBots);
    const poll = window.setInterval(refreshVisibleBots, 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshVisibleBots);
      document.removeEventListener("visibilitychange", refreshVisibleBots);
    };
  }, []);

  useEffect(() => {
    void rpc.voice
      .status()
      .then(setVoiceStatus)
      .catch(() => undefined);
    const unsubSpeech = speaker.subscribe((state) => {
      setSpeakingMessageId(state.status === "idle" ? null : (state.messageId ?? null));
    });
    const unsubDictation = dictation.subscribe((state) => {
      setDictating(state.status === "listening" || state.status === "transcribing");
      if (state.error) setDictationError(state.error);
      else if (state.status === "listening") setDictationError(null);
    });
    return () => {
      unsubSpeech();
      unsubDictation();
    };
  }, []);

  useEffect(() => {
    if (!active || !snapshot || snapshot.botId !== active.id) return;
    const lastBot = [...snapshot.messages].reverse().find((message) => message.role === "bot");
    if (autoSpokenBotId.current !== active.id) {
      autoSpokenBotId.current = active.id;
      autoSpoken.current = lastBot?.id ?? null;
      return;
    }
    if (callOpen || !active.autoSpeak) {
      autoSpoken.current = lastBot?.id ?? null;
      return;
    }
    if (snapshot.run && ["running", "queued", "leased"].includes(snapshot.run.status)) return;
    if (!lastBot || lastBot.id === autoSpoken.current) return;
    const text = speechFromBlocks(lastBot.blocks);
    if (!text) return;
    autoSpoken.current = lastBot.id;
    void speaker.speak(text, { botId: active.id, messageId: lastBot.id });
  }, [
    snapshot?.messages,
    snapshot?.run?.status,
    snapshot?.botId,
    active?.autoSpeak,
    active?.id,
    callOpen,
  ]);

  useEffect(() => {
    if (!active) return;
    // Opening a bot clears the manual unread flag so it can auto-read again.
    manuallyUnread.current.delete(active.id);
    const markVisibleBotRead = () => {
      markBotReadIfVisible(active.id);
    };
    markVisibleBotRead();
    window.addEventListener("focus", markVisibleBotRead);
    document.addEventListener("visibilitychange", markVisibleBotRead);
    return () => {
      window.removeEventListener("focus", markVisibleBotRead);
      document.removeEventListener("visibilitychange", markVisibleBotRead);
    };
  }, [active?.id, markBotReadIfVisible]);

  useEffect(() => {
    if (!active) return;
    if (!searchParams.get("m")) {
      pinnedAroundRef.current = null;
    }
    screenRequest.current += 1;
    setScreenUrl(null);
    setScreenNotice(null);
    expandedHistoryThread.current = null;
    historyEpoch.current += 1;
    const abort = new AbortController();
    void (async () => {
      const primed = bootstrappedThread.current;
      bootstrappedThread.current = null;
      const snap =
        primed?.botId === active.id ? primed : await refreshThread(active.id).catch(() => null);
      if (abort.signal.aborted) return;
      let cursor = snap?.cursor ?? -1;
      let retryMs = 250;
      while (!abort.signal.aborted) {
        try {
          const events = await rpc.threads.subscribe(
            { botId: active.id, cursor },
            { signal: abort.signal },
          );
          for await (const event of events) {
            if (abort.signal.aborted) break;
            cursor = Math.max(cursor, event.seq);
            retryMs = 250;
            applyThreadEvent(event, setSnapshot, setComputer);
            if (event.type === "thread.message.created" && event.payload.role === "user") {
              setOptimisticMessages((current) => {
                if (!matchesOptimisticUserMessage(current[event.botId], event)) return current;
                const next = { ...current };
                delete next[event.botId];
                return next;
              });
            }
            if (event.type === "thread.cleared") {
              expandedHistoryThread.current = null;
              pinnedAroundRef.current = null;
              historyEpoch.current += 1;
            }
            if (event.type === "bot.archived") {
              void refreshBots(true).catch(() => undefined);
            } else if (
              event.type === "bot.spawned" ||
              event.type === "bot.deleted" ||
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled" ||
              event.type === "thread.cleared"
            ) {
              void refreshBots().catch(() => undefined);
            }
            if (event.type === "thread.message.created") {
              const blocks = (event.payload.blocks as Array<{ kind?: string }>) ?? [];
              if (blocks.some((block) => block.kind === "child_bot")) {
                void refreshBots().catch(() => undefined);
              }
              if (event.payload.role === "bot") markBotReadIfVisible(active.id);
            }
            if (
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled" ||
              event.type === "skill.teaching.stopped"
            ) {
              void refreshThread(active.id).catch(() => undefined);
            } else if (isComputerStatusEvent(event)) {
              void refreshComputerScreen(active.id).catch(() => undefined);
            }
          }
        } catch {
          // The durable cursor below makes reconnects safe after a transient network failure.
        }
        if (abort.signal.aborted) break;
        await refreshThread(active.id).catch(() => null);
        await abortableDelay(retryMs, abort.signal);
        retryMs = Math.min(retryMs * 2, 5_000);
      }
    })();
    return () => {
      abort.abort();
    };
  }, [active?.id, markBotReadIfVisible, searchParams]);

  const filtered = useMemo(
    () => bots.filter((b) => `${b.name} ${b.preview}`.toLowerCase().includes(query.toLowerCase())),
    [bots, query],
  );
  const sidebarGroups = useMemo(
    () => groupBotsForSidebar(filtered, botSections),
    [botSections, filtered],
  );
  const workspaceQuery = query.trim();
  const showWorkspaceSearch = workspaceQuery.length > 0;

  useEffect(() => {
    if (!showWorkspaceSearch) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void rpc.search
        .query({ q: workspaceQuery })
        .then((result) => {
          if (!abort.signal.aborted) setSearchHits(result.hits);
        })
        .catch(() => {
          if (!abort.signal.aborted) setSearchHits([]);
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearchLoading(false);
        });
    }, 200);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [showWorkspaceSearch, workspaceQuery]);

  async function jumpToSearchHit(hit: SearchHit) {
    setMobileSidebarOpen(false);
    setQuery("");
    setSearchHits([]);
    const params = new URLSearchParams();
    if (hit.messageId) params.set("m", hit.messageId);
    if (hit.routineId) params.set("routine", hit.routineId);
    navigate({
      pathname: `/app/${hit.botId}`,
      search: params.toString() ? `?${params.toString()}` : undefined,
    });
  }

  async function jumpToMessage(botId: string, messageId: string) {
    const epoch = historyEpoch.current;
    const [snap, page] = await Promise.all([
      rpc.threads.get({ botId }),
      rpc.threads.messages({ botId, around: { messageId } }),
    ]);
    // The epoch check drops a jump that raced a conversation clear (or a bot switch): applying
    // the fetched page would pin deleted messages that every later refresh keeps restoring.
    if (epoch !== historyEpoch.current) return;
    expandedHistoryThread.current = page.threadId;
    pinnedAroundRef.current = {
      botId,
      messageId,
      threadId: page.threadId,
      messages: page.messages,
      olderCursor: page.olderCursor,
    };
    setSnapshot({
      ...snap,
      messages: page.messages,
      olderCursor: page.olderCursor,
    });
    setComputer(snap.computer);
    setRoutines(await rpc.routines.list({ botId }));
    setRoutinesBotId(botId);
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  useEffect(() => {
    if (!active) return;
    const messageId = searchParams.get("m");
    const routineId = searchParams.get("routine");
    if (routineId && routinesBotId === active.id) {
      const routine = routines.find((item) => item.id === routineId);
      if (routine) {
        setRoutineDraft({
          name: routine.name,
          prompt: routine.prompt,
          schedule: presetFromCron(routine.cron),
        });
        setPanel("routine");
      } else {
        setPanel("computer");
      }
      const next = new URLSearchParams(searchParams);
      next.delete("routine");
      setSearchParams(next, { replace: true });
    }
    if (messageId) {
      void jumpToMessage(active.id, messageId).finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("m");
        setSearchParams(next, { replace: true });
      });
    }
  }, [active?.id, routines, routinesBotId, searchParams, setSearchParams]);
  const answerableAskMessageId = latestAnswerableAskMessageId(activeSnapshot);
  const latestTranscriptMessageId = transcriptMessages.at(-1)?.id ?? null;
  const shellReady = initialBotsLoaded && Boolean(active && snapshot?.botId === active.id);
  const refreshThreadRef = useRef(refreshThread);
  refreshThreadRef.current = refreshThread;
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;

  useLayoutEffect(() => {
    if (initialBotsLoaded) {
      markOnce("rk:renderer:bots-committed");
      markAfterPaint("rk:renderer:bots-painted");
    }
    if (active && snapshot?.botId === active.id) {
      markOnce("rk:renderer:thread-committed");
      markAfterPaint("rk:renderer:thread-painted");
    }
    if (shellReady) {
      markOnce("rk:renderer:shell-ready");
      markAfterPaint("rk:renderer:shell-painted");
    }
  }, [active, initialBotsLoaded, shellReady, snapshot?.botId]);

  const onTranscriptScroll = useCallback(() => {
    const element = messageScroll.current;
    if (!element) return;
    followLatestMessage.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);

  useLayoutEffect(() => {
    if (!active || !activeSnapshot || activeSnapshot.botId !== active.id) return;
    if (pinnedAroundRef.current?.botId === active.id) return;
    const element = messageScroll.current;
    if (!element) return;
    const threadKey = `${active.id}:${activeSnapshot.threadId}`;
    const enteredThread = initiallyScrolledThread.current !== threadKey;
    if (!enteredThread && !followLatestMessage.current) return;
    element.scrollTop = element.scrollHeight;
    followLatestMessage.current = true;
    initiallyScrolledThread.current = threadKey;
  }, [
    active?.id,
    activeSnapshot?.botId,
    activeSnapshot?.threadId,
    activeSnapshot?.run?.error,
    activeSnapshot?.run?.status,
    latestTranscriptMessageId,
  ]);

  const openBot = useCallback((id: string) => navigate(`/app/${id}`), [navigate]);
  const loadOlder = useCallback(() => loadOlderMessagesRef.current(), []);
  const answerMessage = useCallback(async (message: ThreadMessage, text: string) => {
    const id = activeBotId.current;
    if (!id) return;
    await rpc.threads.answer({
      botId: id,
      runId: message.runId ?? "",
      messageId: message.id,
      answer: text,
    });
    await refreshThreadRef.current(id);
  }, []);
  const onAttachmentPick = useCallback(
    async (files: FileList | null) => {
      const id = activeBotId.current;
      if (!id || !files?.length) return;
      const existing = attachmentsForBot(pendingAttachments, id);
      const next: PendingAttachment[] = [];
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        if (existing.length + next.length >= ATTACHMENT_MAX_COUNT) {
          skipped.push(`${file.name} (첨부는 최대 ${ATTACHMENT_MAX_COUNT}개)`);
          continue;
        }
        if (file.size > ATTACHMENT_MAX_BYTES) {
          skipped.push(`${file.name} (10 MiB 초과)`);
          continue;
        }
        const mimeType = inferAttachmentMimeType(file.name, file.type);
        if (!mimeType) {
          skipped.push(file.name);
          continue;
        }
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
          botId: id,
          file,
          previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      if (next.length) setPendingAttachments((current) => [...current, ...next]);
      setAttachmentNotice(skipped.length ? `첨부 제외: ${skipped.join(", ")}` : null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [pendingAttachments],
  );
  const removeAttachment = useCallback((attachment: PendingAttachment) => {
    revokePendingAttachmentPreviews([attachment]);
    setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }, []);
  const sendMessage = useCallback(
    async (text: string) => {
      const id = activeBotId.current;
      if (!id || sending) return;
      const attachments = attachmentsForBot(pendingAttachments, id);
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      const clientNonce = createClientNonce();
      const optimisticId = `optimistic:${clientNonce}`;
      if (trimmed) {
        setOptimisticMessages((current) => ({
          ...current,
          [id]: {
            id: optimisticId,
            threadId: `pending:${id}`,
            seq: 0,
            role: "user",
            blocks: [{ kind: "text", text: trimmed }],
            createdAt: new Date().toISOString(),
          },
        }));
      }
      setSending(true);
      setSendError(null);
      try {
        const artifactIds: string[] = [];
        for (const pending of attachments) {
          const mimeType = inferAttachmentMimeType(pending.file.name, pending.file.type);
          if (!mimeType) {
            throw new Error(`지원하지 않는 파일 형식: ${pending.file.name}`);
          }
          const contentBase64 = await readFileAsBase64(pending.file);
          const artifact = await rpc.artifacts.create({
            botId: id,
            name: pending.file.name,
            mimeType,
            contentBase64,
          });
          artifactIds.push(artifact.id);
        }
        await rpc.threads.send({
          botId: id,
          text: trimmed || undefined,
          artifactIds: artifactIds.length ? artifactIds : undefined,
          clientNonce,
        });
        revokePendingAttachmentPreviews(attachments);
        setPendingAttachments((current) => current.filter((attachment) => attachment.botId !== id));
        if (activeBotId.current === id) setAttachmentNotice(null);
        // The live event stream normally replaces the optimistic bubble. Keep a delayed,
        // non-blocking refresh only as a recovery path so the composer is not held hostage by
        // another high-latency database round trip.
        window.setTimeout(() => {
          const clearOptimistic = () => {
            setOptimisticMessages((current) => {
              if (!(id in current)) return current;
              const next = { ...current };
              delete next[id];
              return next;
            });
          };
          if (activeBotId.current === id) {
            void refreshThreadRef
              .current(id)
              .catch(() => undefined)
              .finally(clearOptimistic);
          } else {
            clearOptimistic();
          }
        }, 1_500);
      } catch (error) {
        setOptimisticMessages((current) => {
          if (current[id]?.id !== optimisticId) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        if (activeBotId.current === id) {
          setSendError(error instanceof Error ? error.message : "메시지를 보내지 못했습니다.");
        }
      } finally {
        setSending(false);
      }
    },
    [pendingAttachments, sending],
  );
  const followUpMessage = useCallback(async (text: string) => {
    const id = activeBotId.current;
    if (!id) return;
    await rpc.threads.followUp({ botId: id, text });
    await refreshThreadRef.current(id);
  }, []);
  const stopRun = useCallback(async () => {
    const id = activeBotId.current;
    if (!id) return;
    await rpc.threads.stop({ botId: id });
    await refreshThreadRef.current(id);
  }, []);
  const stopTeaching = useCallback(async () => {
    const id = activeBotId.current;
    if (!id || teachBusy) return;
    const recording = taughtSkills.find(
      (skill) => skill.status === "recording" && taughtSkillsBotId === id,
    );
    if (!recording) return;
    setTeachBusy(true);
    try {
      await rpc.skills.stop({ skillId: recording.id });
      await refreshThreadRef.current(id);
      setComputerOpen(false);
    } finally {
      setTeachBusy(false);
    }
  }, [teachBusy, taughtSkills, taughtSkillsBotId]);
  // Transcript and MessageView are memoized; these must stay referentially stable or every
  // Shell state change re-renders the whole transcript.
  const refreshActiveThread = useCallback(async () => {
    const id = activeBotId.current;
    if (!id) return;
    await refreshThreadRef.current(id);
  }, []);
  const addSkillRoutine = useCallback((name: string, prompt: string) => {
    setRoutineDraft({ name, prompt, schedule: defaultCronPreset() });
    setEditingRoutine(null);
    setPanel("routine");
  }, []);
  const speakingMessageIdRef = useRef(speakingMessageId);
  speakingMessageIdRef.current = speakingMessageId;
  const speakMessage = useCallback((message: ThreadMessage) => {
    if (speakingMessageIdRef.current === message.id) {
      speaker.stop();
      return;
    }
    const text = speechFromBlocks(message.blocks);
    const id = activeBotId.current;
    if (text && id) void speaker.speak(text, { botId: id, messageId: message.id });
  }, []);

  async function createBot(input: {
    name: string;
    title: string;
    description: string;
    computerMode: ComputerMode;
  }) {
    const bot = await rpc.bots.create({
      name: input.name.trim(),
      title: input.title,
      description: input.description,
      instructions: input.description,
      notifyOnFinish: true,
      computerMode: input.computerMode,
    });
    await refreshBots();
    navigate(`/app/${bot.id}`);
    setPanel(null);
  }

  async function bootComputer({
    takeControl,
    overlay,
    force = false,
  }: {
    takeControl: boolean;
    overlay: boolean;
    force?: boolean;
  }) {
    if (!active) return;
    const needsBoot = force || computer?.state !== "running" || !screenUrl;
    if (overlay && needsBoot) setBooting(true);
    try {
      if (needsBoot) await rpc.computer.boot({ botId: active.id });
      if (takeControl) await rpc.computer.takeover({ botId: active.id });
      await refreshThread(active.id);
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    if (panel !== "computer") {
      autoBooted.current = null;
      return;
    }
    if (!active) return;
    const botId = active.id;
    let cancelled = false;
    void (async () => {
      // Refresh from the server first. A stale SSE "booting" snapshot used to
      // skip this effect, so an RPC takeover never showed "You have control".
      const snap = await refreshThread(botId).catch(() => null);
      if (cancelled || activeBotId.current !== botId) return;
      const state = snap?.computer?.state;
      const screen = state === "running" ? await refreshComputerScreen(botId) : null;
      if (cancelled || activeBotId.current !== botId) return;
      const action = computerPanelAutoBoot(state, screen);
      if (action === "wait") {
        if (state === "running") autoBooted.current = botId;
        return;
      }
      if (action === "boot" && autoBooted.current === botId) return;
      autoBooted.current = botId;
      await bootComputer({
        takeControl: false,
        overlay: action === "boot",
        force: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, active?.id]);

  useEffect(() => {
    liveViewRecovery.current?.abort();
    liveViewRecovery.current = null;
    computerOpenRequest.current += 1;
    setComputerOpen(false);
    setComputerOpeningMessage(null);
    setComputerOpenError(null);
    setScreenFrameLoaded(false);
    setRemoteTextOpen(false);
    setMobileSidebarOpen(false);
  }, [active?.id]);

  useEffect(() => {
    if (activeRunInProgress) return;
    liveViewRecovery.current?.abort();
    liveViewRecovery.current = null;
  }, [activeRunInProgress]);

  useEffect(
    () => () => {
      liveViewRecovery.current?.abort();
      computerOpenRequest.current += 1;
    },
    [],
  );

  // The routine panel copies a routine's data into local draft state at click time
  // rather than deriving it from `active`, so it goes stale across a bot switch —
  // without this, Save on bot B could silently update bot A's routine.
  useEffect(() => {
    setEditingRoutine(null);
    setDeleteRoutineTarget(null);
    setPanel((current) => (current === "routine" ? null : current));
  }, [active?.id]);

  useEffect(() => {
    setPendingAttachments((current) => {
      const stale = current.filter((attachment) => attachment.botId !== active?.id);
      revokePendingAttachmentPreviews(stale);
      return attachmentsForBot(current, active?.id);
    });
    setAttachmentNotice(null);
    setSendError(null);
  }, [active?.id]);

  useEffect(() => {
    if (!computerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (remoteTextOpen) {
        setRemoteTextOpen(false);
        return;
      }
      closeComputerOverlay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [computerOpen, remoteTextOpen]);

  useLayoutEffect(() => {
    if (computerOpen) setScreenFrameLoaded(false);
  }, [computerOpen, screenUrl]);

  useEffect(() => {
    if (!remoteTextOpen) return;
    remoteTextInput.current?.focus();
  }, [remoteTextOpen]);

  useEffect(() => {
    if ((panel !== "computer" && !computerOpen) || !active || computer?.state !== "running") return;
    const ping = () => void rpc.computer.heartbeat({ botId: active.id }).catch(() => undefined);
    ping();
    const timer = window.setInterval(ping, 60_000);
    return () => window.clearInterval(timer);
  }, [panel, computerOpen, active?.id, computer?.state]);

  useEffect(() => {
    if (computer?.kind !== "browserbase" || !screenUrl) return;
    const visibleBotId = active?.id;
    const disconnectedUrl = screenUrl;
    function onLiveViewMessage(event: MessageEvent) {
      if (
        !isBrowserbaseDisconnectedMessage(
          event.data,
          Boolean(
            screenFrame.current?.contentWindow &&
              event.source === screenFrame.current.contentWindow,
          ),
        )
      ) {
        return;
      }
      screenRequest.current += 1;
      setScreenUrl(null);
      setScreenFrameLoaded(false);
      setScreenNotice("세션 연결이 종료되었습니다. 다음 작업에서 자동으로 새 세션에 연결됩니다.");
      liveViewRecovery.current?.abort();
      liveViewRecovery.current = null;
      if (!visibleBotId || !activeRunInProgress) return;
      const controller = new AbortController();
      liveViewRecovery.current = controller;
      void pollBrowserbaseLiveViewRecovery(
        () => refreshComputerScreen(visibleBotId, disconnectedUrl),
        { signal: controller.signal },
      ).finally(() => {
        if (liveViewRecovery.current === controller) liveViewRecovery.current = null;
      });
    }
    window.addEventListener("message", onLiveViewMessage);
    return () => window.removeEventListener("message", onLiveViewMessage);
  }, [active?.id, activeRunInProgress, computer?.kind, screenUrl]);

  async function openComputer(options: { takeControl?: boolean } = {}) {
    if (!active) return;
    const request = ++computerOpenRequest.current;
    // Viewing must not pause the bot: only take the control lease when the user
    // explicitly asks for it or the bot is waiting for them on the screen.
    const wantsControl =
      options.takeControl ?? activeSnapshot?.run?.status === "waiting_takeover";
    const needsTakeover = wantsControl && !userHoldsComputerControl(computer, active.id);
    setComputerOpen(true);
    setComputerOpenError(null);
    setScreenFrameLoaded(false);
    setRemoteTextOpen(false);
    setComputerOpeningMessage(
      needsTakeover ? "브라우저에 연결하고 제어권을 확보하는 중…" : "브라우저 화면에 연결하는 중…",
    );
    try {
      await bootComputer({
        takeControl: needsTakeover,
        overlay: false,
        force: computer?.state !== "running",
      });
    } catch (error) {
      if (request !== computerOpenRequest.current) return;
      setComputerOpenError(
        error instanceof Error ? error.message : "브라우저에 연결하지 못했습니다.",
      );
    } finally {
      if (request === computerOpenRequest.current) setComputerOpeningMessage(null);
    }
  }

  function hideComputerOverlay() {
    liveViewRecovery.current?.abort();
    liveViewRecovery.current = null;
    computerOpenRequest.current += 1;
    setComputerOpen(false);
    setComputerOpeningMessage(null);
    setComputerOpenError(null);
    setScreenFrameLoaded(false);
    setRemoteTextOpen(false);
  }

  function closeComputerOverlay() {
    hideComputerOverlay();
    // A Browserbase bot is fully blocked while the user holds control, so
    // closing the window returns control instead of waiting out the lease.
    // Team desktop computers keep control across a close on purpose.
    if (active && hasControl && !recordingSkill && computer?.kind === "browserbase") {
      const botId = active.id;
      void rpc.computer
        .release({ botId })
        .then(() => refreshThread(botId))
        .catch(() => undefined);
    }
  }

  async function releaseComputer() {
    if (!active) return;
    hideComputerOverlay();
    setRemoteText("");
    setRemoteTextError(null);
    await rpc.computer.release({ botId: active.id }).catch(() => undefined);
    await refreshThread(active.id);
  }

  async function pasteRemoteText() {
    if (!active || !hasControl || !remoteText || remoteTextBusy) return;
    const text = remoteText;
    setRemoteTextBusy(true);
    setRemoteTextError(null);
    try {
      await rpc.computer.input({
        botId: active.id,
        kind: "text",
        payload: { text },
      });
      setRemoteText("");
    } catch {
      setRemoteTextError("입력하지 못했습니다. 원격 입력칸을 다시 클릭한 뒤 재시도하세요.");
    } finally {
      setRemoteTextBusy(false);
    }
  }

  const embeddedScreenUrl = embeddableScreenUrl(screenUrl);
  const hasControl = userHoldsComputerControl(computer, active?.id);

  useEffect(() => {
    if (!hasControl) {
      setRemoteTextOpen(false);
      return;
    }
    // Browserbase Live View forwards raw key events to a remote Chromium without an IME,
    // so direct Korean typing splits into jamo. Open the composed-text panel by default.
    if (computer?.kind === "browserbase") setRemoteTextOpen(true);
  }, [hasControl, computer?.kind]);

  const userName = session.data?.user.name ?? "사용자";
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      data-testid="shell-root"
      data-ready={shellReady}
      className="relative flex h-full min-w-0 overflow-hidden bg-[#050506] text-[#DFDFE2]"
    >
      {bootstrapMe !== undefined ? (
        <HostComputerPrompt initialMe={bootstrapMe ?? undefined} />
      ) : null}
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="봇 목록 닫기"
          className="absolute inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <aside
        id="bot-navigation"
        data-testid="bot-sidebar"
        className={`${mobileSidebarOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-40 w-[min(316px,88vw)] shrink-0 flex-col border-r border-[#171719] bg-[#0B0B0C] md:relative md:z-auto md:flex md:w-[316px]`}
      >
        <div className="app-drag flex items-center justify-between px-[18px] pb-3 pt-4">
          <WindowChrome />
          <div className="app-no-drag flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMobileSidebarOpen(false);
                setPanel("create");
              }}
              className="text-[21px] text-[#7A7A80] hover:text-[#C9C9CE]"
              title="새 봇"
            >
              +
            </button>
            <button
              type="button"
              aria-label="봇 목록 닫기"
              className="text-[#85858A] hover:text-[#ECECEE] md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="mx-3.5 mb-3 flex items-center gap-2.5 rounded-xl border border-[#202023] bg-[#141416] px-3 py-2 text-[14px] text-[#6C6C70]">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            className="w-full bg-transparent outline-none"
          />
        </div>
        <div className="rk-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
          {showWorkspaceSearch ? (
            <WorkspaceSearchResults
              hits={searchHits}
              loading={searchLoading}
              onSelect={(hit) => void jumpToSearchHit(hit)}
            />
          ) : (
            sidebarGroups.map((group) => (
              <div key={group.key} data-sidebar-group={group.key}>
                {group.title ? (
                  <div className="px-2.5 pb-1 pt-3 text-[12.5px] font-medium text-[#6C6C70]">
                    {group.title}
                  </div>
                ) : null}
                {group.bots.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => {
                      setMobileSidebarOpen(false);
                      navigate(`/app/${bot.id}`);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setBotMenu({
                        botId: bot.id,
                        position: { x: event.clientX, y: event.clientY },
                      });
                    }}
                    className="flex w-full gap-3 rounded-xl px-2.5 py-[11px] text-left"
                    style={{
                      background: active?.id === bot.id ? "#161618" : "transparent",
                    }}
                  >
                    <BotAvatar color={bot.color} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`truncate text-[15px] text-[#ECECEE] ${
                            bot.unread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {bot.name}
                          {bot.unread ? <span className="sr-only"> (읽지 않음)</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-[#6C6C70]">
                          {koreanStatusLabel(bot.status)}
                          {bot.unread ? (
                            <span
                              aria-hidden="true"
                              className="inline-block h-2 w-2 rounded-full bg-[#8B5CF6]"
                            />
                          ) : null}
                        </span>
                      </div>
                      <div
                        className={`mt-0.5 truncate text-[13.5px] ${
                          bot.unread ? "font-medium text-[#C9C9CE]" : "text-[#85858A]"
                        }`}
                      >
                        {bot.preview || bot.title}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
          {archivedBots.length > 0 && !showWorkspaceSearch ? (
            <div className="mt-2 border-t border-[#202023] pt-2">
              <button
                type="button"
                aria-expanded={archivedOpen}
                onClick={() => setArchivedOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13.5px] text-[#85858A] hover:bg-[#131315]"
              >
                <span>보관된 봇</span>
                <span>{archivedBots.length}</span>
              </button>
              {archivedOpen
                ? archivedBots.map((bot) => (
                    <div key={bot.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                      <BotAvatar color={bot.color} size={28} />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-[#A8A8AD]">
                        {bot.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void rpc.bots.restore({ botId: bot.id }).then(() => refreshBots(true))
                        }
                        className="text-[12.5px] text-[#C9C9CE] hover:text-white"
                      >
                        복원
                      </button>
                      <button
                        type="button"
                        aria-label={`${bot.name} 삭제`}
                        onClick={() => setDeleteTarget(bot)}
                        className="text-[12.5px] text-[#FF5364]"
                      >
                        삭제
                      </button>
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setPluginsOpen(true)}
          className="mx-3 mb-1 flex items-center gap-3 rounded-[11px] px-2.5 py-2 hover:bg-[#131315]"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0]">
            <Puzzle size={15} strokeWidth={1.7} />
          </span>
          <span className="text-[14.5px] text-[#C9C9CE]">플러그인</span>
        </button>
        <div className="relative">
          {menuOpen ? (
            <div className="absolute bottom-14 left-3 right-3 rounded-2xl border border-[#2A2A2F] bg-[#1A1A1D] p-2 shadow-[0_22px_50px_rgba(0,0,0,.55)]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setModelsOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
              >
                <Cpu size={16} strokeWidth={1.7} className="text-[#9A9AA0]" />
                <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">모델</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setVoiceOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
              >
                <Volume2 size={16} strokeWidth={1.7} className="text-[#9A9AA0]" />
                <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">음성</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
                onClick={async () => {
                  setUsage(await rpc.usage.summary());
                }}
              >
                <Gauge size={16} strokeWidth={1.7} className="text-[#9A9AA0]" />
                <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">주간 사용량</span>
              </button>
              {usage ? (
                <p className="px-3 pb-2 text-[12.5px] text-[#85858A]">
                  작업 {usage.runs}회 · 토큰 {usage.inputTokens + usage.outputTokens}개
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void authClient.signOut().then(() => navigate("/"))}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
              >
                <LogOut size={16} strokeWidth={1.7} className="text-[#9A9AA0]" />
                <span className="text-[14.5px] text-[#ECECEE]">로그아웃</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "계정과 모든 데이터를 삭제할까요? 삭제 후에는 복구할 수 없습니다.",
                    )
                  ) {
                    return;
                  }
                  const password = window.prompt("계정 삭제를 확인하려면 비밀번호를 입력하세요.");
                  if (!password) return;
                  const result = await authClient.deleteUser({
                    password,
                    callbackURL: "/",
                  });
                  if (result.error) {
                    window.alert(result.error.message ?? "계정을 삭제하지 못했습니다.");
                    return;
                  }
                  navigate("/");
                }}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-[#F08B8B] hover:bg-[#2A1D20]"
              >
                <Trash2 size={16} strokeWidth={1.7} />
                <span className="text-[14.5px]">계정 삭제</span>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-[11px] px-[18px] py-3.5"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#232326] text-[12px] text-[#A8A8AD]">
              {initials}
            </span>
            <span className="text-[14.5px] text-[#C9C9CE]">{userName}</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#0D0D0E]">
        <div className="flex items-center justify-between border-b border-[#141416] px-3 py-[17px] sm:px-[22px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="봇 목록 열기"
              aria-controls="bot-navigation"
              aria-expanded={mobileSidebarOpen}
              className="grid h-[30px] w-[34px] shrink-0 place-items-center rounded-[9px] hover:bg-[#1B1B1E] md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <MenuIcon size={18} strokeWidth={1.8} className="text-[#A8A8AD]" />
            </button>
            <button
              type="button"
              data-testid="bot-settings-trigger"
              onClick={() => setPanel("settings")}
              className="flex min-w-0 items-center gap-3"
            >
              {active ? <BotAvatar color={active.color} size={26} /> : null}
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-medium text-[#ECECEE]">
                  {active?.name ?? "봇을 선택하세요"}
                </span>
              </span>
            </button>
          </div>
          <div className="flex items-center gap-1">
            {active ? (
              <button
                type="button"
                title={voiceStatus?.ready ? "통화" : "통화하려면 음성을 설정하세요"}
                aria-label="통화"
                onClick={() => {
                  if (!voiceStatus?.ready) {
                    setVoiceOpen(true);
                    return;
                  }
                  setCallOpen(true);
                }}
                className="grid h-[30px] w-[34px] place-items-center rounded-[9px] hover:bg-[#1B1B1E]"
                style={{ background: callOpen ? "#1B1B1E" : "transparent" }}
              >
                <Phone size={16} strokeWidth={1.6} className="text-[#A8A8AD]" />
              </button>
            ) : null}
            <button
              type="button"
              title="에이전트 브라우저"
              onClick={() => setPanel((p) => (p === "computer" ? null : "computer"))}
              className="grid h-[30px] w-[34px] place-items-center rounded-[9px] hover:bg-[#1B1B1E]"
              style={{ background: panel ? "#1B1B1E" : "transparent" }}
            >
              <Monitor size={18} strokeWidth={1.6} className="text-[#A8A8AD]" />
            </button>
          </div>
        </div>
        <Transcript
          scrollRef={messageScroll}
          onScroll={onTranscriptScroll}
          botId={active?.id ?? ""}
          messages={transcriptMessages}
          olderCursor={activeSnapshot?.olderCursor ?? null}
          loadingOlder={loadingOlder}
          loading={!activeSnapshot && Boolean(active)}
          answerableAskMessageId={answerableAskMessageId}
          running={Boolean(
            activeSnapshot?.run &&
              ["running", "queued", "leased"].includes(activeSnapshot.run.status),
          )}
          runError={activeSnapshot?.run?.status === "failed" ? activeSnapshot.run.error : null}
          onLoadOlder={loadOlder}
          onOpenBot={openBot}
          onAnswer={answerMessage}
          onRefresh={refreshActiveThread}
          onAddRoutine={addSkillRoutine}
          voiceReady={Boolean(voiceStatus?.ready)}
          speakingMessageId={speakingMessageId}
          onSpeak={speakMessage}
        />
        {recordingSkill ? (
          <div className="px-6 pb-2 text-center text-[13px] text-[#E65707]">
            동작 학습 중입니다. 새 메시지를 보내려면 먼저 학습을 중지하세요.
          </div>
        ) : null}
        <Composer
          key={active?.id ?? "no-bot"}
          activeName={active?.name}
          running={Boolean(activeSnapshot?.run && isActive(activeSnapshot.run.status))}
          disabled={Boolean(recordingSkill)}
          pendingAttachments={activePendingAttachments}
          attachmentNotice={attachmentNotice}
          sendError={sendError}
          dictationError={dictationError}
          sending={sending}
          fileInputRef={fileInputRef}
          onAttachmentPick={onAttachmentPick}
          onRemoveAttachment={removeAttachment}
          onSend={sendMessage}
          onStop={stopRun}
          dictating={dictating}
          transcribe={Boolean(voiceStatus?.transcribe)}
          onDictateStart={(onFinal) => {
            void dictation.listen({
              mode: "hold",
              transcribe: Boolean(voiceStatus?.transcribe),
              onFinal,
            });
          }}
          onDictateStop={() => dictation.submitHold()}
        />
      </main>

      <aside
        data-testid="side-panel"
        data-panel={panel ?? "closed"}
        className={`absolute inset-y-0 right-0 z-20 flex min-h-0 shrink-0 flex-col overflow-hidden bg-[#0A0A0B] transition-[width] duration-150 ease-out md:relative md:inset-auto ${
          panel && (active || panel === "create")
            ? "w-full border-l border-[#141416] md:w-[384px]"
            : "pointer-events-none w-0"
        }`}
      >
        {panel === "create" ? (
          <div className="rk-scroll h-full w-full overflow-y-auto px-5 py-[17px]">
            <CreateBotForm
              onCancel={() => setPanel(null)}
              onCreate={(input) => void createBot(input)}
            />
          </div>
        ) : panel && active ? (
          <div className="rk-scroll h-full w-full overflow-y-auto px-5 py-[17px]">
            {panel !== "routine" ? (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[13.5px] text-[#85858A]">
                  {koreanStatusLabel(computer?.state ?? active.status)}
                </span>
                <div className="flex gap-3.5">
                  <button type="button" aria-label="봇 설정" onClick={() => setPanel("settings")}>
                    <Settings size={16} strokeWidth={1.7} />
                  </button>
                  <button type="button" aria-label="패널 닫기" onClick={() => setPanel(null)}>
                    <X size={16} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ) : null}
            {panel === "computer" ? (
              <div>
                <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] bg-[#0E0E10]">
                  {computerOpen ? (
                    <div className="grid h-full place-items-center px-5 text-center text-sm leading-5 text-[#6C6C70]">
                      전체 화면에서 열려 있습니다
                    </div>
                  ) : computer?.kind === "desktop" ? (
                    <div className="grid h-full place-items-center px-6 text-center text-sm text-[#6C6C70]">
                      이 봇은 Linux 데스크톱이 아니라 현재 컴퓨터에서 실행됩니다. 셸과 파일은 홈
                      폴더를 사용합니다.
                    </div>
                  ) : computer?.state === "running" && embeddedScreenUrl ? (
                    <iframe
                      ref={screenFrame}
                      title="봇 화면 미리보기"
                      src={embeddedScreenUrl}
                      sandbox={screenIframeSandbox(
                        embeddedScreenUrl,
                        computer?.kind,
                        window.location.href,
                      )}
                      className="h-full w-full border-0 bg-black"
                      allow="clipboard-read; clipboard-write"
                      style={{ pointerEvents: "none" }}
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                      {screenNotice ??
                        computerPlaceholder(
                          computer?.state,
                          booting,
                          computerLabel(computer?.mode, active.name),
                        )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute inset-0 cursor-pointer"
                    aria-label="브라우저 열기"
                    onClick={() => void openComputer()}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[13.5px] text-[#85858A]">
                    {computer?.busyBotName
                      ? `${computer.busyBotName} 봇이 사용 중`
                      : hasControl
                        ? "사용자가 제어 중"
                        : computer?.state === "suspended"
                          ? "다음 작업에서 브라우저 자동 시작"
                          : computerLabel(computer?.mode, active.name)}
                  </span>
                  {hasControl ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void releaseComputer()}
                    >
                      봇에게 제어권 반환
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openComputer({ takeControl: true })}
                    >
                      직접 제어
                    </Button>
                  )}
                </div>
                <div className="mt-[30px] mb-3 text-[14px] text-[#85858A]">자동 작업</div>
                {activeRoutines.map((routine) => (
                  <button
                    key={routine.id}
                    type="button"
                    onClick={() => {
                      setRoutineDraft({
                        name: routine.name,
                        prompt: routine.prompt,
                        schedule: presetFromCron(routine.cron),
                      });
                      setEditingRoutine(routine);
                      setPanel("routine");
                    }}
                    className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 hover:bg-[#121214]"
                  >
                    <span className="text-[#E65707]">◷</span>
                    <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">
                      {routine.name}
                    </span>
                    <span className="text-[13px] text-[#6C6C70]">
                      {formatKoreanCron(routine.cron)}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setRoutineDraft({
                      name: "",
                      prompt: "",
                      schedule: defaultCronPreset(),
                    });
                    setEditingRoutine(null);
                    setPanel("routine");
                  }}
                  className="mt-1 flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
                >
                  + 새 자동 작업
                </button>
                {active ? (
                  <TeachComputerSection
                    botId={active.id}
                    computer={computer}
                    skills={activeTaughtSkills}
                    busy={teachBusy}
                    onRefresh={refreshActiveThread}
                    onOpenComputer={openComputer}
                    onStopTeaching={stopTeaching}
                    onAddRoutine={(skill) => {
                      setRoutineDraft({
                        name: skill.name || skill.goal.slice(0, 80),
                        prompt: `학습한 작업 실행: ${skill.name || skill.goal}\n${skill.playbook.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
                        schedule: defaultCronPreset(),
                      });
                      setEditingRoutine(null);
                      setPanel("routine");
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            {panel === "settings" ? (
              <BotSettings
                key={active.id}
                bot={active}
                onSave={async ({ computerMode, ...patch }) => {
                  if (computerMode !== active.computerMode) {
                    await rpc.bots.setComputer({
                      botId: active.id,
                      mode: computerMode,
                    });
                  }
                  await rpc.bots.update({ botId: active.id, ...patch });
                  await refreshBots();
                }}
                onExport={async () => {
                  const manifest = await rpc.export.bot({ botId: active.id });
                  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${active.name.toLowerCase().replace(/\s+/g, "-")}-export.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                onClear={() => setClearTarget(active)}
              />
            ) : null}
            {panel === "routine" ? (
              <div>
                <div className="mb-5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setPanel("computer")}
                    className="text-[#9A9AA0]"
                  >
                    <ChevronLeft size={18} strokeWidth={1.8} />
                  </button>
                  <div className="text-[15.5px] font-medium text-[#F1F1F2]">자동 작업</div>
                  <button type="button" onClick={() => setPanel(null)} className="text-[#6C6C70]">
                    <X size={16} strokeWidth={1.8} />
                  </button>
                </div>
                <label className="text-[14px] text-[#85858A]">
                  이름
                  <input
                    value={routineDraft.name}
                    onChange={(e) => setRoutineDraft((s) => ({ ...s, name: e.target.value }))}
                    className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                  />
                </label>
                <label className="mt-5 block text-[14px] text-[#85858A]">
                  작업 지시
                  <textarea
                    value={routineDraft.prompt}
                    onChange={(e) => setRoutineDraft((s) => ({ ...s, prompt: e.target.value }))}
                    rows={4}
                    className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                  />
                </label>
                <div className="mt-5 text-[14px] text-[#85858A]">
                  실행 시점
                  <Suspense fallback={null}>
                    <RoutineSchedule
                      value={routineDraft.schedule}
                      onChange={(schedule) => setRoutineDraft((s) => ({ ...s, schedule }))}
                    />
                  </Suspense>
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={savingRoutine || runningRoutine}
                    onClick={async () => {
                      if (routineSavePending.current) return;
                      const targetBotId = active.id;
                      const targetRoutine = editingRoutine;
                      if (targetRoutine && targetRoutine.botId !== targetBotId) return;
                      routineSavePending.current = true;
                      setSavingRoutine(true);
                      try {
                        if (targetRoutine) {
                          await rpc.routines.update({
                            routineId: targetRoutine.id,
                            name: routineDraft.name || "자동 작업",
                            prompt: routineDraft.prompt || "상태를 확인해 줘.",
                            cron: cronFromPreset(routineDraft.schedule),
                          });
                        } else {
                          await rpc.routines.create({
                            botId: targetBotId,
                            name: routineDraft.name || "자동 작업",
                            prompt: routineDraft.prompt || "상태를 확인해 줘.",
                            cron: cronFromPreset(routineDraft.schedule),
                            timezone: "UTC",
                            active: true,
                            notify: true,
                          });
                        }
                        if (activeBotId.current !== targetBotId) return;
                        await refreshThread(targetBotId);
                        if (activeBotId.current === targetBotId) setPanel("computer");
                      } finally {
                        routineSavePending.current = false;
                        setSavingRoutine(false);
                      }
                    }}
                    className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A] disabled:opacity-40"
                  >
                    {savingRoutine ? "저장 중…" : "저장"}
                  </button>
                  {editingRoutine?.botId === active.id ? (
                    <>
                      <button
                        type="button"
                        disabled={savingRoutine || runningRoutine}
                        onClick={async () => {
                          if (routineRunPending.current) return;
                          const targetBotId = active.id;
                          const targetRoutine = editingRoutine;
                          routineRunPending.current = true;
                          setRunningRoutine(true);
                          try {
                            await rpc.routines.testRun({
                              routineId: targetRoutine.id,
                            });
                            await refreshThread(targetBotId);
                          } finally {
                            routineRunPending.current = false;
                            setRunningRoutine(false);
                          }
                        }}
                        className="rounded-[11px] border border-[#26262A] px-4 py-2 text-[14px] text-[#ECECEE] disabled:opacity-40"
                      >
                        {runningRoutine ? "실행 중…" : "지금 실행"}
                      </button>
                      <button
                        type="button"
                        disabled={savingRoutine || runningRoutine}
                        onClick={() => setDeleteRoutineTarget(editingRoutine)}
                        className="rounded-[11px] px-4 py-2 text-[14px] text-[#FF5364] disabled:opacity-40"
                      >
                        자동 작업 삭제
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      <Suspense fallback={null}>
        {contextBot && botMenu ? (
          <BotContextMenu
            bot={contextBot}
            position={botMenu.position}
            onClose={closeBotMenu}
            sections={botSections}
            onTogglePinned={() => {
              setBotMenu(null);
              void rpc.bots
                .update({ botId: contextBot.id, pinned: !contextBot.pinned })
                .then(() => refreshBots());
            }}
            onToggleUnread={() => {
              const unread = !contextBot.unread;
              setBotMenu(null);
              const request = unread ? markBotUnread(contextBot.id) : markBotRead(contextBot.id);
              void request.catch(() => undefined);
            }}
            onMoveToSection={(sectionId) => {
              setBotMenu(null);
              if (sectionId === contextBot.sectionId) return;
              void rpc.bots.update({ botId: contextBot.id, sectionId }).then(() => refreshBots());
            }}
            onCreateSection={() => {
              setNewSectionBot(contextBot);
              setBotMenu(null);
            }}
            onEdit={() => {
              navigate(`/app/${contextBot.id}`);
              setPanel("settings");
              setBotMenu(null);
            }}
            onDuplicate={() => {
              setBotMenu(null);
              void rpc.bots.duplicate({ botId: contextBot.id }).then(async (bot) => {
                await refreshBots();
                navigate(`/app/${bot.id}`);
              });
            }}
            onClear={() => {
              setClearTarget(contextBot);
              setBotMenu(null);
            }}
            onArchive={() => {
              setBotMenu(null);
              void rpc.bots.archive({ botId: contextBot.id }).then(() => refreshBots(true));
            }}
            onDelete={() => {
              setDeleteTarget(contextBot);
              setBotMenu(null);
            }}
          />
        ) : null}

        {deleteTarget ? (
          <DeleteBotDialog
            bot={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={async (deleteMemories) => {
              await rpc.bots.remove({ botId: deleteTarget.id, deleteMemories });
              setDeleteTarget(null);
              setPanel(null);
              await refreshBots(true);
            }}
          />
        ) : null}

        {newSectionBot ? (
          <NewBotSectionDialog
            bot={newSectionBot}
            onCancel={() => setNewSectionBot(null)}
            onConfirm={async (name) => {
              await rpc.botSections.create({ botId: newSectionBot.id, name });
              setNewSectionBot(null);
              await refreshBots();
            }}
          />
        ) : null}

        {clearTarget ? (
          <ClearConversationDialog
            bot={clearTarget}
            onCancel={() => setClearTarget(null)}
            onConfirm={async () => {
              await rpc.threads.clear({ botId: clearTarget.id });
              if (active?.id === clearTarget.id) {
                expandedHistoryThread.current = null;
                pinnedAroundRef.current = null;
                historyEpoch.current += 1;
                setSnapshot((current) =>
                  current ? { ...current, messages: [], olderCursor: null, run: null } : current,
                );
              }
              setClearTarget(null);
              await refreshBots();
            }}
          />
        ) : null}

        {deleteRoutineTarget ? (
          <DeleteRoutineDialog
            routine={deleteRoutineTarget}
            onCancel={() => setDeleteRoutineTarget(null)}
            onConfirm={async () => {
              const target = deleteRoutineTarget;
              await rpc.routines.remove({ routineId: target.id });
              setDeleteRoutineTarget(null);
              setEditingRoutine((current) => (current?.id === target.id ? null : current));
              if (activeBotId.current !== target.botId) return;
              await refreshThread(target.botId);
              if (activeBotId.current === target.botId) setPanel("computer");
            }}
          />
        ) : null}

        {pluginsOpen ? <PluginsOverlay onClose={() => setPluginsOpen(false)} /> : null}
      </Suspense>

      <Suspense fallback={null}>
        {modelsOpen ? <ModelSettingsOverlay onClose={() => setModelsOpen(false)} /> : null}
        {voiceOpen ? (
          <VoiceSettingsOverlay
            onClose={() => {
              setVoiceOpen(false);
              void rpc.voice
                .status()
                .then(setVoiceStatus)
                .catch(() => undefined);
            }}
          />
        ) : null}
        {callOpen && active ? (
          <CallView
            botId={active.id}
            botName={active.name}
            transcribe={Boolean(voiceStatus?.transcribe)}
            snapshot={snapshot}
            onSend={sendMessage}
            onFollowUp={followUpMessage}
            onAnswer={answerMessage}
            onClose={() => setCallOpen(false)}
          />
        ) : null}
      </Suspense>

      {booting && !computerOpen ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[22px] bg-[rgba(4,4,5,.96)]">
          <div className="text-[19px] font-medium text-[#F1F1F2]">
            {active?.name} 브라우저를 시작하는 중
          </div>
          <div className="h-[5px] w-[min(420px,70%)] overflow-hidden rounded-full bg-[#232327]">
            <div className="h-full w-2/3 rounded-full bg-[#F1F1EF]" />
          </div>
        </div>
      ) : computerOpen && active ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#050506]">
          <div
            data-testid="computer-toolbar"
            className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#171719] px-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <BotAvatar color={active.color} size={22} />
              {recordingSkill ? (
                <TeachRecordingChrome
                  recording={recordingSkill}
                  busy={teachBusy}
                  onStop={stopTeaching}
                  variant="overlay"
                />
              ) : (
                <span className="truncate text-[14px] font-medium text-[#ECECEE]">
                  {computerLabel(computer?.mode, active.name)}
                </span>
              )}
              {!recordingSkill && hasControl ? (
                <span className="hidden shrink-0 rounded-full bg-[rgba(48,162,75,.14)] px-2 py-0.5 text-[12px] text-[#4ECB71] sm:inline">
                  사용자가 제어 중
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {recordingSkill ? (
                <TeachStopButton busy={teachBusy} onStop={stopTeaching} />
              ) : (
                <>
                  {computer?.kind === "browserbase" && hasControl ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-expanded={remoteTextOpen}
                      aria-controls="remote-korean-input"
                      onClick={() => {
                        setRemoteTextOpen((open) => !open);
                        setRemoteTextError(null);
                      }}
                    >
                      한글 입력
                    </Button>
                  ) : null}
                  {hasControl ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label="봇에게 제어권 반환"
                      onClick={() => void releaseComputer()}
                    >
                      봇에게 반환
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(computerOpeningMessage)}
                      onClick={() => void openComputer({ takeControl: true })}
                    >
                      직접 제어
                    </Button>
                  )}
                </>
              )}
              <button
                type="button"
                className="grid h-8 w-8 place-items-center text-[#85858A] hover:text-[#ECECEE]"
                aria-label="브라우저 닫기"
                onClick={closeComputerOverlay}
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 bg-[#0E0E10]">
            {computerOpenError ? (
              <div className="grid h-full place-items-center px-6 text-center">
                <div className="max-w-md">
                  <div className="text-[16px] font-medium text-[#ECECEE]">
                    브라우저 연결에 실패했습니다
                  </div>
                  <div className="mt-2 text-[13px] leading-5 text-[#85858A]">
                    {computerOpenError}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => void openComputer()}
                  >
                    다시 시도
                  </Button>
                </div>
              </div>
            ) : computer?.kind === "desktop" ? (
              <div className="grid h-full place-items-center px-8 text-center text-sm text-[#6C6C70]">
                이 봇은 현재 컴퓨터에서 실행됩니다. 별도의 Linux 데스크톱은 없습니다. 셸을
                사용하도록 요청할 수 있으며 홈 폴더 아래의 작업 디렉터리에 접근할 수 있습니다.
              </div>
            ) : computer?.state === "running" && embeddedScreenUrl ? (
              <>
                <iframe
                  ref={screenFrame}
                  title="봇 브라우저 화면"
                  src={embeddedScreenUrl}
                  sandbox={screenIframeSandbox(
                    embeddedScreenUrl,
                    computer?.kind,
                    window.location.href,
                  )}
                  className="h-full w-full border-0 bg-black"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  onLoad={() => setScreenFrameLoaded(true)}
                  style={{
                    pointerEvents: recordingSkill || !hasControl ? "none" : "auto",
                  }}
                />
                {active ? (
                  <TeachCaptureOverlay
                    botId={active.id}
                    skill={recordingSkill}
                    enabled={Boolean(recordingSkill)}
                    screenWidth={computer?.screenWidth}
                    screenHeight={computer?.screenHeight}
                  />
                ) : null}
              </>
            ) : computerOpeningMessage ? (
              <div className="h-full bg-black" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                {screenNotice ??
                  (computer?.state === "suspended"
                    ? SUSPENDED_COMPUTER_MESSAGE
                    : computerLabel(computer?.mode, active.name))}
              </div>
            )}
            {computerOpeningMessage ? (
              <div
                role="status"
                className="absolute inset-0 z-10 grid place-items-center bg-[rgba(8,8,10,.88)] px-6 text-center"
                data-testid="computer-connecting"
              >
                <div>
                  <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[#34343A] border-t-[#ECECEE]" />
                  <div className="mt-4 text-[14px] text-[#B7B7BC]">{computerOpeningMessage}</div>
                  <div className="mt-1.5 text-[12px] text-[#68686E]">
                    화면이 준비되면 바로 직접 조작할 수 있습니다.
                  </div>
                </div>
              </div>
            ) : null}
            {!screenFrameLoaded &&
            !computerOpeningMessage &&
            !computerOpenError &&
            computer?.state === "running" &&
            embeddedScreenUrl ? (
              <div
                role="status"
                className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[rgba(8,8,10,.88)] text-center"
                data-testid="computer-frame-loading"
              >
                <div>
                  <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[#34343A] border-t-[#ECECEE]" />
                  <div className="mt-4 text-[14px] text-[#B7B7BC]">
                    실시간 브라우저 화면을 불러오는 중…
                  </div>
                </div>
              </div>
            ) : null}
            {computer?.kind === "browserbase" &&
            hasControl &&
            !recordingSkill &&
            remoteTextOpen &&
            !computerOpeningMessage &&
            !computerOpenError ? (
              <div
                id="remote-korean-input"
                role="dialog"
                aria-label="한글 원격 입력"
                className="absolute top-3 right-3 z-20 w-[min(420px,calc(100%-24px))] rounded-[14px] border border-[#303035] bg-[rgba(11,11,13,.97)] p-3 shadow-2xl backdrop-blur"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-[#D7D7DB]">한글 원격 입력</span>
                  <button
                    type="button"
                    aria-label="한글 입력 닫기"
                    className="grid h-6 w-6 place-items-center text-[#77777D] hover:text-[#ECECEE]"
                    onClick={() => setRemoteTextOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={remoteTextInput}
                    value={remoteText}
                    maxLength={10_000}
                    autoComplete="off"
                    aria-label="한글 및 IME 원격 입력"
                    placeholder="원격 입력칸을 클릭한 뒤 한글을 입력하세요"
                    onChange={(event) => {
                      setRemoteText(event.target.value);
                      setRemoteTextError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setRemoteTextOpen(false);
                        return;
                      }
                      if (
                        event.key !== "Enter" ||
                        event.shiftKey ||
                        event.nativeEvent.isComposing
                      ) {
                        return;
                      }
                      event.preventDefault();
                      void pasteRemoteText();
                    }}
                    className="min-w-0 flex-1 rounded-[10px] border border-[#303035] bg-[#141416] px-3 py-2 text-[14px] text-[#ECECEE] outline-none placeholder:text-[#66666D] focus:border-[#66666D]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!remoteText || remoteTextBusy}
                    onClick={() => void pasteRemoteText()}
                  >
                    {remoteTextBusy ? "입력 중…" : "입력"}
                  </Button>
                </div>
                <div
                  className={`mt-2 text-[12px] ${remoteTextError ? "text-[#F17171]" : "text-[#77777D]"}`}
                >
                  {remoteTextError ??
                    "원격 화면에 직접 타이핑하면 한글 자모가 분리됩니다. 원격 입력칸을 클릭한 뒤 여기서 문장을 완성해 전송하세요."}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const Transcript = memo(function Transcript({
  scrollRef,
  onScroll,
  botId,
  messages,
  olderCursor,
  loadingOlder,
  loading,
  answerableAskMessageId,
  running,
  runError,
  onLoadOlder,
  onOpenBot,
  onAnswer,
  onRefresh,
  onAddRoutine,
  voiceReady,
  speakingMessageId,
  onSpeak,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  botId: string;
  messages: ThreadMessage[];
  olderCursor: number | null;
  loadingOlder: boolean;
  loading: boolean;
  answerableAskMessageId: string | null;
  running: boolean;
  runError: string | null;
  onLoadOlder: () => void | Promise<void>;
  onOpenBot: (botId: string) => void;
  onAnswer: (message: ThreadMessage, text: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speakingMessageId: string | null;
  onSpeak: (message: ThreadMessage) => void;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid="transcript"
      className="rk-scroll flex flex-1 flex-col gap-[13px] overflow-y-auto px-7 py-6"
    >
      {olderCursor != null ? (
        <button
          type="button"
          disabled={loadingOlder}
          onClick={() => void onLoadOlder()}
          className="self-center rounded-lg px-3 py-1.5 text-[13px] text-[#85858A] hover:bg-[#1A1A1D] hover:text-[#C9C9CE] disabled:opacity-50"
        >
          {loadingOlder ? "불러오는 중…" : "이전 메시지 보기"}
        </button>
      ) : null}
      {loading && messages.length === 0 ? (
        <div className="grid flex-1 place-items-center text-[13px] text-[#6C6C70]">
          대화를 불러오는 중…
        </div>
      ) : null}
      {messages.map((message) => (
        <div key={message.id} data-message-id={message.id}>
          <MessageView
            botId={botId}
            message={message}
            canAnswer={message.id === answerableAskMessageId}
            onOpenBot={onOpenBot}
            onAnswer={onAnswer}
            onRefresh={onRefresh}
            onAddRoutine={onAddRoutine}
            voiceReady={voiceReady}
            speaking={speakingMessageId === message.id}
            onSpeak={() => onSpeak(message)}
          />
        </div>
      ))}
      {running ? (
        <div className="flex justify-start">
          <div
            className="rounded-[20px] bg-[#1A1A1D] px-[18px] py-[13px] text-[14.5px] text-[#85858A]"
            style={{ animation: "rkPulse 1.2s ease-in-out infinite" }}
          >
            작업 중…
          </div>
        </div>
      ) : null}
      {runError ? (
        <div className="flex justify-start" role="alert">
          <div className="max-w-[min(680px,88%)] rounded-[18px] border border-[#5C2C2C] bg-[#241313] px-[18px] py-[13px] text-[14px] leading-6 text-[#F0A5A5]">
            <div className="mb-1 font-medium text-[#FFB0B0]">작업을 완료하지 못했습니다</div>
            <div>{runError}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

const Composer = memo(function Composer({
  activeName,
  running,
  disabled,
  pendingAttachments,
  attachmentNotice,
  sendError,
  dictationError,
  sending,
  fileInputRef,
  onAttachmentPick,
  onRemoveAttachment,
  onSend,
  onStop,
  dictating,
  transcribe,
  onDictateStart,
  onDictateStop,
}: {
  activeName?: string;
  running: boolean;
  disabled?: boolean;
  pendingAttachments: PendingAttachment[];
  attachmentNotice: string | null;
  sendError: string | null;
  dictationError: string | null;
  sending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentPick: (files: FileList | null) => void | Promise<void>;
  onRemoveAttachment: (attachment: PendingAttachment) => void;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  dictating: boolean;
  transcribe: boolean;
  onDictateStart: (onFinal: (text: string) => void) => void;
  onDictateStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const textInputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const canSend = draft.trim().length > 0 || pendingAttachments.length > 0;

  function send() {
    const text = textInputRef.current?.value ?? draft;
    if ((text.trim().length === 0 && pendingAttachments.length === 0) || sending || disabled)
      return;
    setDraft("");
    void onSend(text);
  }

  return (
    <div className="px-6 pb-6 pt-3">
      {sendError || dictationError ? (
        <div className="mb-3 rounded-[14px] border border-[#5A2A2A] bg-[#2A1717] px-4 py-2 text-[13px] text-[#F1A8A8]">
          {sendError ?? dictationError}
        </div>
      ) : null}
      {attachmentNotice ? (
        <div className="mb-3 rounded-[14px] border border-[#3A3A20] bg-[#232316] px-4 py-2 text-[13px] text-[#D6CFA0]">
          {attachmentNotice}
        </div>
      ) : null}
      {pendingAttachments.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-full border border-[#26262A] bg-[#17171A] px-3 py-1.5 text-[13px] text-[#C9C9CE]"
            >
              {attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.file.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Paperclip size={14} strokeWidth={1.8} />
              )}
              <span className="max-w-[180px] truncate">{attachment.file.name}</span>
              <button
                type="button"
                aria-label={`${attachment.file.name} 첨부 취소`}
                onClick={() => onRemoveAttachment(attachment)}
                className="text-[#85858A] hover:text-[#ECECEE]"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-3.5 rounded-full border border-[#202023] bg-[#131315] py-[9px] pr-2.5 pl-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => void onAttachmentPick(event.target.files)}
        />
        <button
          type="button"
          aria-label="파일 첨부"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-[#26262A] text-[#9A9AA0] disabled:opacity-40"
        >
          <Plus size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={dictating ? "음성 입력 중지" : "음성 입력"}
          onMouseDown={(event) => {
            event.preventDefault();
            onDictateStart((text) => setDraft((current) => `${current} ${text}`.trim()));
          }}
          onMouseUp={onDictateStop}
          onMouseLeave={() => {
            if (dictating) onDictateStop();
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            onDictateStart((text) => setDraft((current) => `${current} ${text}`.trim()));
          }}
          onTouchEnd={onDictateStop}
          className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border ${
            dictating
              ? "border-[#4ECB71] bg-[rgba(48,162,75,.16)] text-[#4ECB71]"
              : "border-[#26262A] text-[#9A9AA0]"
          }`}
          title={transcribe ? "누르고 말하기" : "누르고 말하기(기기 내 음성 인식)"}
        >
          <Mic size={16} strokeWidth={1.8} />
        </button>
        <input
          ref={textInputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)
                return;
              event.preventDefault();
              send();
            }
          }}
          disabled={disabled}
          placeholder={activeName ? `${activeName}에게 작업 지시` : "메시지 입력…"}
          className="flex-1 bg-transparent text-[15.5px] text-[#E9E9EA] outline-none disabled:opacity-40"
        />
        {running ? (
          <button
            type="button"
            aria-label="작업 중지"
            onClick={() => void onStop()}
            className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[#17171A]"
          >
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="전송"
            disabled={sending || !canSend || disabled}
            onClick={send}
            className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[#17171A] disabled:opacity-50"
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
});

function applyThreadEvent(
  event: ProductEvent,
  setSnapshot: Dispatch<SetStateAction<ThreadSnapshot | null>>,
  setComputer: Dispatch<SetStateAction<ComputerStatus | null>>,
) {
  if (isThreadSnapshotEvent(event)) {
    setSnapshot((prev) => reduceThreadSnapshot(prev, event));
  }
  if (isComputerStatusEvent(event)) {
    setComputer((prev) => reduceComputerStatus(prev, event));
  }
}

function latestAnswerableAskMessageId(snapshot: ThreadSnapshot | null): string | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      return message.id;
    }
  }
  return null;
}

const MessageView = memo(function MessageView({
  botId,
  canAnswer,
  message,
  onAnswer,
  onOpenBot,
  onRefresh,
  onAddRoutine,
  voiceReady,
  speaking,
  onSpeak,
}: {
  botId: string;
  canAnswer: boolean;
  message: ThreadMessage;
  onAnswer: (message: ThreadMessage, text: string) => Promise<void>;
  onOpenBot: (botId: string) => void;
  onRefresh: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speaking: boolean;
  onSpeak: () => void;
}) {
  return (
    <>
      {message.blocks.map((block, i) => {
        if (block.kind === "meta") {
          return (
            <div
              key={i}
              className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-[#85858A]"
            >
              <span className="text-[#E65707]">◷</span>
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.kind === "progress") {
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                <ChatMarkdown streaming>{block.text}</ChatMarkdown>
              </div>
            </div>
          );
        }
        if (block.kind === "subagent") {
          const running = block.status === "running";
          const failed = block.status === "failed";
          return (
            <div
              key={i}
              className="w-[min(420px,90%)] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium text-[#ECECEE]">{block.name}</span>
                <span
                  className="rounded-full px-[11px] py-1 text-[13px]"
                  style={{
                    background: failed
                      ? "rgba(230,87,7,.14)"
                      : running
                        ? "rgba(245,160,60,.14)"
                        : "rgba(48,162,75,.14)",
                    color: failed ? "#E65707" : running ? "#F5A03C" : "#4ECB71",
                    animation: running ? "rkPulse 1.2s ease-in-out infinite" : undefined,
                  }}
                >
                  {running
                    ? `하위 에이전트 · ${koreanStatusLabel(block.status)}`
                    : koreanStatusLabel(block.status)}
                </span>
              </div>
              <div className="mt-2 text-[13.5px] text-[#85858A]">{block.task}</div>
              {block.progress || block.result ? (
                <div className="mt-2.5 text-[14.5px] leading-[1.5] text-[#A8A8AD]">
                  <ChatMarkdown streaming={running}>
                    {block.result || block.progress || ""}
                  </ChatMarkdown>
                </div>
              ) : null}
            </div>
          );
        }
        if (block.kind === "child_bot") {
          const removed = block.status === "deleted" || block.status === "archived";
          return (
            <button
              key={i}
              type="button"
              disabled={removed}
              onClick={() => onOpenBot(block.botId)}
              className="w-[min(340px,90%)] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4 text-left disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-[#ECECEE]">{block.name}</span>
                <span
                  className="rounded-full px-[11px] py-1 text-[13px]"
                  style={{
                    background: removed ? "rgba(230,87,7,.14)" : "rgba(48,162,75,.14)",
                    color: removed ? "#E65707" : "#4ECB71",
                  }}
                >
                  {block.status === "archived"
                    ? "보관됨"
                    : block.status === "deleted"
                      ? "삭제됨"
                      : "봇"}
                </span>
              </div>
              <div className="mt-2 text-[14.5px] leading-[1.5] text-[#A8A8AD]">
                {removed
                  ? block.status === "archived"
                    ? "이 봇을 보관했습니다. 대화, 메모리, 파일은 유지됩니다."
                    : "이 봇과 대화, 브라우저, 메모리를 삭제했습니다."
                  : block.title || "별도 대화를 열었습니다. 눌러서 전환하세요."}
              </div>
            </button>
          );
        }
        if (block.kind === "image") {
          return (
            <div
              key={i}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <ArtifactImage botId={botId} artifactId={block.artifactId} name={block.name} />
            </div>
          );
        }
        if (block.kind === "file") {
          return (
            <div
              key={i}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <button
                type="button"
                onClick={() =>
                  void openArtifact(botId, block.artifactId, block.name, block.mimeType)
                }
                className="rounded-[20px] border border-[#26262A] bg-[#17171A] px-4 py-3 text-left text-[14px] text-[#DFDFE2] hover:bg-[#1F1F22]"
              >
                <div className="font-medium">{block.name}</div>
                <div className="mt-1 text-[#85858A]">
                  {block.mimeType} · {formatBytes(block.size)}
                </div>
              </button>
            </div>
          );
        }
        if (block.kind === "text" && message.role === "user") {
          const optimistic = message.id.startsWith("optimistic:");
          return (
            <div key={i} className="flex justify-end">
              <div
                className={`max-w-[70%] rounded-[20px] bg-[#F1F1EF] px-[18px] py-3 text-[15.5px] leading-[1.45] text-[#1A1A1A] ${optimistic ? "opacity-75" : ""}`}
              >
                <div>{block.text}</div>
                {optimistic ? (
                  <div className="mt-1 text-right text-[11px] text-[#6C6C70]">전송 중…</div>
                ) : null}
              </div>
            </div>
          );
        }
        if (block.kind === "text") {
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                <ChatMarkdown>{block.text}</ChatMarkdown>
                {voiceReady ? (
                  <button
                    type="button"
                    aria-label={speaking ? "읽기 중지" : "답변 읽기"}
                    onClick={onSpeak}
                    className="mt-2 text-[12px] text-[#85858A] hover:text-[#ECECEE]"
                  >
                    {speaking ? "중지" : "읽기"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        }
        if (block.kind === "card") {
          return (
            <div key={i} className="flex justify-start">
              <div className="flex flex-col gap-2 rounded-[20px] bg-[#1A1A1D] px-5 py-4">
                {block.lines.map((line) => (
                  <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                    <span className="text-[#30A24B]">✓</span>
                    <span className="font-semibold text-white">{line.k}</span>
                    <span className="text-[#85858A]">→</span>
                    <span>{line.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (block.kind === "ask") {
          return (
            <AskCard
              key={i}
              block={block}
              canAnswer={canAnswer}
              onAnswer={(text) => onAnswer(message, text)}
            />
          );
        }
        if (block.kind === "skill_draft") {
          return (
            <div key={i} className="flex justify-start">
              <SkillDraftCard block={block} onRefresh={onRefresh} onAddRoutine={onAddRoutine} />
            </div>
          );
        }
        if (block.kind === "computer") {
          return (
            <div
              key={i}
              className="w-[340px] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-[#ECECEE]">브라우저</span>
                <span className="rounded-full bg-[rgba(48,162,75,.14)] px-[11px] py-1 text-[13px] text-[#4ECB71]">
                  {koreanStatusLabel(block.state)}
                </span>
              </div>
              <div className="my-2.5 text-[14.5px] leading-[1.5] text-[#A8A8AD]">
                <ChatMarkdown>{block.text}</ChatMarkdown>
              </div>
            </div>
          );
        }
        return null;
      })}
    </>
  );
});

type AskBlock = Extract<ThreadMessage["blocks"][number], { kind: "ask" }>;

function AskCard({
  block,
  canAnswer,
  onAnswer,
}: {
  block: AskBlock;
  canAnswer: boolean;
  onAnswer: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitAnswer(value: string) {
    const text = value.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(text);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[74%] rounded-[20px] border border-[#242428] bg-[#141417] px-5 py-[17px]">
      <div className="text-[15.5px] leading-[1.5] text-[#ECECEE]">
        <ChatMarkdown>{block.text}</ChatMarkdown>
      </div>
      {block.detail ? (
        <pre className="mt-3 rounded-xl bg-[#0E0E10] px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] text-[#85858A]">
          {block.detail}
        </pre>
      ) : null}
      {block.status === "answered" ? (
        <div className="mt-3.5 text-[13.5px] font-medium text-[#4ECB71]">
          {block.answer ? `답변 완료: ${block.answer}` : "답변 완료"}
        </div>
      ) : !canAnswer ? (
        <div className="mt-3.5 text-[13.5px] font-medium text-[#85858A]">더 이상 유효하지 않음</div>
      ) : editing ? (
        <form
          className="mt-3.5 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnswer(answer);
          }}
        >
          <input
            aria-label="답변"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="답변 입력"
            className="rounded-[11px] border border-[#303035] bg-[#0E0E10] px-3.5 py-2.5 text-[14.5px] text-[#ECECEE] outline-none focus:border-[#66666D]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!answer.trim() || submitting}
              className="rounded-[11px] bg-[#F1F1EF] px-[17px] py-2 text-[14.5px] font-medium text-[#17171A] disabled:opacity-50"
            >
              {submitting ? "전송 중…" : "답변 전송"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setAnswer("");
                setEditing(false);
              }}
              className="rounded-[11px] border border-[#26262A] px-[17px] py-2 text-[14.5px] text-[#C9C9CE] disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submitAnswer("approved")}
            className="rounded-[11px] bg-[#F1F1EF] px-[17px] py-2 text-[14.5px] font-medium text-[#17171A] disabled:opacity-50"
          >
            {submitting ? "전송 중…" : "승인"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setEditing(true)}
            className="rounded-[11px] border border-[#26262A] px-[17px] py-2 text-[14.5px] text-[#C9C9CE] disabled:opacity-50"
          >
            수정 후 전송
          </button>
        </div>
      )}
    </div>
  );
}

function ComputerModePicker({
  value,
  onChange,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
}) {
  return (
    <div className="mt-4">
      <div className="text-[14px] text-[#85858A]">브라우저 로그인</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["team", "dedicated"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={`rounded-[11px] border px-3.5 py-3 text-[14px] capitalize ${
              value === mode
                ? "border-[#6C6C70] bg-[#1A1A1D] text-[#ECECEE]"
                : "border-[#26262A] text-[#85858A]"
            }`}
          >
            {mode === "team" ? "공유" : "봇 전용"}
          </button>
        ))}
      </div>
      <div className="mt-2 text-[12.5px] leading-5 text-[#6C6C70]">
        {value === "team"
          ? "이 워크스페이스의 모든 봇이 같은 브라우저 로그인 상태를 공유합니다."
          : "이 봇만 사용하는 별도의 브라우저 로그인 상태를 유지합니다."}
      </div>
    </div>
  );
}

function CreateBotForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    name: string;
    title: string;
    description: string;
    computerMode: ComputerMode;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [computerMode, setComputerMode] = useState<ComputerMode>("team");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-[#85858A]">새 봇</span>
        <button type="button" onClick={onCancel}>
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
      <label className="mt-6 block text-[14px] text-[#85858A]">
        이름
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="봇 이름"
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        역할
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="이 봇이 하는 일을 짧게 설명하세요"
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        상세 지시
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="봇의 목적과 수행 방식을 설명하세요"
          rows={4}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <ComputerModePicker value={computerMode} onChange={setComputerMode} />
      <button
        type="button"
        disabled={!name.trim()}
        onClick={() => onCreate({ name, title, description, computerMode })}
        className="mt-5 rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A] disabled:opacity-40"
      >
        만들기
      </button>
    </div>
  );
}

function BotSettings({
  bot,
  onSave,
  onExport,
  onClear,
}: {
  bot: Bot;
  onSave: (patch: {
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
    computerMode: ComputerMode;
    autoSpeak?: boolean;
    voiceId?: string | null;
  }) => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
}) {
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const [description, setDescription] = useState(bot.description);
  const [computerMode, setComputerMode] = useState(bot.computerMode);
  const [autoSpeak, setAutoSpeak] = useState(bot.autoSpeak);
  const [voiceId, setVoiceId] = useState(bot.voiceId ?? "");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc.voice
      .voices({})
      .then(setVoices)
      .catch(() => setVoices([]));
  }, []);

  return (
    <div data-testid="bot-settings">
      <div className="flex justify-center">
        <BotAvatar color={bot.color} size={64} />
      </div>
      <label className="mt-6 block text-[14px] text-[#85858A]">
        이름
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        역할
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        상세 지시
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <ComputerModePicker value={computerMode} onChange={setComputerMode} />
      <label className="mt-5 flex cursor-pointer items-center gap-3 text-[14px] text-[#C9C9CE]">
        <input
          type="checkbox"
          checked={autoSpeak}
          onChange={(event) => setAutoSpeak(event.target.checked)}
        />
        답변을 음성으로 읽기
      </label>
      {voices.length ? (
        <label className="mt-4 block text-[14px] text-[#85858A]">
          음성
          <select
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
          >
            <option value="">계정 기본값</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-[#E65707]">{error}</p> : null}
      <div className="mt-5 flex flex-col items-start gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setError(null);
            void onSave({
              name,
              title,
              description,
              instructions: description,
              computerMode,
              autoSpeak,
              voiceId: voiceId || null,
            })
              .catch((err) => setError(err instanceof Error ? err.message : "저장하지 못했습니다."))
              .finally(() => setSaving(false));
          }}
          className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A] disabled:opacity-40"
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          className="text-[14px] text-[#85858A]"
        >
          내보내기
        </button>
        <button type="button" onClick={onClear} className="text-[14px] text-[#E65707]">
          대화 내용 지우기
        </button>
      </div>
    </div>
  );
}

function NewBotSectionDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);

  return (
    <div
      role="presentation"
      className="absolute inset-0 z-50 grid place-items-center bg-[rgba(4,4,5,.76)] px-5"
      onPointerDown={() => {
        if (!saving) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-bot-section-title"
        className="w-full max-w-[420px] rounded-[18px] border border-[#343438] bg-[#1A1A1D] p-5 shadow-[0_24px_70px_rgba(0,0,0,.65)]"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || saving) return;
          setSaving(true);
          setError(null);
          void onConfirm(trimmed).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "구역을 만들지 못했습니다.");
            setSaving(false);
          });
        }}
      >
        <h2 id="new-bot-section-title" className="text-[17px] font-medium text-[#F1F1F2]">
          새 구역
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-[#9A9AA0]">
          구역을 만들고 {bot.name} 봇을 이곳으로 이동합니다.
        </p>
        <label className="mt-4 block text-[13.5px] text-[#C9C9CE]">
          이름
          <input
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-[11px] border border-[#343438] bg-[#101012] px-3.5 py-2.5 text-[14.5px] text-[#ECECEE] outline-none focus:border-[#66666D]"
          />
        </label>
        {error ? <p className="mt-3 text-[13.5px] text-[#FF5364]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-[10px] px-3.5 py-2 text-[14px] text-[#C9C9CE] hover:bg-[#29292D] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-[10px] bg-[#F1F1EF] px-3.5 py-2 text-[14px] font-medium text-[#17171A] disabled:opacity-40"
          >
            {saving ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ClearConversationDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !clearing) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearing, onCancel]);

  return (
    <div
      role="presentation"
      className="absolute inset-0 z-50 grid place-items-center bg-[rgba(4,4,5,.76)] px-5"
      onPointerDown={() => {
        if (!clearing) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-conversation-title"
        aria-describedby="clear-conversation-description"
        className="w-full max-w-[420px] rounded-[18px] border border-[#343438] bg-[#1A1A1D] p-5 shadow-[0_24px_70px_rgba(0,0,0,.65)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="clear-conversation-title" className="text-[17px] font-medium text-[#F1F1F2]">
          {bot.name}의 대화를 지울까요?
        </h2>
        <p
          id="clear-conversation-description"
          className="mt-2 text-[14px] leading-6 text-[#9A9AA0]"
        >
          모든 메시지를 영구 삭제하고 현재 작업을 중지합니다. 봇, 브라우저 로그인 상태, 메모리와
          자동 작업은 유지됩니다.
        </p>
        {error ? <p className="mt-3 text-[13.5px] text-[#FF5364]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={clearing}
            onClick={onCancel}
            className="rounded-[10px] px-3.5 py-2 text-[14px] text-[#C9C9CE] hover:bg-[#29292D] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={clearing}
            onClick={() => {
              setClearing(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "대화를 지우지 못했습니다.");
                setClearing(false);
              });
            }}
            className="rounded-[10px] bg-[#FF5364] px-3.5 py-2 text-[14px] font-medium text-white disabled:opacity-40"
          >
            {clearing ? "지우는 중…" : "대화 지우기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteBotDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: (deleteMemories: boolean) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel]);

  return (
    <div
      role="presentation"
      className="absolute inset-0 z-50 grid place-items-center bg-[rgba(4,4,5,.76)] px-5"
      onPointerDown={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-bot-title"
        aria-describedby="delete-bot-description"
        className="w-full max-w-[420px] rounded-[18px] border border-[#343438] bg-[#1A1A1D] p-5 shadow-[0_24px_70px_rgba(0,0,0,.65)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="delete-bot-title" className="text-[17px] font-medium text-[#F1F1F2]">
          {bot.name} 봇을 삭제할까요?
        </h2>
        <p id="delete-bot-description" className="mt-2 text-[14px] leading-6 text-[#9A9AA0]">
          이 봇의 대화, 파일, 자동 작업이 영구 삭제됩니다. 이 봇이 만든 다른 봇은 목록에 유지됩니다.
        </p>
        <fieldset className="mt-4 space-y-2">
          <legend className="mb-2 text-[13.5px] text-[#C9C9CE]">메모리는 어떻게 할까요?</legend>
          <label className="flex cursor-pointer gap-3 rounded-[11px] border border-[#343438] p-3">
            <input
              type="radio"
              name="delete-memory"
              checked={!deleteMemories}
              onChange={() => setDeleteMemories(false)}
            />
            <span>
              <span className="block text-[14px] text-[#ECECEE]">메모리 유지</span>
              <span className="mt-0.5 block text-[12.5px] text-[#85858A]">
                공유 메모리로 이동합니다.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-[11px] border border-[#343438] p-3">
            <input
              type="radio"
              name="delete-memory"
              checked={deleteMemories}
              onChange={() => setDeleteMemories(true)}
            />
            <span>
              <span className="block text-[14px] text-[#ECECEE]">메모리도 삭제</span>
              <span className="mt-0.5 block text-[12.5px] text-[#85858A]">
                삭제 후에는 복구할 수 없습니다.
              </span>
            </span>
          </label>
        </fieldset>
        {error ? <p className="mt-3 text-[13.5px] text-[#FF5364]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="rounded-[10px] px-3.5 py-2 text-[14px] text-[#C9C9CE] hover:bg-[#29292D] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm(deleteMemories).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "봇을 삭제하지 못했습니다.");
                setDeleting(false);
              });
            }}
            className="rounded-[10px] bg-[#FF5364] px-3.5 py-2 text-[14px] font-medium text-white disabled:opacity-40"
          >
            {deleting ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteRoutineDialog({
  routine,
  onCancel,
  onConfirm,
}: {
  routine: Routine;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel]);

  return (
    <div
      role="presentation"
      className="absolute inset-0 z-50 grid place-items-center bg-[rgba(4,4,5,.76)] px-5"
      onPointerDown={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-routine-title"
        aria-describedby="delete-routine-description"
        className="w-full max-w-[420px] rounded-[18px] border border-[#343438] bg-[#1A1A1D] p-5 shadow-[0_24px_70px_rgba(0,0,0,.65)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="delete-routine-title" className="text-[17px] font-medium text-[#F1F1F2]">
          {routine.name} 자동 작업을 삭제할까요?
        </h2>
        <p id="delete-routine-description" className="mt-2 text-[14px] leading-6 text-[#9A9AA0]">
          삭제 후에는 복구할 수 없습니다.
        </p>
        {error ? <p className="mt-3 text-[13.5px] text-[#FF5364]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="rounded-[10px] px-3.5 py-2 text-[14px] text-[#C9C9CE] hover:bg-[#29292D] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "자동 작업을 삭제하지 못했습니다.");
                setDeleting(false);
              });
            }}
            className="rounded-[10px] bg-[#FF5364] px-3.5 py-2 text-[14px] font-medium text-white disabled:opacity-40"
          >
            {deleting ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

function embeddableScreenUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    const page = new URL(window.location.href);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function computerPlaceholder(
  state: ComputerStatus["state"] | undefined,
  booting: boolean,
  label: string,
) {
  if (state === "booting" || booting) return "원격 브라우저를 시작하는 중…";
  if (state === "running") return label;
  if (state === "suspended") return SUSPENDED_COMPUTER_MESSAGE;
  if (state === "error") return "브라우저를 시작하지 못했습니다.";
  return "브라우저가 종료되었습니다.";
}

function computerLabel(mode: ComputerStatus["mode"] | undefined, botName: string) {
  return mode === "dedicated" ? `${botName} 전용 브라우저` : "공유 브라우저";
}

function ArtifactImage({
  botId,
  artifactId,
  name,
}: {
  botId: string;
  artifactId: string;
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    void rpc.artifacts
      .get({ botId, artifactId })
      .then((artifact) => {
        const bytes = decodeArtifactBase64(artifact.contentBase64);
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: artifact.mimeType }),
        );
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setSrc(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, botId, visible]);

  return (
    <div ref={container}>
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="max-w-[240px] overflow-hidden rounded-[20px]"
        >
          <img src={src} alt={name} className="max-h-48 w-full object-cover" />
        </button>
      ) : (
        <div className="rounded-[20px] border border-[#26262A] bg-[#17171A] px-4 py-3 text-[14px] text-[#85858A]">
          {name}
        </div>
      )}
      {open && src ? (
        <button
          type="button"
          aria-label="이미지 미리보기 닫기"
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(4,4,5,.82)] p-6"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={name}
            className="max-h-[85vh] max-w-[90vw] rounded-[12px] object-contain"
          />
        </button>
      ) : null}
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? (result.split(",")[1] ?? "") : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
