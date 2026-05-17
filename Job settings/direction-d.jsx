// Direction D — Settings shell with Schedule pane (v3)
// Left rail = full job-settings nav. Schedule pane is the active one and
// contains the trigger list + guards + behavior. "Next runs" preview is now
// behind a button that opens a popover anchored to it.

const NAV = [
  { kind: 'item', id: 'general',    label: 'General' },
  { kind: 'item', id: 'paths',      label: 'Source & Destination' },
  { kind: 'item', id: 'filters',    label: 'Filters' },
  { kind: 'item', id: 'schedule',   label: 'Schedule' },
  { kind: 'group', label: 'Sync behavior' },
  { kind: 'item', id: 'analyze',    label: 'Analyze', indent: true },
  { kind: 'item', id: 'syncopts',   label: 'Sync options', indent: true },
  { kind: 'item', id: 'conflicts',  label: 'Conflicts' },
  { kind: 'group', label: 'Advanced' },
  { kind: 'item', id: 'history',    label: 'History', indent: true },
  { kind: 'item', id: 'limits',     label: 'Speed / limits', indent: true },
  { kind: 'item', id: 'scripts',    label: 'Scripts', indent: true },
  { kind: 'item', id: 'compare',    label: 'Comparison', indent: true },
];

function DirectionD() {
  const { accent, showPreview } = useWF();
  const [active, setActive] = React.useState('schedule');

  return (
    <Modal
      width={920}
      title="Job settings"
      subtitle="Configure how this job is set up and when it runs."
      flush
      footer={<>
        <Btn small accent={accent} style={{ borderColor: accent, color: accent }}>▶ Run now</Btn>
        <div style={{ flex: 1, fontSize: 11, color: WF.inkMute }}>
          Agent <b style={{ color: WF.ok }}>online</b> · 4 triggers active on Schedule
        </div>
        <Btn small>Cancel</Btn>
        <Btn small primary accent={accent}>Save</Btn>
      </>}
    >
      <NavRail active={active} setActive={setActive} accent={accent} />
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        padding: '20px 24px 28px',
      }}>
        {active === 'schedule' ? (
          <SchedulePane accent={accent} showPreview={showPreview} />
        ) : (
          <PlaceholderPane id={active} />
        )}
      </div>
    </Modal>
  );
}

function NavRail({ active, setActive, accent }) {
  return (
    <nav style={{
      flex: '0 0 200px', width: 200,
      borderRight: `1px solid ${WF.lineSoft}`,
      background: '#f6f3ec',
      padding: '14px 8px', overflow: 'auto',
      fontSize: 13,
    }}>
      {NAV.map((n, i) => {
        if (n.kind === 'group') {
          return (
            <div key={i} style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: WF.inkMute, padding: '12px 10px 6px',
            }}>{n.label}</div>
          );
        }
        const isActive = n.id === active;
        return (
          <button key={n.id} onClick={() => setActive(n.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', textAlign: 'left',
            padding: n.indent ? '7px 10px 7px 22px' : '7px 10px',
            fontSize: 13, fontWeight: isActive ? 600 : 400,
            color: isActive ? WF.ink : WF.inkSoft,
            background: isActive ? WF.card : 'transparent',
            border: 'none', borderRadius: 5, cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: isActive ? `inset 2px 0 0 ${accent}, 0 1px 2px rgba(0,0,0,.05)` : 'none',
            marginBottom: 1,
          }}>
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.id === 'schedule' && <StatePill tone="on">on</StatePill>}
          </button>
        );
      })}
    </nav>
  );
}

