import { Trans, useLingui } from "@lingui/react/macro";
import type { CapabilityInstall, ConnectionCatalogItem } from "@rakazo/contracts";
import {
  abortableDelay,
  buildFeaturedConnectorTiles,
  EMPTY_PLUGIN_CATALOG_MESSAGE,
  matchFeaturedConnectorId,
} from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

type SourceKind = "treg" | "mcp" | "api";

function itemKey(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
  return `${item.connectorId}:${item.slug}`;
}

function byName(left: ConnectionCatalogItem, right: ConnectionCatalogItem) {
  return left.name.localeCompare(right.name);
}

function markConnected(
  items: ConnectionCatalogItem[],
  connectorId: string,
  slug: string,
  connected: boolean,
) {
  return items.map((entry) =>
    entry.connectorId === connectorId && entry.slug === slug ? { ...entry, connected } : entry,
  );
}

function CatalogRow({
  name,
  logo,
  connected,
  pending,
  disabledNote,
  onToggle,
}: {
  name: string;
  logo: string | null;
  connected: boolean;
  pending: boolean;
  disabledNote?: string;
  onToggle?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[13px] px-2.5 py-2">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-9 w-9 shrink-0 rounded-xl bg-[#2C2C30] object-contain"
        />
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#2C2C30] text-sm font-semibold text-[#ECECEE]">
          {name[0]}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-[#ECECEE]">{name}</div>
        {disabledNote ? (
          <div className="truncate text-[12.5px] text-[#707077]">{disabledNote}</div>
        ) : null}
      </div>
      {onToggle ? (
        <Button type="button" variant="pill" size="sm" disabled={pending} onClick={onToggle}>
          {pending ? (
            connected ? (
              <Trans>Removing…</Trans>
            ) : (
              <Trans>Adding…</Trans>
            )
          ) : connected ? (
            <Trans>Remove</Trans>
          ) : (
            <Trans>Add</Trans>
          )}
        </Button>
      ) : null}
    </div>
  );
}

export function PluginsOverlay({
  onClose,
  onOpenMcp,
  activeBotId,
}: {
  onClose: () => void;
  onOpenMcp?: () => void;
  activeBotId?: string;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">("bearer");
  const [authName, setAuthName] = useState("x-api-key");
  const [pending, setPending] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllApps, setShowAllApps] = useState(false);
  const connectionAttempt = useRef<AbortController | null>(null);

  async function refresh() {
    const [items, installs] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.capabilities.list(),
    ]);
    setCatalog(items);
    setSources(installs.filter((install) => install.kind === "mcp" || install.kind === "api"));
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setCatalogError(err instanceof Error ? err.message : t`Could not load integrations`),
      )
      .finally(() => setLoading(false));
    return () => connectionAttempt.current?.abort();
  }, []);

  const queryText = query.trim();
  const searching = queryText.length > 0;
  const showFeatured = !searching;

  const featuredTiles = useMemo(() => buildFeaturedConnectorTiles(catalog), [catalog]);

  const connectedItems = useMemo(
    () => catalog.filter((item) => item.connected).sort(byName),
    [catalog],
  );

  const popularTiles = useMemo(
    () =>
      featuredTiles.filter(
        (tile) => tile.item !== undefined && !tile.missing && !tile.item.connected,
      ),
    [featuredTiles],
  );

  const searchResults = useMemo(() => {
    const needle = queryText.toLowerCase();
    if (!needle) return [];
    return catalog
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.slug.toLowerCase().includes(needle) ||
          item.connectorId.toLowerCase().includes(needle),
      )
      .sort(byName);
  }, [catalog, queryText]);

  const moreApps = useMemo(() => {
    if (!showFeatured) return [];
    const popularKeys = new Set(
      popularTiles.flatMap((tile) => (tile.item ? [itemKey(tile.item)] : [])),
    );
    return catalog
      .filter(
        (item) =>
          !item.connected &&
          !popularKeys.has(itemKey(item)) &&
          matchFeaturedConnectorId(item.slug) === null &&
          matchFeaturedConnectorId(item.name) === null,
      )
      .sort(byName);
  }, [catalog, popularTiles, showFeatured]);

  async function notifyAppConnected(item: ConnectionCatalogItem) {
    if (!activeBotId) return;
    await rpc.onboarding
      .appConnected({ botId: activeBotId, provider: item.slug })
      .catch(() => undefined);
  }

  function setItemConnected(item: ConnectionCatalogItem, connected: boolean) {
    setCatalog((prev) => markConnected(prev, item.connectorId, item.slug, connected));
  }

  async function connect(item: ConnectionCatalogItem) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName: item.name,
      });
      if (started.authorizationUrl)
        window.open(started.authorizationUrl, "_blank", "noopener,noreferrer");
      if (item.noAuth && !started.authorizationUrl) {
        if (controller.signal.aborted) return;
        setItemConnected(item, true);
        void notifyAppConnected(item);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          setItemConnected(item, true);
          void notifyAppConnected(item);
          return;
        }
        await abortableDelay(2_000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setCatalogError(
        t`Connection to ${item.name} is still pending. You can close this and check again.`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setCatalogError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
      }
    }
  }

  async function revoke(item: ConnectionCatalogItem) {
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const rows = await rpc.connections.list();
      const matches = rows.filter(
        (entry) => entry.connectorId === item.connectorId && entry.provider === item.slug,
      );
      const row =
        matches.find((entry) => entry.status === "connected") ??
        matches.find((entry) => entry.status === "pending") ??
        matches.find((entry) => entry.status === "error");
      if (!row) throw new Error(t`No connection record found for ${item.name}.`);
      await rpc.connections.revoke({ connectionId: row.id });
      setItemConnected(item, false);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  function beginSource(kind: SourceKind) {
    setSourceKind(kind);
    setSourceError(null);
    setSourceName(kind === "treg" ? "Treg" : "");
    setSourceUrl(kind === "treg" ? "https://treg.to/mcp/" : "");
    setCredential("");
    setAuthType(kind === "treg" ? "bearer" : "none");
    setAuthName("x-api-key");
  }

  async function installSource() {
    if (!sourceKind) return;
    setSourceError(null);
    setPending("install-source");
    try {
      const auth = {
        type: authType,
        ...(authType === "header" ? { name: authName.trim() } : {}),
      };
      await rpc.capabilities.install({
        kind: sourceKind === "api" ? "api" : "mcp",
        name: sourceName.trim() || (sourceKind === "treg" ? "Treg" : "Custom connector"),
        source: sourceUrl.trim(),
        credential: credential.trim() || undefined,
        config:
          sourceKind === "treg"
            ? { preset: "treg", auth: { type: "bearer" } }
            : sourceKind === "api"
              ? { openApi: true, auth }
              : { preset: "custom", auth },
      });
      setCredential("");
      setSourceKind(null);
      await refresh();
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not install connector`);
    } finally {
      setPending(null);
    }
  }

  async function removeSource(install: CapabilityInstall) {
    setPending(install.id);
    setSourceError(null);
    try {
      await rpc.capabilities.remove({ id: install.id });
      setSources((current) => current.filter((source) => source.id !== install.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-4 md:p-10">
      <div className="flex h-[min(760px,100%)] w-[1080px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#232326] bg-[#141416] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-start justify-between px-6 pt-6 md:px-8 md:pt-7">
          <div className="text-2xl font-medium text-[#F1F1F2]">
            <Trans>Integrations</Trans>
          </div>
          <button
            type="button"
            aria-label={t`Close integrations`}
            onClick={onClose}
            className="text-[#85858A]"
          >
            ✕
          </button>
        </div>

        <div className="px-6 pt-4 md:px-8">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t`Search apps`}
            placeholder={t`Search apps`}
            className="w-full rounded-[13px] border border-[#26262A] bg-[#101012] px-4 py-3 text-[15px] text-[#ECECEE] outline-none"
          />
        </div>

        <div id="integration-list" className="rk-scroll flex-1 overflow-y-auto px-6 py-6 md:px-8">
          {catalogError ? <p className="mb-4 text-sm text-[#C94244]">{catalogError}</p> : null}
          {loading ? (
            <p className="text-[#6C6C70]">
              <Trans>Loading integrations…</Trans>
            </p>
          ) : null}

          {!loading && catalog.length === 0 ? (
            <p className="text-[13.5px] leading-6 text-[#6C6C70]">{EMPTY_PLUGIN_CATALOG_MESSAGE}</p>
          ) : null}

          {showFeatured && catalog.length > 0 ? (
            <div data-testid="featured-connectors" className="mb-2">
              {connectedItems.length > 0 ? (
                <div className="mb-4">
                  <div className="mb-2 text-[12px] font-medium tracking-[0.08em] text-[#707077] uppercase">
                    <Trans>Connected</Trans>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {connectedItems.map((item) => (
                      <CatalogRow
                        key={itemKey(item)}
                        name={item.name}
                        logo={item.logo}
                        connected
                        pending={pending === itemKey(item)}
                        onToggle={() => void revoke(item)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {popularTiles.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {popularTiles.map((tile) => {
                    const item = tile.item;
                    if (!item) return null;
                    return (
                      <CatalogRow
                        key={itemKey(item)}
                        name={tile.label}
                        logo={item.logo}
                        connected={false}
                        pending={pending === itemKey(item)}
                        onToggle={() => void connect(item)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {searching && searchResults.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {searchResults.map((item) => (
                <CatalogRow
                  key={itemKey(item)}
                  name={item.name}
                  logo={item.logo}
                  connected={item.connected}
                  pending={pending === itemKey(item)}
                  onToggle={() => void (item.connected ? revoke(item) : connect(item))}
                />
              ))}
            </div>
          ) : null}
          {searching && !loading && catalog.length > 0 && searchResults.length === 0 ? (
            <p className="text-[#6C6C70]">
              <Trans>No apps match your search.</Trans>
            </p>
          ) : null}

          {!loading && catalog.length > 0 ? (
            <div data-testid="custom-connectors" className="mt-6 border-t border-[#232326] pt-5">
              <div className="text-sm font-medium text-[#A8A8AD]">
                <Trans>Custom connectors</Trans>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {onOpenMcp ? (
                  <button
                    type="button"
                    onClick={onOpenMcp}
                    className="rounded-full border border-[#383844] px-3 py-1.5 text-xs text-[#C9C9CE] hover:bg-[#232327]"
                  >
                    <Trans>MCP servers</Trans>
                  </button>
                ) : null}
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("mcp")}>
                  <Trans>Add MCP server</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("api")}>
                  <Trans>Add OpenAPI</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("treg")}>
                  <Trans>Add Treg</Trans>
                </Button>
              </div>

              {sourceError ? <p className="mt-3 text-sm text-[#C94244]">{sourceError}</p> : null}

              {sourceKind ? (
                <div className="mt-3 space-y-3 rounded-[16px] border border-[#2C2C30] bg-[#101012] p-5">
                  <div className="text-base font-medium text-[#ECECEE]">
                    {sourceKind === "treg" ? (
                      <Trans>Connect Treg</Trans>
                    ) : sourceKind === "mcp" ? (
                      <Trans>Add remote MCP server</Trans>
                    ) : (
                      <Trans>Import OpenAPI JSON</Trans>
                    )}
                  </div>
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder={t`Display name`}
                    className="w-full rounded-xl border border-[#2C2C30] bg-[#171719] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
                  />
                  {sourceKind !== "treg" ? (
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder={
                        sourceKind === "mcp"
                          ? "https://example.com/mcp"
                          : "https://example.com/openapi.json"
                      }
                      className="w-full rounded-xl border border-[#2C2C30] bg-[#171719] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
                    />
                  ) : null}
                  {sourceKind !== "treg" ? (
                    <select
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value as typeof authType)}
                      className="w-full rounded-xl border border-[#2C2C30] bg-[#171719] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
                    >
                      <option value="none">
                        <Trans>No authentication</Trans>
                      </option>
                      <option value="bearer">
                        <Trans>Bearer token</Trans>
                      </option>
                      <option value="header">
                        <Trans>API key header</Trans>
                      </option>
                    </select>
                  ) : null}
                  {authType === "header" && sourceKind !== "treg" ? (
                    <input
                      value={authName}
                      onChange={(event) => setAuthName(event.target.value)}
                      placeholder={t`Header name`}
                      className="w-full rounded-xl border border-[#2C2C30] bg-[#171719] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
                    />
                  ) : null}
                  {sourceKind === "treg" || authType !== "none" ? (
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={sourceKind === "treg" ? t`Treg token` : t`Credential`}
                      className="w-full rounded-xl border border-[#2C2C30] bg-[#171719] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
                    />
                  ) : null}
                  <p className="text-xs leading-5 text-[#707077]">
                    <Trans>
                      Rakazo verifies the source before saving it. Credentials are encrypted and are
                      never returned to clients or exposed to the model.
                    </Trans>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === "install-source"}
                      onClick={() => void installSource()}
                    >
                      {pending === "install-source" ? (
                        <Trans>Verifying…</Trans>
                      ) : (
                        <Trans>Verify and add</Trans>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      onClick={() => setSourceKind(null)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-5">
                <div className="mb-3 text-sm font-medium text-[#A8A8AD]">
                  <Trans>Tool sources</Trans>
                </div>
                {sources.length === 0 && !sourceKind ? (
                  <p className="text-[#6C6C70]">
                    <Trans>No MCP or API tool sources installed yet.</Trans>
                  </p>
                ) : null}
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center gap-4 rounded-[13px] px-3 py-2.5"
                  >
                    <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#2C2C30] font-semibold uppercase text-[#ECECEE]">
                      {source.kind === "mcp" ? "M" : "A"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15.5px] font-medium text-[#ECECEE]">{source.name}</div>
                      <div className="truncate text-[13.5px] text-[#7A7A80]">
                        {source.kind.toUpperCase()} · {source.source} ·{" "}
                        {source.secretConfigured ? (
                          <Trans>credential saved</Trans>
                        ) : (
                          <Trans>no auth</Trans>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === source.id}
                      onClick={() => void removeSource(source)}
                    >
                      {pending === source.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showFeatured && moreApps.length > 0 ? (
            <div className="mt-5">
              <button
                type="button"
                data-testid="show-more-apps"
                onClick={() => setShowAllApps((open) => !open)}
                className="w-full rounded-[13px] border border-[#2C2C30] px-4 py-2.5 text-[14px] text-[#9A9AA0] hover:bg-[#1C1C1F]"
              >
                {showAllApps ? <Trans>Show fewer apps</Trans> : <Trans>Show more apps</Trans>}
              </button>
              {showAllApps ? (
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {moreApps.map((item) => (
                    <CatalogRow
                      key={itemKey(item)}
                      name={item.name}
                      logo={item.logo}
                      connected={item.connected}
                      pending={pending === itemKey(item)}
                      onToggle={() => void (item.connected ? revoke(item) : connect(item))}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
