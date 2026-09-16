import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { SCENE_FRAMES } from "./Root";
import { theme } from "./theme";

/**
 * Six scenes, one per pattern the pipeline exercises. Each scene states the pattern and the
 * failure it prevents, because the failure is the reason the pattern exists.
 */
/**
 * The disclosure problem, in the order someone meets it. Infrastructure appears only where it
 * changes the data: the lease, because losing it silently fails filings.
 */
const SCENES = [
  { title: "A trade becomes a PDF", subtitle: "45 days to file, two chambers, no schema" },
  { title: "A third are photographs", subtitle: "scanned paper, not text" },
  { title: "OCR lies confidently", subtitle: "one date repeated down 73 rows, at 0.999" },
  { title: "Two reads, then a reconcile", subtitle: "no value comes from OCR text alone" },
  { title: "Encrypted, so crops come back blank", subtitle: "decrypt before copying a page" },
  { title: "Rows you can query", subtitle: "every filing, or a receipt saying why not" },
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

/** A trade, then the filing it becomes: a PDF on a government site, 45 days later. */
const FilingScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const steps = [
    { label: "a member trades", detail: "NVDA · $500,001–$1,000,000" },
    { label: "45 days to file", detail: "Periodic Transaction Report" },
    { label: "a PDF appears", detail: "House Clerk · Senate EFD" },
    { label: "no schema", detail: "two chambers, two formats" },
  ];
  return (
    <div style={{ position: "absolute", left: 80, top: 280, display: "flex", gap: 20, alignItems: "center" }}>
      {steps.map((step, index) => {
        const appear = spring({ frame: local - index * 18, fps, config: { damping: 200 } });
        return (
          <React.Fragment key={step.label}>
            {index > 0 ? (
              <div style={{ color: theme.muted, fontSize: 30, opacity: appear }}>→</div>
            ) : null}
            <Panel
              style={{
                width: 300,
                opacity: interpolate(appear, [0, 1], [0.15, 1]),
                transform: `translateY(${interpolate(appear, [0, 1], [16, 0])}px)`,
                borderColor: index === 3 ? theme.warn : theme.border,
              }}
            >
              <div style={{ fontSize: 23, color: theme.text }}>{step.label}</div>
              <div style={{ marginTop: 8, fontSize: 17, color: theme.muted }}>{step.detail}</div>
            </Panel>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** Roughly a third of House filings are photographs of paper, not text. */
const ScanScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const total = 24;
  const scanned = new Set([2, 5, 6, 9, 13, 14, 18, 21]);
  return (
    <div style={{ position: "absolute", left: 80, top: 250 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 92px)", gap: 12 }}>
        {Array.from({ length: total }, (_, index) => {
          const appear = spring({ frame: local - index * 3, fps, config: { damping: 200 } });
          const isScan = scanned.has(index);
          return (
            <div
              key={index}
              style={{
                width: 92,
                height: 112,
                borderRadius: 6,
                border: `1px solid ${isScan ? theme.warn : theme.border}`,
                background: isScan ? "rgba(210,153,34,0.14)" : theme.panel,
                opacity: appear,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 7,
                padding: "0 12px",
              }}
            >
              {[0, 1, 2, 3].map((line) => (
                <div
                  key={line}
                  style={{
                    height: 5,
                    borderRadius: 2,
                    background: isScan ? theme.warn : theme.accent,
                    opacity: isScan ? 0.35 : 0.55,
                    filter: isScan ? "blur(1.4px)" : "none",
                    width: `${70 + ((index + line) % 3) * 10}%`,
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      <Panel style={{ marginTop: 26, width: 1180, fontSize: 20, borderColor: theme.warn }}>
        The highlighted ones are scans. Nothing in them is text until an OCR engine says so.
      </Panel>
    </div>
  );
};

/** The failure that shaped the whole read design: one date, repeated, at high confidence. */
const OcrLiesScene: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const printed = ["04/13/22", "04/19/22", "04/01/22", "04/22/22", "04/08/22", "04/11/22"];
  return (
    <div style={{ position: "absolute", left: 80, top: 250, display: "flex", gap: 40 }}>
      <div>
        <div style={{ fontFamily: theme.sans, fontSize: 20, color: theme.muted, marginBottom: 12 }}>
          what the page prints
        </div>
        {printed.map((date, index) => {
          const appear = spring({ frame: local - index * 6, fps, config: { damping: 200 } });
          return (
            <Panel key={date} style={{ width: 300, marginBottom: 10, fontSize: 21, opacity: appear }}>
              {date}
            </Panel>
          );
        })}
      </div>
      <div>
        <div style={{ fontFamily: theme.sans, fontSize: 20, color: theme.muted, marginBottom: 12 }}>
          what the OCR returns
        </div>
        {printed.map((_, index) => {
          const appear = spring({ frame: local - 30 - index * 6, fps, config: { damping: 200 } });
          return (
            <Panel
              key={index}
              style={{
                width: 300,
                marginBottom: 10,
                fontSize: 21,
                opacity: appear,
                borderColor: theme.bad,
                color: theme.bad,
              }}
            >
              04/21/21
            </Panel>
          );
        })}
      </div>
      <Panel style={{ width: 440, alignSelf: "flex-start", borderColor: theme.bad, fontSize: 19 }}>
        <div style={{ color: theme.text }}>73 rows, one date</div>
        <div style={{ marginTop: 10, color: theme.muted }}>
          word confidence 0.92–0.999. Every page-level check passes: the page kept its letters and
          its dated lines.
        </div>
      </Panel>
    </div>
  );
};

/** Why a crop can come back blank: the filing is encrypted and the copy carries ciphertext. */
const EncryptedScene: React.FC<{ local: number }> = ({ local }) => {
  const decrypted = local > 70;
  return (
    <div style={{ position: "absolute", left: 80, top: 260, display: "flex", gap: 26, alignItems: "flex-start" }}>
      <Panel style={{ width: 330 }}>
        <div style={{ color: theme.muted, fontSize: 18 }}>the filed PDF</div>
        <div style={{ marginTop: 10, fontSize: 21, color: theme.warn }}>RC4-encrypted</div>
        <div style={{ marginTop: 8, fontSize: 17, color: theme.muted }}>93,640 characters of text</div>
      </Panel>
      <div style={{ color: theme.muted, fontSize: 30, paddingTop: 34 }}>→</div>
      <Panel style={{ width: 360, borderColor: decrypted ? theme.border : theme.bad }}>
        <div style={{ color: theme.muted, fontSize: 18 }}>copy pages directly</div>
        <div style={{ marginTop: 10, fontSize: 21, color: theme.bad }}>blank page</div>
        <div style={{ marginTop: 8, fontSize: 17, color: theme.muted }}>
          31 characters. No error raised.
        </div>
      </Panel>
      <div style={{ color: theme.muted, fontSize: 30, paddingTop: 34, opacity: decrypted ? 1 : 0.2 }}>→</div>
      <Panel
        style={{
          width: 400,
          borderColor: decrypted ? theme.ok : theme.border,
          opacity: decrypted ? 1 : 0.25,
        }}
      >
        <div style={{ color: theme.muted, fontSize: 18 }}>decrypt first, then copy</div>
        <div style={{ marginTop: 10, fontSize: 21, color: theme.ok }}>46,638 characters</div>
        <div style={{ marginTop: 8, fontSize: 17, color: theme.muted }}>
          the crop the reconciling read needs
        </div>
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
      {scene === 0 ? <FilingScene local={local} /> : null}
      {scene === 1 ? <ScanScene local={local} /> : null}
      {scene === 2 ? <OcrLiesScene local={local} /> : null}
      {scene === 3 ? <ReadScene local={local} /> : null}
      {scene === 4 ? <EncryptedScene local={local} /> : null}
      {scene === 5 ? <ReduceScene local={local} /> : null}
    </AbsoluteFill>
  );
};