// ── Schedule pane (the main content) ───────────────────────────────────────
function SchedulePane({ accent, showPreview }) {
  const [enabled, setEnabled] = React.useState({
    filechange: true, periodic: true, schedule: true, onstart: false,
    folders: true, logoff: false,
  });
  const set = k => setEnabled(e => ({ ...e, [k]: !e[k] }));

  return (
    <>
      <PaneHeader
        title="Schedule"
        subtitle="When this job should run on its own. Manual run is always available."
        action={showPreview ? <PreviewButton accent={accent} /> : null}
      />

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 10, marginTop: 6 }}>Triggers</div>

      <CompactTrigger id="filechange" name="When files change" on={enabled.filechange}
        onToggle={() => set('filechange')} accent={accent}
        controls={<>
          <SmallField label="Source path"><code style={mono}>/Users/me/Photos</code></SmallField>
          <SmallField label="Delay"><Input value="5" suffix="s" width={56} /></SmallField>
        </>} />

      <CompactTrigger id="periodic" name="Repeating interval" on={enabled.periodic}
        onToggle={() => set('periodic')} accent={accent}
        controls={<>
          <SmallField label="Every"><Input value="30" suffix="min" width={56} /></SmallField>
          <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 4 }}>scheduler polls every ~60 s</div>
        </>} />

      <CompactTrigger id="schedule" name="On a schedule" on={enabled.schedule}
        onToggle={() => set('schedule')} accent={accent} wideBody
        controls={<div style={{ width: '100%' }}>
          <ScheduleBuilder accent={accent} showPreview={false} defaultMode="daily" compact />
        </div>} />

      <CompactTrigger id="folders" name="When a folder connects" on={enabled.folders}
        onToggle={() => set('folders')} accent={accent}
        controls={<>
          <SmallField label="Watch"><code style={mono}>/Volumes/Photos-Drive</code></SmallField>
          <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 4 }}>mount/connect hook on local paths</div>
        </>} />

      <CompactTrigger id="logoff" name="Before logoff / shutdown" on={enabled.logoff}
        onToggle={() => set('logoff')} accent={accent}
        controls={<div style={{ fontSize: 11, color: WF.inkMute }}>
          One last sync when the OS reports a logout. Short grace window — best for small jobs.
        </div>} />

      <CompactTrigger id="onstart" name="On API start" on={enabled.onstart}
        onToggle={() => set('onstart')} accent={accent} />

      <Divider label="Before each run · guards" />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <SmallField label="Wait for locks"><Input value="2" suffix="min" width={56} /></SmallField>
        <SmallField label="Skip if changed >"><Input value="20" suffix="%" width={56} /></SmallField>
      </div>

      <Divider label="During & after the run" />
      <SmallToggle label="Run silently in the background"
        desc="No prompts, no UI windows. Errors land in the job's log."
        on accent={accent} />
      <SmallToggle label="Clear analyze tree after sync"
        desc="Drops the saved analysis once the run completes."
        accent={accent} />
    </>
  );
}

function PaneHeader({ title, subtitle, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      marginBottom: 18,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: WF.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

// ── Preview button + popover ───────────────────────────────────────────────
function PreviewButton({ accent }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 12px',
        background: open ? accent : WF.card,
        color: open ? '#fff' : accent,
        border: `1px solid ${open ? accent : accent}`,
        borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'inherit',
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Preview next runs
        <svg width="9" height="9" viewBox="0 0 10 10" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && <PreviewPopover onClose={() => setOpen(false)} accent={accent} />}
    </div>
  );
}

function PreviewPopover({ onClose, accent }) {
  return (
    <>
      {/* click-outside catcher */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 50,
      }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 51,
        width: 320, background: WF.card,
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)',
      }}>
        {/* little caret */}
        <div style={{
          position: 'absolute', top: -6, right: 24,
          width: 12, height: 12, background: WF.card,
          transform: 'rotate(45deg)',
          boxShadow: '-1px -1px 0 rgba(0,0,0,0.06)',
        }} />
        <div style={{ padding: 14 }}>
          <TimelinePreview accent={accent} compact />
        </div>
      </div>
    </>
  );
}

