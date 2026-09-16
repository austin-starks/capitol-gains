import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { SCENE_FRAMES } from "./Root";
import { theme } from "./theme";

/**
 * Six scenes, one per pattern the pipeline exercises. Each scene states the pattern and the
 * failure it prevents, because the failure is the reason the pattern exists.
 */
const SCENES = [
  { title: "Shard by identity", subtitle: "a stable hash, never a position" },
  { title: "Receipts, keyed by identity", subtitle: "so a round resumes — and re-shards" },
  { title: "Single-flight lease", subtitle: "pay once, and never fence forever" },
  { title: "Two reads, then a reconcile", subtitle: "no value comes from OCR text alone" },
  { title: "Batch size is observability", subtitle: "keep the batching, shrink the batch" },
  { title: "Reduce", subtitle: "read every receipt, publish each year once" },
] as const;

const Panel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: theme.panel,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      padding: "14px 18px",
      color: theme.text,
      fontFamily: theme.mono,
      fontSize: 22,
      ...style,
    }}
  >
    {children}
  </div>
);

const Caption: React.FC<{ scene: number; frame: number }> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const local = frame - scene * SCENE_FRAMES;
  const rise = spring({ frame: local, fps, config: { damping: 200 } });
  const entry = SCENES[scene];
  if (!entry) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 70,
        opacity: rise,
        transform: `translateY(${interpolate(rise, [0, 1], [18, 0])}px)`,
      }}
    >
      <div style={{ fontFamily: theme.sans, fontSize: 52, fontWeight: 700, color: theme.text }}>
        {entry.title}
      </div>
      <div style={{ fontFamily: theme.sans, fontSize: 26, color: theme.muted, marginTop: 8 }}>
        {entry.subtitle}
      </div>
    </div>
  );
};

