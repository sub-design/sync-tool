// Human-friendly schedule builder — replaces raw cron in the UI.
// User picks a frequency tab; the body shows just the controls that matter
// for that frequency. Cron stays reachable behind an "Advanced" toggle for
// power users, with a live human-readable translation.

const SCHED_MODES = [
  { id: 'hourly',  label: 'Hourly'  },
  { id: 'daily',   label: 'Daily'   },
  { id: 'weekly',  label: 'Weekly'  },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom',  label: 'Custom'  },
];

const DOW = [
  { id: 'mon', short: 'M', full: 'Mon' },
  { id: 'tue', short: 'T', full: 'Tue' },
  { id: 'wed', short: 'W', full: 'Wed' },
  { id: 'thu', short: 'T', full: 'Thu' },
  { id: 'fri', short: 'F', full: 'Fri' },
  { id: 'sat', short: 'S', full: 'Sat' },
  { id: 'sun', short: 'S', full: 'Sun' },
];

function ScheduleBuilder({ accent = '#c2410c', compact = false, showPreview = true, defaultMode = 'daily' }) {
  const [mode, setMode] = React.useState(defaultMode);
  const [time, setTime] = React.useState('09:00');
  const [days, setDays] = React.useState(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [hourly, setHourly] = React.useState({ every: 6, atMinute: 0 });
  const [monthly, setMonthly] = React.useState({ day: 1 });
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const toggleDay = (id) => setDays(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id]);

  // human-readable summary + equivalent cron
  const summary = React.useMemo(() => {
    if (mode === 'hourly') {
      return {
        text: hourly.every === 1
          ? `Every hour, at :${String(hourly.atMinute).padStart(2, '0')}`
          : `Every ${hourly.every} hours, starting at :${String(hourly.atMinute).padStart(2, '0')}`,
        cron: `${hourly.atMinute} */${hourly.every} * * *`,
      };
    }
    if (mode === 'daily') {
      return { text: `Every day at ${time}`, cron: `${+time.slice(3)} ${+time.slice(0,2)} * * *` };
    }
    if (mode === 'weekly') {
      const sel = DOW.filter(d => days.includes(d.id));
      const txt = sel.length === 0 ? '— pick at least one day' :
        sel.length === 7 ? `Every day at ${time}` :
        `${sel.map(d => d.full).join(', ')} at ${time}`;
      return { text: txt, cron: `${+time.slice(3)} ${+time.slice(0,2)} * * ${sel.map(d => DOW.findIndex(x => x.id === d.id) + 1).join(',') || '*'}` };
    }
    if (mode === 'monthly') {
      const ord = ordinal(monthly.day);
      return { text: `On the ${ord} of every month at ${time}`, cron: `${+time.slice(3)} ${+time.slice(0,2)} ${monthly.day} * *` };
    }
    return { text: 'Custom cron expression', cron: '0 */6 * * *' };
  }, [mode, time, days, hourly, monthly]);

  return (
    <div>
      {/* segmented frequency tabs */}
      <div style={{
        display: 'inline-flex', padding: 3, background: WF.fill,
        border: `1px solid ${WF.lineSoft}`, borderRadius: 7, marginBottom: 14,
        gap: 2,
      }}>
        {SCHED_MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{
            padding: compact ? '4px 9px' : '5px 12px',
            fontSize: compact ? 11 : 12, fontWeight: 500,
            background: mode === m.id ? WF.card : 'transparent',
            color: mode === m.id ? WF.ink : WF.inkSoft,
            border: 'none', borderRadius: 5, cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: mode === m.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
          }}>{m.label}</button>
        ))}
      </div>

      {/* body */}
      <div style={{ marginBottom: 12 }}>
        {mode === 'hourly' && <HourlyBody value={hourly} onChange={setHourly} />}
        {mode === 'daily' && <DailyBody time={time} setTime={setTime} />}
        {mode === 'weekly' && <WeeklyBody days={days} toggleDay={toggleDay} time={time} setTime={setTime} accent={accent} />}
        {mode === 'monthly' && <MonthlyBody monthly={monthly} setMonthly={setMonthly} time={time} setTime={setTime} />}
        {mode === 'custom' && <CustomCronBody summary={summary} />}
      </div>

      {/* human-readable echo + next runs */}
      <div style={{
        padding: '10px 12px', background: WF.fillSoft,
        border: `1px solid ${WF.lineSoft}`, borderRadius: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ color: accent, fontSize: 14, lineHeight: 1.4 }}>↻</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: WF.ink, fontWeight: 500 }}>
              {summary.text}
            </div>
            {showPreview && (
              <div style={{ fontSize: 11, color: WF.inkMute, marginTop: 4, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
                next: {nextRunHints(mode, summary).join('  ·  ')}
              </div>
            )}
          </div>
          {mode !== 'custom' && (
            <button onClick={() => setAdvancedOpen(o => !o)} style={{
              fontSize: 11, color: WF.inkMute, background: 'transparent',
              border: 'none', cursor: 'pointer', padding: 2, textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}>{advancedOpen ? 'Hide cron' : 'Show as cron'}</button>
          )}
        </div>
        {advancedOpen && mode !== 'custom' && (
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${WF.lineSoft}`,
            fontSize: 11, color: WF.inkSoft,
          }}>
            Equivalent cron: <code style={{
              fontFamily: 'ui-monospace, SF Mono, monospace',
              background: WF.card, border: `1px solid ${WF.lineSoft}`,
              padding: '1px 6px', borderRadius: 3, color: WF.ink,
            }}>{summary.cron}</code>
          </div>
        )}
      </div>
    </div>
  );
}

function HourlyBody({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: WF.inkSoft }}>Every</span>
      <select value={value.every} onChange={e => onChange({ ...value, every: +e.target.value })} style={selectStyleS}>
        {[1,2,3,4,6,8,12].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <span style={{ fontSize: 13, color: WF.inkSoft }}>hour{value.every === 1 ? '' : 's'}, at minute</span>
      <select value={value.atMinute} onChange={e => onChange({ ...value, atMinute: +e.target.value })} style={selectStyleS}>
        {[0,15,30,45].map(n => <option key={n} value={n}>:{String(n).padStart(2,'0')}</option>)}
      </select>
    </div>
  );
}

function DailyBody({ time, setTime }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: WF.inkSoft }}>At</span>
      <input type="time" value={time} onChange={e => setTime(e.target.value)} style={timeInputStyle} />
      <span style={{ fontSize: 13, color: WF.inkSoft }}>every day</span>
    </div>
  );
}

function WeeklyBody({ days, toggleDay, time, setTime, accent }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {DOW.map(d => {
          const on = days.includes(d.id);
          return (
            <button key={d.id} onClick={() => toggleDay(d.id)} style={{
              width: 30, height: 30, borderRadius: 5,
              border: `1px solid ${on ? accent : WF.line}`,
              background: on ? accent : WF.card,
              color: on ? '#fff' : WF.inkSoft,
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'inherit',
            }} title={d.full}>{d.short}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: WF.inkSoft }}>at</span>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} style={timeInputStyle} />
      </div>
    </div>
  );
}

function MonthlyBody({ monthly, setMonthly, time, setTime }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: WF.inkSoft }}>On the</span>
      <select value={monthly.day} onChange={e => setMonthly({ day: +e.target.value })} style={selectStyleS}>
        {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
          <option key={n} value={n}>{ordinal(n)}</option>
        ))}
      </select>
      <span style={{ fontSize: 13, color: WF.inkSoft }}>of every month, at</span>
      <input type="time" value={time} onChange={e => setTime(e.target.value)} style={timeInputStyle} />
    </div>
  );
}

function CustomCronBody({ summary }) {
  const [cron, setCron] = React.useState(summary.cron);
  return (
    <div>
      <div style={{ fontSize: 12, color: WF.inkSoft, marginBottom: 6 }}>
        Power-user cron expression. Five fields: <code style={inlineMono}>min hour day month dow</code>
      </div>
      <input value={cron} onChange={e => setCron(e.target.value)} style={{
        width: '100%', padding: '8px 10px',
        border: `1px solid ${WF.line}`, borderRadius: 5,
        fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 13,
        background: WF.card, color: WF.ink, boxSizing: 'border-box',
      }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {[['Every hour','0 * * * *'],['Every 6 hours','0 */6 * * *'],['Weekdays 9am','0 9 * * 1-5'],['Sundays midnight','0 0 * * 0']].map(([l, c]) => (
          <button key={l} onClick={() => setCron(c)} style={{
            fontSize: 11, padding: '3px 8px',
            border: `1px solid ${WF.line}`, borderRadius: 10,
            background: WF.card, color: WF.inkSoft, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

const selectStyleS = {
  padding: '5px 8px', border: `1px solid ${WF.line}`, borderRadius: 5,
  background: WF.card, fontSize: 13, fontFamily: 'inherit', color: WF.ink,
};
const timeInputStyle = {
  padding: '5px 8px', border: `1px solid ${WF.line}`, borderRadius: 5,
  background: WF.card, fontSize: 13, fontFamily: 'inherit', color: WF.ink,
};
const inlineMono = {
  fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 11,
  background: WF.fill, padding: '1px 5px', borderRadius: 3, color: WF.inkSoft,
};

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function nextRunHints(mode, summary) {
  // simple fake "next runs" sample
  if (mode === 'hourly') return ['12:00', '18:00', '00:00'];
  if (mode === 'daily') return ['Tue 09:00', 'Wed 09:00', 'Thu 09:00'];
  if (mode === 'weekly') return ['Mon 09:00', 'Tue 09:00', 'Wed 09:00'];
  if (mode === 'monthly') return ['1 Jun 09:00', '1 Jul 09:00', '1 Aug 09:00'];
  return ['Tue 12:00', 'Tue 18:00', 'Wed 00:00'];
}

Object.assign(window, { ScheduleBuilder });
