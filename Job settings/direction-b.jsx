// Direction B — Trigger cards grid (v2)
// 6 trigger cards now (added folders-connect + logoff), schedule card uses
// ScheduleBuilder, behavior section replaces the experimental drawer.

function DirectionB() {
  const { accent, showPreview } = useWF();
  const [selected, setSelected] = React.useState('schedule');
  const [enabled, setEnabled] = React.useState({
    filechange: true, periodic: true, schedule: true, onstart: false,
    folders: true, logoff: false,
  });

  return (
    <Modal
      title="Auto run"
      subtitle="Pick the triggers that should start this job."
      width={680}
      footer={<>
        <Btn small ghost style={{ color: accent }}>▶ Run now</Btn>
        <div style={{ flex: 1 }} />
        <Btn small>Cancel</Btn>
        <Btn small primary accent={accent}>Save</Btn>
      </>}
    >
      <StateRow tone="warn" icon="⚠">
        Agent is offline. Triggers can queue runs, but nothing will actually execute until the agent reconnects.
      </StateRow>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 10 }}>
          Triggers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TriggerCard id="filechange" glyph="◰" title="On file change" summary="5s coalesce delay"
            on={enabled.filechange} selected={selected === 'filechange'}
            onSelect={() => setSelected('filechange')}
            onToggle={() => setEnabled(e => ({ ...e, filechange: !e.filechange }))}
            accent={accent} />
          <TriggerCard id="periodic" glyph="⟳" title="Repeating interval" summary="every 30 min"
            on={enabled.periodic} selected={selected === 'periodic'}
            onSelect={() => setSelected('periodic')}
            onToggle={() => setEnabled(e => ({ ...e, periodic: !e.periodic }))}
            accent={accent} />
          <TriggerCard id="schedule" glyph="🗓" title="On a schedule" summary="every day · 09:00"
            on={enabled.schedule} selected={selected === 'schedule'}
            onSelect={() => setSelected('schedule')}
            onToggle={() => setEnabled(e => ({ ...e, schedule: !e.schedule }))}
            accent={accent} />
          <TriggerCard id="folders" glyph="⏏" title="Folder connects" summary="external drive mount"
            on={enabled.folders} selected={selected === 'folders'}
            onSelect={() => setSelected('folders')}
            onToggle={() => setEnabled(e => ({ ...e, folders: !e.folders }))}
            accent={accent} />
          <TriggerCard id="logoff" glyph="⎋" title="Before logoff" summary="logout / shutdown / sleep"
            on={enabled.logoff} selected={selected === 'logoff'}
            onSelect={() => setSelected('logoff')}
            onToggle={() => setEnabled(e => ({ ...e, logoff: !e.logoff }))}
            accent={accent} />
          <TriggerCard id="onstart" glyph="⏻" title="On API start" summary="queue at backend start"
            on={enabled.onstart} selected={selected === 'onstart'}
            onSelect={() => setSelected('onstart')}
            onToggle={() => setEnabled(e => ({ ...e, onstart: !e.onstart }))}
            accent={accent} />
        </div>

        {/* expanded body for selected card */}
        <div style={{
          marginTop: 12, padding: 14,
          background: WF.card, border: `1px solid ${WF.line}`, borderRadius: 6,
          minHeight: 160,
        }}>
          {selected === 'filechange' && <FilechangeBody accent={accent} />}
          {selected === 'periodic' && <PeriodicBody />}
          {selected === 'schedule' && <ScheduleBuilder accent={accent} showPreview={showPreview} defaultMode="daily" />}
          {selected === 'folders' && <FoldersBody accent={accent} />}
          {selected === 'logoff' && <LogoffBody />}
          {selected === 'onstart' && <OnstartBody />}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 10 }}>
          Before each run · guards
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <GuardCard title="Wait for locks" value="2 min"
            hint="Wait up to N minutes if the local folder is busy with another sync." on />
          <GuardCard title="Skip large diffs" value="20%"
            hint="Bail out if more than X% of files changed — guards against accidental mass deletes." on />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: WF.inkMute, marginBottom: 10 }}>
          During & after the run
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <BehaviorCard title="Run silently" desc="No prompts, no UI windows. Errors go to the job log." on accent={accent} />
          <BehaviorCard title="Clear analyze tree" desc="Drop the saved analysis after the run completes." accent={accent} />
        </div>
      </div>

      <Note top={166} right={-180} width={150} rotate={-3}>
        cards make trigger types<br />visually distinct + scan-<br />able. body of selected<br />card expands below
      </Note>
    </Modal>
  );
}

