// Shared wireframe primitives + tweak context for all 4 directions.
// Higher-fi wireframe vibe: real text, real controls, grayscale + 1 accent.

const WF = {
  ink: '#1f1d1b',
  inkSoft: '#5a5550',
  inkMute: '#8a847e',
  inkFaint: '#b8b2ab',
  paper: '#fafaf7',
  card: '#ffffff',
  line: '#d8d2ca',
  lineSoft: '#e8e2da',
  fill: '#f3efe8',
  fillSoft: '#f7f4ee',
  warn: '#8a5a00',
  warnBg: '#fbf2dc',
  danger: '#992c1a',
  ok: '#1f6b3a',
};

const WFCtx = React.createContext({ accent: '#c2410c', showExperimental: true, showPreview: true });

const useWF = () => React.useContext(WFCtx);

// ── handwritten note (designer marginalia) ─────────────────────────────────
function Note({ children, top, left, right, bottom, width = 180, rotate = -2, arrow }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom, width,
      transform: `rotate(${rotate}deg)`,
      fontFamily: '"Caveat", "Patrick Hand", cursive',
      fontSize: 16, lineHeight: 1.15, color: '#7a4a1a',
      pointerEvents: 'none', zIndex: 5,
    }}>
      {children}
      {arrow && (
        <svg width="60" height="40" style={{ position: 'absolute', ...arrow.pos }}>
          <path d={arrow.d} stroke="#7a4a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d={arrow.head} stroke="#7a4a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

// ── modal chrome — the dialog inside an artboard ───────────────────────────
function Modal({ title, subtitle, jobName = 'photos-backup', children, footer, width = 640, height = 860, flush }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#ede8df',
      overflow: 'hidden', fontFamily: 'Inter, -apple-system, sans-serif',
      color: WF.ink,
    }}>
      {/* faint hint of underlying job list */}
      <BackdropJobList />
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(35,30,25,0.32)',
      }} />
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width, maxHeight: height - 40,
        background: WF.paper, borderRadius: 10,
        boxShadow: '0 24px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <ModalHeader title={title} subtitle={subtitle} jobName={jobName} />
        <div style={{ flex: 1, overflow: 'auto', padding: flush ? 0 : '18px 22px 22px', display: 'flex', minHeight: 0 }}>
          {children}
        </div>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </div>
  );
}

function ModalHeader({ title, subtitle, jobName }) {
  return (
    <div style={{
      padding: '16px 22px 14px', borderBottom: `1px solid ${WF.lineSoft}`,
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 4 }}>
          Job · <span style={{ fontFamily: 'ui-monospace, SF Mono, monospace', textTransform: 'none', letterSpacing: 0, color: WF.inkSoft }}>{jobName}</span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: WF.inkSoft, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button style={{
        width: 28, height: 28, border: 'none', background: 'transparent',
        color: WF.inkMute, fontSize: 18, cursor: 'pointer', borderRadius: 6,
      }}>×</button>
    </div>
  );
}

function ModalFooter({ children }) {
  return (
    <div style={{
      padding: '12px 22px', borderTop: `1px solid ${WF.lineSoft}`,
      background: WF.fillSoft,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>{children}</div>
  );
}

function BackdropJobList() {
  // faint placeholder of a job list behind the modal
  return (
    <div style={{ position: 'absolute', inset: 0, padding: 24, opacity: 0.55 }}>
      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 10 }}>Jobs</div>
      {['photos-backup', 'docs-mirror', 'media-archive', 'logs-rotate', 'team-share'].map((n, i) => (
        <div key={n} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', marginBottom: 6, background: WF.card,
          border: `1px solid ${WF.lineSoft}`, borderRadius: 6,
          opacity: i === 0 ? 1 : 0.7,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: 8, background: i === 0 ? '#1f6b3a' : WF.inkFaint }} />
          <div style={{ flex: 1, fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 12, color: WF.inkSoft }}>{n}</div>
          <div style={{ fontSize: 11, color: WF.inkMute }}>last run · 2h</div>
        </div>
      ))}
    </div>
  );
}

// ── form primitives ────────────────────────────────────────────────────────
function Btn({ children, primary, ghost, danger, accent, small, style, ...p }) {
  const a = accent;
  const bg = primary ? (a || WF.ink) : ghost ? 'transparent' : WF.card;
  const fg = primary ? '#fff' : danger ? WF.danger : WF.ink;
  const bd = primary ? bg : ghost ? 'transparent' : WF.line;
  return (
    <button {...p} style={{
      padding: small ? '6px 12px' : '8px 16px',
      fontSize: small ? 12 : 13, fontWeight: 500,
      background: bg, color: fg, border: `1px solid ${bd}`,
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      ...style,
    }}>{children}</button>
  );
}

