// Direction A — Flat list of triggers (v2)
// • Raw cron replaced with friendly ScheduleBuilder
// • "Not enforced" settings folded back into the main UI:
//   - On folders connect / On user logoff → first-class triggers
//   - Skip if changed > X% → Guard (alongside wait-for-locks)
//   - Run unattended / Auto-clear tree → new "After & during run" behavior section

function DirectionA() {
  const { accent, showPreview } = useWF();
  const [openTrigger, setOpenTrigger] = React.useState('schedule');

  return (
    <Modal
      title="Auto run settings"
      subtitle="Decide when this job should run on its own."
      footer={<>
        <div style={{ flex: 1, fontSize: 11, color: WF.inkMute }}>
          Manual run is always available from the job's menu.
        </div>
        <Btn small>Cancel</Btn>
        <Btn small primary accent={accent}>Save</Btn>
      </>}
    >
      {/* status strip + run now */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
        background: WF.card, border: `1px solid ${WF.line}`, borderRadius: 6,
        marginBottom: 16,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 8, background: WF.ok }} />
        <div style={{ flex: 1, fontSize: 12, color: WF.inkSoft }}>
          <b style={{ color: WF.ink }}>Auto run is on.</b> 4 triggers active · last fired 14 min ago
        </div>
        <Btn small accent={accent} style={{ borderColor: accent, color: accent }}>▶ Run now</Btn>
      </div>

      <Divider label="Triggers" />

      <TriggerRow
        id="filechange" name="When files change"
        summary="Local folder · 5s delay"
        on accent={accent}
        open={openTrigger === 'filechange'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'filechange' ? null : 'filechange')}
      >
        <Field label="Watch which side?">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PathOpt checked label="source · /Users/me/Photos" mono accent={accent} />
            <PathOpt label="destination · sftp://backup.example.com/photos" mono disabled note="Remote — file watch not available" />
          </div>
        </Field>
        <Field label="Delay before run" hint="Multiple changes within this window are coalesced into one run.">
          <Input value="5" suffix="seconds" />
        </Field>
      </TriggerRow>

      <TriggerRow
        id="periodic" name="On a repeating interval"
        summary="Every 30 min after the last run"
        on accent={accent}
        open={openTrigger === 'periodic'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'periodic' ? null : 'periodic')}
      >
        <Field label="Run every" hint="Counted from the last finished run. Scheduler polls about every 60 s, so very small intervals round up.">
          <Input value="30" suffix="minutes" />
        </Field>
        <StateRow tone="info" icon="ℹ">
          Skipped if the job is already <i>running</i> or <i>queued</i>.
        </StateRow>
      </TriggerRow>

      <TriggerRow
        id="schedule" name="On a specific schedule"
        summary="Every day at 09:00"
        on accent={accent}
        open={openTrigger === 'schedule'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'schedule' ? null : 'schedule')}
      >
        <ScheduleBuilder accent={accent} showPreview={showPreview} defaultMode="daily" />
      </TriggerRow>

      <TriggerRow
        id="folders" name="When a watched folder connects"
        summary="External drive mount or network share"
        accent={accent}
        open={openTrigger === 'folders'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'folders' ? null : 'folders')}
      >
        <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5, marginBottom: 10 }}>
          Fires when the OS reports that a folder or volume used by this job
          has been mounted or come online.
        </div>
        <Field label="Trigger for" hint="Either side of the job, as long as the path is local.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PathOpt checked label="source · /Volumes/Photos-Drive" mono accent={accent} />
            <PathOpt label="destination · sftp://… (remote — not applicable)" mono disabled />
          </div>
        </Field>
      </TriggerRow>

      <TriggerRow
        id="logoff" name="Before user logs off"
        summary="On logout, shutdown, or sleep"
        accent={accent}
        open={openTrigger === 'logoff'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'logoff' ? null : 'logoff')}
      >
        <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5 }}>
          One last sync before the session ends. The OS gives a short grace
          window — long-running jobs may not finish before shutdown completes.
        </div>
        <div style={{ marginTop: 10 }}>
          <StateRow tone="info" icon="ℹ">
            Best paired with a small-and-fast job. Heavy syncs may be cut short.
          </StateRow>
        </div>
      </TriggerRow>

      <TriggerRow
        id="onstart" name="When the backend starts"
        summary="Queued at API server start"
        accent={accent}
        open={openTrigger === 'onstart'}
        onToggleOpen={() => setOpenTrigger(openTrigger === 'onstart' ? null : 'onstart')}
      >
        <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5 }}>
          The job is queued when the backend API starts — not when you open
          the app. If the agent isn't running yet, it stays queued until the
          agent comes online.
        </div>
      </TriggerRow>

      <Divider label="Before each run · guards" />

      <Field
        label="Wait for locks to clear"
        hint="If another sync is using the local folder, wait up to this many minutes before giving up."
      >
        <Input value="2" suffix="min" />
        <span style={{ marginLeft: 10, fontSize: 12, color: WF.inkMute }}>0 = don't wait</span>
      </Field>

      <Field
        label="Skip if more than X% of files changed"
        hint="Bails out before sync if the diff is unexpectedly large — guards against accidental mass deletes."
      >
        <Input value="20" suffix="% of files" />
      </Field>

      <Divider label="During & after the run" />

      <ToggleRow
        label="Run silently in the background"
        desc="No prompts, no UI windows. Errors land in the job's log."
        on accent={accent}
      />
      <ToggleRow
        label="Clear the analyze tree after sync"
        desc="Drops the saved analysis once the run completes. Keeps storage tidy on big jobs."
        accent={accent}
      />

      <Note top={92} right={-200} width={170} rotate={3}>
        manual run lives in the<br />status strip — always<br />reachable, never hidden
        <svg width="80" height="40" style={{ position: 'absolute', left: -70, top: 12 }}>
          <path d="M 70 18 C 40 18, 20 10, 4 14" stroke="#7a4a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M 10 10 L 4 14 L 10 18" stroke="#7a4a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Note>
    </Modal>
  );
}