function TriggerCard({ glyph, title, summary, on, selected, onSelect, onToggle, accent }) {
  return (
    <div onClick={onSelect} style={{
      position: 'relative', padding: '12px 14px',
      background: on ? '#eff4ff' : WF.card,
      border: `1.5px solid ${selected ? accent : on ? '#bcd0f5' : WF.lineSoft}`,
      borderRadius: 6, cursor: 'pointer',
      boxShadow: selected ? `0 0 0 3px ${accent}22` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          background: on ? '#fff' : WF.fill,
          border: `1px solid ${on ? '#bcd0f5' : WF.lineSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: on ? accent : WF.inkMute,
        }}>{glyph}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 2 }}>{summary}</div>
        </div>
        <div onClick={e => { e.stopPropagation(); onToggle(); }}>
          <Toggle on={on} accent={accent} />
        </div>
      </div>
    </div>
  );
}

function GuardCard({ title, value, hint, on }) {
  return (
    <div style={{
      padding: '12px 14px', background: WF.card,
      border: `1px solid ${WF.lineSoft}`, borderRadius: 6,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: WF.inkSoft, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: WF.ink, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: WF.inkMute, lineHeight: 1.4 }}>{hint}</div>
    </div>
  );
}

function BehaviorCard({ title, desc, on, accent }) {
  const [v, setV] = React.useState(!!on);
  return (
    <div style={{
      padding: '12px 14px', background: WF.card,
      border: `1px solid ${v ? WF.line : WF.lineSoft}`, borderRadius: 6,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <Toggle on={v} onChange={setV} accent={accent} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: WF.ink }}>{title}</div>
        <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

// ── per-trigger configuration bodies ──────────────────────────────────────
function FilechangeBody({ accent }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: WF.inkSoft, marginBottom: 10 }}>
        Configure file watch
      </div>
      <Field label="Watch path(s)" hint="Only local absolute paths can be watched — remote backends (sftp/s3/ftp) are skipped.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          <PathOptB checked label="source · /Users/me/Photos" accent={accent} />
          <PathOptB label="destination · sftp://backup.example.com/photos" disabled note="Remote — file watch not available" />
        </div>
      </Field>
      <Field label="Coalesce delay" hint="Multiple changes inside this window count as one run.">
        <Input value="5" suffix="sec" />
      </Field>
    </div>
  );
}

function PeriodicBody() {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: WF.inkSoft, marginBottom: 10 }}>
        Configure repeating interval
      </div>
      <Field label="Run every" hint="Counted from the last finished run. Backend polls ≈ every 60 s, so very small intervals round up.">
        <Input value="30" suffix="minutes" />
      </Field>
      <StateRow tone="info" icon="ℹ">Setting this to <b>0</b> disables the trigger.</StateRow>
    </div>
  );
}

function FoldersBody({ accent }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: WF.inkSoft, marginBottom: 8 }}>
        On folder connect
      </div>
      <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
        Fires when the OS reports that a path used by this job becomes available — e.g. an external drive plugs in or a network share mounts.
      </div>
      <Field label="Watch which paths?">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          <PathOptB checked label="source · /Volumes/Photos-Drive" accent={accent} />
          <PathOptB label="destination · sftp://… (remote — n/a)" disabled />
        </div>
      </Field>
    </div>
  );
}

function LogoffBody() {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: WF.inkSoft, marginBottom: 8 }}>
        Before user logs off
      </div>
      <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
        One last sync when the OS reports a logout, shutdown, or sleep. The OS only gives a short grace window — best paired with a small, fast job.
      </div>
      <StateRow tone="info" icon="ℹ">
        Heavy syncs may be cut short before the system actually shuts down.
      </StateRow>
    </div>
  );
}

function OnstartBody() {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: WF.inkSoft, marginBottom: 8 }}>
        On API server start
      </div>
      <div style={{ fontSize: 12, color: WF.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
        When the backend API process starts, this job is added to the run queue. Opening
        the UI alone does <i>not</i> trigger it.
      </div>
      <StateRow tone="info" icon="ℹ">
        If the agent isn't connected yet, the run waits in the queue until it joins.
      </StateRow>
    </div>
  );
}

function PathOptB({ checked, label, disabled, note, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px',
      border: `1px solid ${checked ? accent : WF.lineSoft}`,
      background: checked ? '#eef4ff' : WF.fillSoft,
      borderRadius: 5, opacity: disabled ? 0.65 : 1,
    }}>
      <Checkbox on={checked} accent={accent} />
      <div style={{ flex: 1, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
        {label}
        {note && <div style={{ fontSize: 11, color: WF.warn, fontFamily: 'Inter, sans-serif', marginTop: 2 }}>{note}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { DirectionB });