function Toggle({ on, onChange, accent }) {
  const a = accent || '#c2410c';
  return (
    <button onClick={() => onChange && onChange(!on)} style={{
      width: 36, height: 20, borderRadius: 20,
      background: on ? a : WF.inkFaint, border: 'none',
      position: 'relative', cursor: 'pointer', padding: 0,
      transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: 16, background: '#fff',
        transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

function Field({ label, hint, children, badge, warn, style }) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: WF.inkSoft }}>{label}</label>
        {badge}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 5, lineHeight: 1.4 }}>{hint}</div>}
      {warn && <div style={{ fontSize: 11, color: WF.warn, marginTop: 5, lineHeight: 1.4, display: 'flex', gap: 6 }}>
        <span>⚠</span><span>{warn}</span>
      </div>}
    </div>
  );
}

function Input({ value, mono, suffix, width, ...p }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      border: `1px solid ${WF.line}`, borderRadius: 5, background: WF.card,
      paddingRight: suffix ? 10 : 0,
    }}>
      <input defaultValue={value} {...p} style={{
        width: width || 80, padding: '6px 10px', border: 'none', outline: 'none',
        background: 'transparent', fontSize: 13,
        fontFamily: mono ? 'ui-monospace, SF Mono, monospace' : 'inherit',
        color: WF.ink,
      }} />
      {suffix && <span style={{ fontSize: 12, color: WF.inkMute }}>{suffix}</span>}
    </div>
  );
}

function Badge({ children, tone = 'mute' }) {
  const tones = {
    mute: { bg: WF.fill, fg: WF.inkSoft, bd: WF.line },
    warn: { bg: WF.warnBg, fg: WF.warn, bd: '#e6cf94' },
    planned: { bg: '#eef0f5', fg: '#4a5165', bd: '#cfd5e0' },
    live: { bg: '#dff0e3', fg: WF.ok, bd: '#b6dcc0' },
    accent: { bg: '#fbe6d7', fg: '#8a3a10', bd: '#f0c7a3' },
  };
  const t = tones[tone] || tones.mute;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 3,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
    }}>{children}</span>
  );
}

function Checkbox({ on, onChange, accent }) {
  const a = accent || '#c2410c';
  return (
    <button onClick={() => onChange && onChange(!on)} style={{
      width: 16, height: 16, border: `1.5px solid ${on ? a : WF.inkFaint}`,
      background: on ? a : WF.card, borderRadius: 3, padding: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flex: '0 0 auto',
    }}>
      {on && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5L4 7L8 3" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </button>
  );
}

function Divider({ label }) {
  if (!label) return <div style={{ height: 1, background: WF.lineSoft, margin: '14px 0' }} />;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '20px 0 12px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: WF.lineSoft }} />
    </div>
  );
}

// inline state warning row
function StateRow({ tone = 'warn', icon = '⚠', children }) {
  const cfg = tone === 'warn'
    ? { bg: WF.warnBg, fg: WF.warn, bd: '#e6cf94' }
    : tone === 'info'
    ? { bg: '#eaf1f8', fg: '#2b5378', bd: '#c8dae9' }
    : { bg: '#fbe6e0', fg: WF.danger, bd: '#eec3b6' };
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 11px', background: cfg.bg, color: cfg.fg,
      border: `1px solid ${cfg.bd}`, borderRadius: 5,
      fontSize: 12, lineHeight: 1.4,
    }}>
      <span style={{ flex: '0 0 auto' }}>{icon}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// pill that summarizes a trigger's state for collapsed rows
function StatePill({ children, tone = 'mute' }) {
  const tones = {
    mute: { bg: 'transparent', fg: WF.inkMute, bd: WF.lineSoft },
    on: { bg: '#dff0e3', fg: WF.ok, bd: '#b6dcc0' },
    warn: { bg: WF.warnBg, fg: WF.warn, bd: '#e6cf94' },
  };
  const t = tones[tone] || tones.mute;
  return (
    <span style={{
      fontSize: 11, color: t.fg, background: t.bg,
      border: `1px solid ${t.bd}`, borderRadius: 10,
      padding: '1px 8px',
    }}>{children}</span>
  );
}

Object.assign(window, {
  WF, WFCtx, useWF, Note, Modal, Btn, Toggle, Field, Input, Badge, Checkbox, Divider, StateRow, StatePill,
});