function TriggerRow({ id, name, summary, on, open, onToggleOpen, accent, children }) {
  const [enabled, setEnabled] = React.useState(!!on);
  return (
    <div style={{
      border: `1px solid ${open ? WF.line : WF.lineSoft}`, borderRadius: 6,
      background: WF.card, marginBottom: 8,
      boxShadow: open ? '0 2px 8px rgba(0,0,0,0.04)' : 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', cursor: 'pointer',
      }} onClick={onToggleOpen}>
        <div onClick={e => e.stopPropagation()}>
          <Toggle on={enabled} onChange={setEnabled} accent={accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{name}</div>
            {enabled && <StatePill tone="on">on</StatePill>}
          </div>
          <div style={{ fontSize: 12, color: WF.inkMute, marginTop: 2 }}>
            {summary}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{
          color: WF.inkMute, transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform .15s',
        }}>
          <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      {open && (
        <div style={{ padding: '14px 14px 14px 50px', borderTop: `1px solid ${WF.lineSoft}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, desc, on, accent }) {
  const [v, setV] = React.useState(!!on);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 0', borderBottom: `1px solid ${WF.lineSoft}`,
    }}>
      <Toggle on={v} onChange={setV} accent={accent} />
      <div style={{ flex: 1, marginTop: -1 }}>
        <div style={{ fontSize: 13, color: WF.ink }}>{label}</div>
        <div style={{ fontSize: 12, color: WF.inkMute, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

function PathOpt({ checked, label, mono, disabled, note, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px',
      border: `1px solid ${checked ? accent : WF.lineSoft}`,
      background: checked ? '#eff4ff' : WF.card,
      borderRadius: 5, opacity: disabled ? 0.6 : 1,
    }}>
      <Checkbox on={checked} accent={accent} />
      <div style={{ flex: 1, fontSize: 12, fontFamily: mono ? 'ui-monospace, SF Mono, monospace' : 'inherit' }}>
        {label}
        {note && <div style={{ fontSize: 11, color: WF.warn, fontFamily: 'inherit', marginTop: 2 }}>{note}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { DirectionA });