// ── reused timeline ────────────────────────────────────────────────────────
function TimelinePreview({ accent, compact }) {
  const runs = [
    { day: 'Today',    time: '09:00', dur: '~4 min', trigger: 'schedule', note: 'daily 09:00' },
    { day: 'Today',    time: '09:30', dur: 'idle',   trigger: 'periodic', note: 'every 30 min' },
    { day: 'Today',    time: '10:00', dur: 'idle',   trigger: 'periodic' },
    { day: 'Today',    time: '14:22', dur: '—',      trigger: 'folders',  note: 'when drive mounts' },
    { day: 'Today',    time: '18:00', dur: 'skipped', trigger: 'periodic', skipped: true, note: 'overlap' },
    { day: 'Tomorrow', time: '09:00', dur: '~4 min', trigger: 'schedule' },
    { day: 'Tomorrow', time: '09:30', dur: 'idle',   trigger: 'periodic' },
  ];
  const triggerColor = {
    schedule: accent,
    periodic: '#5d6f8b',
    filechange: '#1f6b3a',
    folders: '#9a6510',
    logoff: '#7a3a5a',
    onstart: '#7a4a8a',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkSoft }}>
          Next runs
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: WF.inkMute }}>simulated</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, fontSize: 10, color: WF.inkSoft }}>
        {['schedule','periodic','filechange','folders'].map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: triggerColor[k], display: 'inline-block' }} />
            {k}
          </span>
        ))}
      </div>

      <div style={{ position: 'relative', maxHeight: 320, overflowY: 'auto' }}>
        <div style={{
          position: 'absolute', left: 7, top: 6, bottom: 6, width: 2,
          background: WF.lineSoft,
        }} />
        {runs.map((r, i) => {
          const newDay = i === 0 || runs[i - 1].day !== r.day;
          return (
            <React.Fragment key={i}>
              {newDay && (
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: WF.inkMute, padding: '6px 0 4px 22px',
                }}>{r.day}</div>
              )}
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '5px 0', position: 'relative',
                opacity: r.skipped ? 0.5 : 1,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 16,
                  background: WF.card, border: `2px solid ${triggerColor[r.trigger]}`,
                  flex: '0 0 auto', position: 'relative', zIndex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {r.skipped && <div style={{ width: 8, height: 1.5, background: triggerColor[r.trigger] }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 12, fontWeight: 500, color: r.skipped ? WF.inkMute : WF.ink }}>
                      {r.time}
                    </span>
                    <span style={{ fontSize: 10, color: WF.inkMute, textTransform: 'uppercase' }}>{r.dur}</span>
                  </div>
                  <div style={{ fontSize: 11, color: WF.inkSoft, marginTop: 1 }}>
                    {r.trigger}{r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div style={{
        marginTop: 10, padding: '7px 10px', background: WF.fillSoft,
        border: `1px solid ${WF.lineSoft}`, borderRadius: 5,
        fontSize: 11, color: WF.inkSoft, lineHeight: 1.45,
      }}>
        File-change runs fire reactively — not shown in the agenda.
      </div>
    </div>
  );
}

// ── Placeholder content for non-Schedule panes ─────────────────────────────
const PLACEHOLDERS = {
  general:   { title: 'General',              fields: ['Job name', 'Description', 'Direction (one-way / reverse / bidirectional)', 'Tags', 'Enabled'] },
  paths:     { title: 'Source & Destination', fields: ['Source backend', 'Source path', 'Destination backend', 'Destination path', 'Test connection'] },
  filters:   { title: 'Filters',              fields: ['Include patterns', 'Exclude patterns', 'Skip hidden files', 'Skip system files', 'Max file size'] },
  analyze:   { title: 'Analyze',              fields: ['Hash algorithm', 'Hash size limit', 'Mtime tolerance', 'Re-use last analysis', 'Parallel workers'] },
  syncopts:  { title: 'Sync options',         fields: ['Delete extraneous', 'Preserve permissions', 'Preserve timestamps', 'Compression', 'Dry run mode'] },
  conflicts: { title: 'Conflicts',            fields: ['On conflict', 'Keep both', 'Backup folder', 'Conflict marker suffix', 'Auto-resolve same content'] },
  history:   { title: 'History',              fields: ['Keep N runs', 'Retain logs for', 'Export history', 'Clear history'] },
  limits:    { title: 'Speed / limits',       fields: ['Bandwidth cap (up)', 'Bandwidth cap (down)', 'Concurrent transfers', 'CPU priority', 'Pause on metered network'] },
  scripts:   { title: 'Scripts',              fields: ['Pre-sync command', 'Post-sync command', 'On-error command', 'Run as user', 'Working directory'] },
  compare:   { title: 'Comparison',           fields: ['Compare by', 'Ignore mtime drift', 'Ignore size differences', 'Compare permissions', 'Compare extended attributes'] },
};

function PlaceholderPane({ id }) {
  const cfg = PLACEHOLDERS[id] || { title: id, fields: [] };
  return (
    <>
      <PaneHeader title={cfg.title} subtitle="(out of scope for this exploration — Schedule is the focus)" />
      <div style={{
        border: `1px dashed ${WF.line}`, borderRadius: 6,
        background: WF.fillSoft, padding: 18,
      }}>
        <div style={{ fontSize: 11, color: WF.inkMute, marginBottom: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Would live here
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {cfg.fields.map(f => (
            <div key={f}>
              <div style={{ fontSize: 11, color: WF.inkMute, marginBottom: 5 }}>{f}</div>
              <div style={{
                height: 28, background: WF.card,
                border: `1px solid ${WF.lineSoft}`, borderRadius: 4,
              }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── small helpers ──────────────────────────────────────────────────────────
const mono = {
  fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 12,
  background: WF.fillSoft, padding: '2px 6px', borderRadius: 3,
  border: `1px solid ${WF.lineSoft}`, color: WF.inkSoft,
};

function CompactTrigger({ id, name, on, onToggle, accent, controls, wideBody }) {
  return (
    <div style={{
      padding: '10px 12px', background: WF.card,
      border: `1px solid ${on ? WF.line : WF.lineSoft}`, borderRadius: 6,
      marginBottom: 8, opacity: on ? 1 : 0.78,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle on={on} onChange={onToggle} accent={accent} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{name}</div>
        {on && <StatePill tone="on">live</StatePill>}
      </div>
      {on && controls && (
        <div style={{
          marginTop: 10,
          paddingLeft: wideBody ? 0 : 46,
          display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start',
        }}>
          {controls}
        </div>
      )}
    </div>
  );
}

function SmallField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: WF.inkMute, marginBottom: 4, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function SmallToggle({ label, desc, on, accent }) {
  const [v, setV] = React.useState(!!on);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
      <Toggle on={v} onChange={setV} accent={accent} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: WF.ink }}>{label}</div>
        <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

Object.assign(window, { DirectionD });
