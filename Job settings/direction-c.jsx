// Direction C — Plain-language stacked questions (v2)
// Schedule question uses ScheduleBuilder. Folders-connect + logoff added as
// new questions. Behavior toggles (silent run, clear tree) sit in a separate
// "Behavior" group at the bottom.

function DirectionC() {
  const { accent, showPreview } = useWF();
  const [opts, setOpts] = React.useState({
    filechange: true, periodic: true, schedule: true, onstart: false,
    folders: true, logoff: false,
  });
  const set = (k, v) => setOpts(o => ({ ...o, [k]: v }));

  return (
    <Modal
      title="When should this job run?"
      subtitle="Tick anything that applies. You can always start it by hand from the job's menu."
      width={620}
      footer={<>
        <Btn small ghost style={{ color: accent }}>▶ Run it now</Btn>
        <div style={{ flex: 1 }} />
        <Btn small>Close</Btn>
        <Btn small primary accent={accent}>Save</Btn>
      </>}
    >
      <Question
        on={opts.filechange} onToggle={() => set('filechange', !opts.filechange)}
        label="When files change in the watched folder"
        helper="Watches a local path on this device. Doesn't work for remote backends like sftp:// or s3://."
        accent={accent}
      >
        <PlainRow label="Watch">
          <select style={selectStyle}>
            <option>source · /Users/me/Photos</option>
            <option disabled>destination · sftp:// (remote — unavailable)</option>
            <option>both local sides (bidirectional only)</option>
          </select>
        </PlainRow>
        <PlainRow label="Wait">
          <Input value="5" suffix="seconds" />
          <span style={{ fontSize: 12, color: WF.inkMute, marginLeft: 8 }}>before starting, so bursts of edits count as one run.</span>
        </PlainRow>
      </Question>

      <Question
        on={opts.periodic} onToggle={() => set('periodic', !opts.periodic)}
        label="On a repeating interval"
        helper="Measured from the last finished run. If a run is already going, the next tick is skipped."
        accent={accent}
      >
        <PlainRow label="Every">
          <Input value="30" suffix="minutes" />
          <span style={{ fontSize: 12, color: WF.inkMute, marginLeft: 8 }}>(scheduler checks once a minute, so anything under 1 min won't speed things up).</span>
        </PlainRow>
      </Question>

      <Question
        on={opts.schedule} onToggle={() => set('schedule', !opts.schedule)}
        label="On a specific schedule"
        helper="For when you need finer control — e.g. weekdays only, or once a month at midnight."
        accent={accent}
      >
        <div style={{ marginLeft: 28 }}>
          <ScheduleBuilder accent={accent} showPreview={showPreview} defaultMode="daily" compact />
        </div>
      </Question>

      <Question
        on={opts.folders} onToggle={() => set('folders', !opts.folders)}
        label="When a watched folder connects"
        helper="Fires when an external drive plugs in or a network share mounts — handy for laptops that come and go."
        accent={accent}
      >
        <PlainRow label="For">
          <select style={selectStyle}>
            <option>source · /Volumes/Photos-Drive</option>
            <option disabled>destination · sftp:// (remote — n/a)</option>
            <option>any local side of this job</option>
          </select>
        </PlainRow>
      </Question>

      <Question
        on={opts.logoff} onToggle={() => set('logoff', !opts.logoff)}
        label="Before I log off or shut down"
        helper="A last quick sync when the session ends. The OS gives a short grace window — best for small, fast jobs."
        accent={accent}
      />

      <Question
        on={opts.onstart} onToggle={() => set('onstart', !opts.onstart)}
        label="When the backend starts"
        helper="Adds the job to the queue every time the API process starts. Note: starting the app alone isn't enough — the backend has to start too."
        accent={accent}
      />

      <Divider />

      <div style={{ fontSize: 13, color: WF.inkSoft, marginBottom: 12 }}>
        Before each run, also…
      </div>

      <PlainRow label="Wait" inset>
        <Input value="2" suffix="min" />
        <span style={{ fontSize: 12, color: WF.inkSoft, marginLeft: 8 }}>
          if the local folder is busy with another sync. <span style={{ color: WF.inkMute }}>0 = give up immediately.</span>
        </span>
      </PlainRow>

      <PlainRow label="Skip" inset>
        <Input value="20" suffix="%" />
        <span style={{ fontSize: 12, color: WF.inkSoft, marginLeft: 8 }}>
          if more than this many files changed (guards against accidental mass deletes).
        </span>
      </PlainRow>

      <Divider />

      <div style={{ fontSize: 13, color: WF.inkSoft, marginBottom: 12 }}>
        And while it's running…
      </div>

      <PlainCheckRow accent={accent} on
        label="Run in the background, no prompts"
        sub="Errors land in the job's log instead of popping up."
      />
      <PlainCheckRow accent={accent}
        label="Clear the saved analyze tree after the sync finishes"
        sub="Keeps the project tidy on jobs that scan large directories."
      />

      <Note top={140} right={-180} width={160} rotate={2}>
        plain-language framing<br />for non-technical users.<br />schedule builder hides<br />cron entirely by default.
      </Note>
    </Modal>
  );
}

const selectStyle = {
  padding: '6px 10px', border: `1px solid ${WF.line}`, borderRadius: 5,
  background: WF.card, fontSize: 13, fontFamily: 'inherit', color: WF.ink,
};

function Question({ on, onToggle, label, helper, accent, children }) {
  return (
    <div style={{
      borderBottom: `1px solid ${WF.lineSoft}`,
      padding: '14px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ marginTop: 2 }}>
          <Checkbox on={on} accent={accent} onChange={onToggle} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: WF.ink }}>{label}</div>
          <div style={{ fontSize: 12, color: WF.inkMute, marginTop: 3, lineHeight: 1.45 }}>{helper}</div>
        </div>
      </div>
      {on && children && (
        <div style={{ marginTop: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function PlainRow({ label, inset, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      marginLeft: inset ? 0 : 28, marginBottom: 8,
    }}>
      <div style={{
        width: 60, fontSize: 12, color: WF.inkSoft, flex: '0 0 auto',
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

function PlainCheckRow({ label, sub, on, accent }) {
  const [v, setV] = React.useState(!!on);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0' }}>
      <div style={{ marginTop: 2 }}>
        <Checkbox on={v} accent={accent} onChange={setV} />
      </div>
      <div>
        <div style={{ fontSize: 13, color: WF.ink }}>{label}</div>
        <div style={{ fontSize: 12, color: WF.inkMute, marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

Object.assign(window, { DirectionC });