/** Sixteen shards claiming disjoint slices of one work list. */
const ShardScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const shards = 16;
  return (
    <div style={{ position: "absolute", left: 80, top: 260, display: "flex", gap: 10 }}>
      {Array.from({ length: shards }, (_, index) => {
        const appear = spring({ frame: local - index * 3, fps, config: { damping: 200 } });
        return (
          <div
            key={index}
            style={{
              width: 78,
              height: 190,
              borderRadius: 8,
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              opacity: appear,
              transform: `translateY(${interpolate(appear, [0, 1], [30, 0])}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: 12,
              color: theme.muted,
              fontFamily: theme.mono,
              fontSize: 15,
            }}
          >
            <div
              style={{
                width: 46,
                height: interpolate(appear, [0, 1], [0, 110]),
                background: theme.accent,
                opacity: 0.55,
                borderRadius: 4,
                marginBottom: 10,
              }}
            />
            {index}/16
          </div>
        );
      })}
    </div>
  );
};

/** Receipts landing one per finished filing, then the shard count changing underneath them. */
const ReceiptScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const total = 48;
  const landed = Math.min(total, Math.floor(interpolate(local, [0, 90], [0, total], { extrapolateRight: "clamp" })));
  const reshard = local > 100;
  return (
    <div style={{ position: "absolute", left: 80, top: 250 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 44px)", gap: 8 }}>
        {Array.from({ length: total }, (_, index) => {
          const on = index < landed;
          const pop = spring({ frame: local - index * 2, fps, config: { damping: 200 } });
          return (
            <div
              key={index}
              style={{
                width: 44,
                height: 34,
                borderRadius: 6,
                border: `1px solid ${on ? theme.ok : theme.border}`,
                background: on ? "rgba(63,185,80,0.18)" : theme.panel,
                transform: on ? `scale(${interpolate(pop, [0, 1], [0.7, 1])})` : "scale(1)",
              }}
            />
          );
        })}
      </div>
      <Panel style={{ marginTop: 28, maxWidth: 1080, fontSize: 20, opacity: reshard ? 1 : 0.35 }}>
        {reshard
          ? "16 → 32 shards: only the unfinished work is redivided. Nothing finished is redone."
          : "one object per finished filing, keyed by chamber:docId"}
      </Panel>
    </div>
  );
};

/** One owner, the rest held — and the abandoned attempt that must be reclaimable. */
const LeaseScene: React.FC<{ local: number }> = ({ local }) => {
  const owner = local > 20;
  const died = local > 65;
  const reclaimed = local > 105;
  return (
    <div style={{ position: "absolute", left: 80, top: 250, display: "flex", gap: 22 }}>
      {["machine A", "machine B", "machine C"].map((name, index) => {
        const isOwner = index === 0;
        const border = isOwner
          ? died && !reclaimed
            ? theme.bad
            : theme.ok
          : reclaimed && index === 1
            ? theme.ok
            : theme.border;
        return (
          <Panel key={name} style={{ width: 300, borderColor: border }}>
            <div style={{ color: theme.muted, fontSize: 18 }}>{name}</div>
            <div style={{ marginTop: 10, fontSize: 20, color: theme.text }}>
              {isOwner
                ? died
                  ? reclaimed
                    ? "exited"
                    : "died mid-call"
                  : owner
                    ? "OWNER · paying"
                    : "claiming…"
                : reclaimed && index === 1
                  ? "OWNER · reclaimed"
                  : owner
                    ? "HELD · reusing"
                    : "claiming…"}
            </div>
          </Panel>
        );
      })}
      <Panel
        style={{
          width: 420,
          borderColor: reclaimed ? theme.ok : died ? theme.bad : theme.border,
          fontSize: 19,
        }}
      >
        {reclaimed
          ? "reclaimed 30 min past the lease, fence cleared"
          : died
            ? "fenced forever → 613 of 703 filings failed"
            : "fenced at dispatch: outcome unknown"}
      </Panel>
    </div>
  );
};

/** Read A, Read B, and the reconciling read that decides from the page itself. */
const ReadScene: React.FC<{ local: number }> = ({ local }) => {
  const disagree = local > 55;
  const reconciled = local > 100;
  return (
    <div style={{ position: "absolute", left: 80, top: 250 }}>
      <div style={{ display: "flex", gap: 22 }}>
        <Panel style={{ width: 380, borderColor: disagree ? theme.warn : theme.border }}>
          <div style={{ color: theme.muted, fontSize: 18 }}>Read A · OCR text alone</div>
          <div style={{ marginTop: 10, color: disagree ? theme.warn : theme.text }}>
            04/21/21 × 73 rows
          </div>
        </Panel>
        <Panel style={{ width: 380, borderColor: disagree ? theme.warn : theme.border }}>
          <div style={{ color: theme.muted, fontSize: 18 }}>Read B · filed pages alone</div>
          <div style={{ marginTop: 10, color: disagree ? theme.warn : theme.text }}>
            04/01 … 04/22
          </div>
        </Panel>
      </div>
      <Panel
        style={{
          marginTop: 26,
          width: 800,
          borderColor: reconciled ? theme.ok : theme.border,
          opacity: disagree ? 1 : 0.35,
        }}
      >
        <div style={{ color: theme.muted, fontSize: 18 }}>
          Read C · both reads, the document, and row-level crops
        </div>
        <div style={{ marginTop: 10, color: reconciled ? theme.ok : theme.text }}>
          {reconciled ? "published as printed: 04/01 … 04/22" : "deciding from the page"}
        </div>
      </Panel>
    </div>
  );
};

/** 250 per pass writes nothing for an hour; 25 checkpoints ten times as often. */
const BatchScene: React.FC<{ local: number }> = ({ local }) => {
  const progress = interpolate(local, [0, 120], [0, 1], { extrapolateRight: "clamp" });
  const rows: Array<{ label: string; size: number; color: string; writes: number }> = [
    { label: "batchSize 250", size: 250, color: theme.bad, writes: 1 },
    { label: "batchSize 25", size: 25, color: theme.ok, writes: 10 },
  ];
  return (
    <div style={{ position: "absolute", left: 80, top: 270 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ marginBottom: 46 }}>
          <div style={{ color: theme.muted, fontFamily: theme.mono, fontSize: 20, marginBottom: 10 }}>
            {row.label}
          </div>
          <div
            style={{
              position: "relative",
              width: 1200,
              height: 46,
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                background: row.color,
                opacity: 0.28,
                borderRadius: 8,
              }}
            />
            {Array.from({ length: row.writes }, (_, index) => {
              const at = (index + 1) / row.writes;
              return (
                <div
                  key={index}
                  style={{
                    position: "absolute",
                    left: `${at * 100}%`,
                    top: -6,
                    width: 3,
                    height: 58,
                    background: progress >= at ? row.color : theme.border,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
      <Panel style={{ width: 1200, fontSize: 20 }}>
        Same cost, same requests. Ten times the checkpoints, and one bad filing blocks 25 instead of 250.
      </Panel>
    </div>
  );
};

/** Every receipt of the round, published one year at a time. */
const ReduceScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const years = [2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026];
  return (
    <div style={{ position: "absolute", left: 80, top: 280, display: "flex", gap: 16 }}>
      {years.map((year, index) => {
        const done = spring({ frame: local - 12 - index * 12, fps, config: { damping: 200 } });
        return (
          <Panel
            key={year}
            style={{
              width: 170,
              borderColor: done > 0.5 ? theme.ok : theme.border,
              opacity: interpolate(done, [0, 1], [0.35, 1]),
            }}
          >
            <div style={{ fontSize: 26, color: theme.text }}>{year}</div>
            <div style={{ marginTop: 8, fontSize: 17, color: done > 0.5 ? theme.ok : theme.muted }}>
              {done > 0.5 ? "published" : "pending"}
            </div>
          </Panel>
        );
      })}
    </div>
  );
};

export const Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = Math.min(SCENES.length - 1, Math.floor(frame / SCENE_FRAMES));
  const local = frame - scene * SCENE_FRAMES;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <div
        style={{
          position: "absolute",
          right: 70,
          top: 76,
          fontFamily: theme.mono,
          fontSize: 20,
          color: theme.muted,
        }}
      >
        capitol-gains · {scene + 1}/{SCENES.length}
      </div>
      <Caption scene={scene} frame={frame} />
      {scene === 0 ? <ShardScene local={local} /> : null}
      {scene === 1 ? <ReceiptScene local={local} /> : null}
      {scene === 2 ? <LeaseScene local={local} /> : null}
      {scene === 3 ? <ReadScene local={local} /> : null}
      {scene === 4 ? <BatchScene local={local} /> : null}
      {scene === 5 ? <ReduceScene local={local} /> : null}
    </AbsoluteFill>
  );
};
