// The statistics dashboard. Lazy-loaded from App so Recharts lands in its own
// chunk and never touches the initial page load.
//
// Structure: a KPI header, then one section per domain (Prompts, Projekte,
// Tags, Nutzung, KI). Every card takes its data straight from the `/api/stats`
// payload — no aggregation happens here, which keeps this file a layout
// concern and makes new widgets a matter of dropping in another <ChartCard>.
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts'
import { useStats } from '../../state/queries'
import {
  formatChars,
  formatCost,
  formatDay,
  formatHours,
  formatCostOrDash,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSeconds,
  readableInk,
} from '../../lib/stats'
import type { SeriesPoint, Stats, StatsQuery } from '../../lib/types'
import { Icon } from '../ui'
import { CalendarHeatmap, RhythmHeatmap, TagCloud } from './Heatmaps'
import { RangePicker } from './RangePicker'
import { ChartCard, EmptyHint, MeterRow, SkeletonGrid, StatCard } from './primitives'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  hourLabelFormatter,
  statusFormatter,
  unitFormatter,
  useChartTheme,
} from './theme'

const CHART_HEIGHT = 240

export function StatsView({
  query,
  onQuery,
}: {
  query: StatsQuery
  onQuery: (next: StatsQuery) => void
}) {
  const theme = useChartTheme()
  const { data, isLoading, isError, error, refetch, isFetching } = useStats(query)

  return (
    <div className="stats-view">
      <RangePicker
        query={query}
        onChange={onQuery}
        onRefresh={() => refetch()}
        updatedAt={data?.generated_at}
      />

      {isError && (
        <p className="chart-empty">
          Statistiken konnten nicht geladen werden: {(error as Error)?.message ?? 'unbekannter Fehler'}
        </p>
      )}

      {isLoading && !data && <SkeletonGrid />}

      {data && (
        <div className={`stats-content${isFetching ? ' is-fetching' : ''}`}>
          <KpiHeader data={data} />
          <PromptSection data={data} theme={theme} />
          <ActivitySection data={data} theme={theme} />
          <ProjectSection data={data} theme={theme} />
          <TagSection data={data} theme={theme} />
          <OptimizationSection data={data} theme={theme} />
          <AiSection data={data} theme={theme} />
          <footer className="stats-foot">
            Zeitraum {new Date(data.range.from).toLocaleDateString('de-DE')} –{' '}
            {new Date(new Date(data.range.to).getTime() - 1).toLocaleDateString('de-DE')} · Zeitzone{' '}
            {data.range.timezone} · Vergleich mit der gleich langen Vorperiode
          </footer>
        </div>
      )}
    </div>
  )
}

type Theme = ReturnType<typeof useChartTheme>

/** Pull one metric out of a series for a KPI sparkline. */
function spark(series: SeriesPoint[], key: string): number[] {
  return series.map((point) => Number(point[key] ?? 0))
}

function KpiHeader({ data }: { data: Stats }) {
  const p = data.prompts
  const a = data.activity
  return (
    <div className="stats-kpis">
      <StatCard
        index={0}
        icon="add_circle"
        label="Prompts erstellt"
        value={formatNumber(p.created.value)}
        kpi={p.created}
        hint={`Ø ${formatNumber(p.per_day_avg)} pro Tag`}
        spark={spark(p.series, 'created')}
      />
      <StatCard
        index={1}
        icon="task_alt"
        label="Erledigt"
        value={formatNumber(p.completed.value)}
        kpi={p.completed}
        hint={`${formatPercent(p.completion_rate)} der erstellten`}
        spark={spark(p.series, 'completed')}
      />
      <StatCard
        index={2}
        icon="edit"
        label="Bearbeitungen"
        value={formatNumber(p.updated.value)}
        kpi={p.updated}
        spark={spark(p.series, 'updated')}
      />
      <StatCard
        index={3}
        icon="delete"
        label="Gelöscht"
        value={formatNumber(p.deleted.value)}
        kpi={p.deleted}
        invert
        spark={spark(p.series, 'deleted')}
      />
      <StatCard
        index={4}
        icon="terminal"
        label="CLI-Prompts"
        value={formatNumber(a.captured.value)}
        kpi={a.captured}
        hint={`${a.sessions} Sessions · Ø ${formatNumber(a.prompts_per_session)}/Session`}
        spark={spark(a.series, 'cli')}
      />
      <StatCard
        index={5}
        icon="local_fire_department"
        label="Aktuelle Serie"
        value={`${a.streak_current} ${a.streak_current === 1 ? 'Tag' : 'Tage'}`}
        hint={`Rekord ${a.streak_longest} Tage · ${a.total_active_days} aktive Tage gesamt`}
      />
      <StatCard
        index={6}
        icon="hourglass_top"
        label="Ø Durchlaufzeit"
        value={formatHours(p.lead_time_hours.avg)}
        hint={
          p.lead_time_hours.count
            ? `Median ${formatHours(p.lead_time_hours.median)} · ${p.lead_time_hours.count} Prompts`
            : 'Erstellung bis Ausführung'
        }
      />
      <StatCard
        index={7}
        icon="inbox"
        label="Offener Backlog"
        value={formatNumber(p.backlog)}
        hint={`${p.blocked} blockiert · ${p.bookmarked} gemerkt`}
      />
    </div>
  )
}

function SectionHead({ icon, title, note }: { icon: string; title: string; note?: string }) {
  return (
    <div className="stats-section-head">
      <h2>
        <Icon name={icon} />
        {title}
      </h2>
      {note && <span>{note}</span>}
    </div>
  )
}

function PromptSection({ data, theme }: { data: Stats; theme: Theme }) {
  const p = data.prompts
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  const donut = p.status_distribution.filter((row) => row.count > 0)

  return (
    <section className="stats-section">
      <SectionHead icon="bolt" title="Prompts" note={`${p.total} aktive Prompts insgesamt`} />
      <div className="stats-grid">
        <ChartCard
          index={0}
          wide
          title="Aktivität im Zeitverlauf"
          subtitle="Erstellt, erledigt, bearbeitet und gelöscht je Intervall"
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <AreaChart data={p.series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.primary} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={theme.primary} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-done" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STATUS_COLORS.done} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={STATUS_COLORS.done} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={18} />
              <YAxis {...axis} width={38} allowDecimals={false} />
              <Tooltip {...theme.tooltip} />
              <Area
                type="monotone"
                dataKey="created"
                name="Erstellt"
                stroke={theme.primary}
                fill="url(#grad-created)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="completed"
                name="Erledigt"
                stroke={STATUS_COLORS.done}
                fill="url(#grad-done)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="updated"
                name="Bearbeitet"
                stroke={theme.tertiary}
                fill="transparent"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Area
                type="monotone"
                dataKey="deleted"
                name="Gelöscht"
                stroke={theme.error}
                fill="transparent"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={1} title="Statusverteilung" subtitle="Alle Prompts, Momentaufnahme">
          {donut.length ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="count"
                  nameKey="status"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {donut.map((row) => (
                    <Cell key={row.status} fill={STATUS_COLORS[row.status]} />
                  ))}
                </Pie>
                <Tooltip {...theme.tooltip} formatter={statusFormatter} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="Noch keine Prompts." />
          )}
          <ul className="legend-list">
            {p.status_distribution.map((row) => (
              <li key={row.status}>
                <i style={{ background: STATUS_COLORS[row.status] }} />
                {STATUS_LABELS[row.status]}
                <b>{row.count}</b>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard
          index={2}
          title="Prompt-Längen"
          subtitle={`Ø ${formatChars(p.length.avg)} Zeichen · Median ${formatChars(p.length.median)}`}
        >
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={p.length.histogram} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} width={44} allowDecimals={false} />
              <Tooltip {...theme.tooltip} formatter={unitFormatter('Prompts')} />
              <Bar dataKey="count" name="Prompts" fill={theme.primary} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="extremes">
            {p.length.longest && (
              <span title={p.length.longest.title}>
                <Icon name="north_east" /> Längster: {formatChars(p.length.longest.chars)} Z. —{' '}
                {p.length.longest.title}
              </span>
            )}
            {p.length.shortest && (
              <span title={p.length.shortest.title}>
                <Icon name="south_east" /> Kürzester: {formatChars(p.length.shortest.chars)} Z. —{' '}
                {p.length.shortest.title}
              </span>
            )}
          </div>
        </ChartCard>

        <ChartCard index={3} title="Qualität & Fluss" subtitle="Anteile am aktuellen Bestand">
          <div className="meter-list">
            <MeterRow
              label="Getestet"
              value={p.tested}
              total={Math.max(p.status_distribution.find((r) => r.status === 'done')?.count ?? 0, 1)}
              color={STATUS_COLORS.done}
            />
            <MeterRow label="Im Backlog" value={p.backlog} total={p.total} color={STATUS_COLORS.queued} />
            <MeterRow label="Blockiert" value={p.blocked} total={p.total} color={STATUS_COLORS.failed} />
            <MeterRow label="Gemerkt" value={p.bookmarked} total={p.total} color={theme.tertiary} />
          </div>
          <dl className="fact-list">
            <div>
              <dt>Testquote</dt>
              <dd>{formatPercent(p.tested_rate)}</dd>
            </div>
            <div>
              <dt>Ø pro aktivem Tag</dt>
              <dd>{formatNumber(p.per_active_day_avg)}</dd>
            </div>
            <div>
              <dt>Median Durchlauf</dt>
              <dd>{formatHours(p.lead_time_hours.median)}</dd>
            </div>
          </dl>
        </ChartCard>
      </div>
    </section>
  )
}

function ActivitySection({ data, theme }: { data: Stats; theme: Theme }) {
  const a = data.activity
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  return (
    <section className="stats-section">
      <SectionHead
        icon="calendar_month"
        title="Nutzung"
        note={
          a.peak_weekday
            ? `Aktivster Tag: ${a.peak_weekday} · aktivste Stunde: ${String(a.peak_hour).padStart(2, '0')}:00 Uhr`
            : undefined
        }
      />
      <div className="stats-grid">
        <ChartCard
          index={0}
          wide
          title="Aktivitätskalender"
          subtitle="Jede Zelle ein Tag — Prompt-Ereignisse und CLI-Prompts zusammen"
        >
          <CalendarHeatmap days={a.calendar} accent={theme.primary} />
        </ChartCard>

        <ChartCard index={1} wide title="Wochenrhythmus" subtitle="Wochentag × Tageszeit">
          <RhythmHeatmap cells={a.heatmap} accent={theme.primary} />
        </ChartCard>

        <ChartCard index={2} title="Wochentage" subtitle="Verteilung über die Woche">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <RadarChart data={a.by_weekday} outerRadius="72%">
              <PolarGrid stroke={theme.grid} />
              <PolarAngleAxis dataKey="weekday" tick={{ fill: theme.textDim, fontSize: 12 }} />
              <Tooltip {...theme.tooltip} formatter={unitFormatter('Aktivitäten')} />
              <Radar
                name="Aktivitäten"
                dataKey="count"
                stroke={theme.primary}
                fill={theme.primary}
                fillOpacity={0.28}
              />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={3} title="Tageszeiten" subtitle="Wann gearbeitet wird">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={a.by_hour} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} interval={2} />
              <YAxis {...axis} width={44} allowDecimals={false} />
              <Tooltip
                {...theme.tooltip}
                formatter={unitFormatter('Aktivitäten')}
                labelFormatter={hourLabelFormatter}
              />
              <Bar dataKey="count" name="Aktivitäten" radius={[6, 6, 0, 0]}>
                {a.by_hour.map((row) => (
                  <Cell
                    key={row.hour}
                    fill={row.hour === a.peak_hour ? theme.tertiary : theme.primary}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={4} title="Serien & Sessions" subtitle="Kontinuität und CLI-Nutzung">
          <div className="streak-row">
            <div className="streak-box">
              <span className="streak-value">{a.streak_current}</span>
              <span className="streak-label">Tage aktuelle Serie</span>
            </div>
            <div className="streak-box">
              <span className="streak-value">{a.streak_longest}</span>
              <span className="streak-label">Tage längste Serie</span>
            </div>
          </div>
          <div className="meter-list">
            <MeterRow
              label="Aktive Tage im Zeitraum"
              value={a.active_days}
              total={Math.max(a.range_days, 1)}
              color={theme.primary}
            />
          </div>
          <dl className="fact-list">
            <div>
              <dt>CLI-Sessions</dt>
              <dd>{formatNumber(a.sessions)}</dd>
            </div>
            <div>
              <dt>Prompts/Session</dt>
              <dd>{formatNumber(a.prompts_per_session)}</dd>
            </div>
            <div>
              <dt>Session-Dauer</dt>
              <dd>{a.session_minutes_median ? formatHours(a.session_minutes_median / 60) : '–'}</dd>
            </div>
            <div>
              <dt>Bester Tag</dt>
              <dd title={a.busiest_day ? formatDay(a.busiest_day.date) : undefined}>
                {a.busiest_day ? `${a.busiest_day.count}` : '–'}
              </dd>
            </div>
          </dl>
        </ChartCard>
      </div>
    </section>
  )
}

function ProjectSection({ data, theme }: { data: Stats; theme: Theme }) {
  const p = data.projects
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  return (
    <section className="stats-section">
      <SectionHead
        icon="folder"
        title="Projekte"
        note={`${p.total} Projekte · ${p.active} im Zeitraum aktiv`}
      />
      <div className="stats-grid">
        <ChartCard index={0} title="Meiste Prompts" subtitle="Bestand je Projekt">
          {p.top_by_prompts.length ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={p.top_by_prompts}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={110} interval={0} />
                <Tooltip {...theme.tooltip} formatter={unitFormatter('Prompts')} />
                <Bar dataKey="count" name="Prompts" radius={[0, 6, 6, 0]}>
                  {p.top_by_prompts.map((row) => (
                    <Cell key={String(row.id)} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="Noch keine Projekte." />
          )}
        </ChartCard>

        <ChartCard index={1} title="Meiste Änderungen" subtitle="Ereignisse im gewählten Zeitraum">
          {p.top_by_activity.length ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={p.top_by_activity}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={110} interval={0} />
                <Tooltip {...theme.tooltip} formatter={unitFormatter('Ereignisse')} />
                <Bar dataKey="count" name="Ereignisse" radius={[0, 6, 6, 0]}>
                  {p.top_by_activity.map((row) => (
                    <Cell key={String(row.id)} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="Keine Änderungen in diesem Zeitraum." />
          )}
        </ChartCard>

        <ChartCard index={2} title="Portfolio" subtitle="Flächenanteil = Prompts je Projekt">
          {p.treemap.length ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <Treemap
                data={p.treemap}
                dataKey="value"
                animationDuration={600}
                content={<TreemapTile />}
              >
                <Tooltip {...theme.tooltip} formatter={unitFormatter('Prompts')} />
              </Treemap>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="Noch keine Projektzuordnung." />
          )}
        </ChartCard>

        <ChartCard index={3} title="Zuletzt verwendet" subtitle="Nach letzter Aktivität">
          {p.recent.length ? (
            <ul className="recent-list">
              {p.recent.map((row) => (
                <li key={String(row.id)}>
                  <i style={{ background: row.color }} />
                  <span className="recent-name">{row.name}</span>
                  <span className="recent-meta">{row.prompts} Prompts</span>
                  <time>{formatRelative(row.at)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint text="Noch keine Aktivität." />
          )}
        </ChartCard>
      </div>
    </section>
  )
}

/** Treemap tile: Recharts hands over geometry, we draw the MD3 look. */
function TreemapTile(props: Record<string, unknown> = {}) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const width = Number(props.width ?? 0)
  const height = Number(props.height ?? 0)
  const name = String(props.name ?? '')
  const value = Number(props.value ?? 0)
  const fill = String(props.color ?? props.fill ?? '#6750A4')
  // Recharts also renders the tree ROOT (depth 0) — a full-size tile holding
  // the grand total that would peek through the gaps between the real ones.
  if (Number(props.depth ?? 1) === 0) return <g />
  const showLabel = width > 62 && height > 28
  // Ink is chosen per tile (project colours are user-defined). `stroke="none"`
  // is essential: anything inherited would outline the glyphs and turn the
  // label into mush — the tile border is drawn by the rect, not by the group.
  const ink = readableInk(fill)
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={10}
        fill={fill}
        stroke="var(--md-surface-container)"
        strokeWidth={2}
      />
      {showLabel && (
        <>
          <text
            x={x + 10}
            y={y + 21}
            fill={ink}
            stroke="none"
            fontSize={13}
            fontWeight={700}
          >
            {name.length > 16 ? `${name.slice(0, 15)}…` : name}
          </text>
          <text
            x={x + 10}
            y={y + 37}
            fill={ink}
            stroke="none"
            fontSize={11.5}
            fontWeight={500}
            opacity={0.88}
          >
            {value}
          </text>
        </>
      )}
    </g>
  )
}

function TagSection({ data, theme }: { data: Stats; theme: Theme }) {
  const t = data.tags
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  const tagged = useMemo(
    () => Math.max(data.prompts.total - t.untagged, 0),
    [data.prompts.total, t.untagged],
  )
  return (
    <section className="stats-section">
      <SectionHead
        icon="sell"
        title="Tags"
        note={`${t.total} verschiedene Tags · ${t.untagged} Prompts ohne Tag`}
      />
      <div className="stats-grid">
        <ChartCard index={0} title="Meistgenutzte Tags" subtitle="Gesamtbestand">
          {t.top.length ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={t.top}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="tag" {...axis} width={100} interval={0} />
                <Tooltip {...theme.tooltip} formatter={unitFormatter('Prompts')} />
                <Bar dataKey="count" name="Prompts" fill={theme.tertiary} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="Noch keine Tags vergeben." />
          )}
        </ChartCard>

        <ChartCard index={1} title="Tag-Wolke" subtitle="Größe = Häufigkeit">
          <TagCloud tags={t.cloud} accent={theme.primary} />
        </ChartCard>

        <ChartCard index={2} title="Vokabular-Wachstum" subtitle="Kumulierte Anzahl verschiedener Tags">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={t.growth} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} width={44} allowDecimals={false} />
              <Tooltip {...theme.tooltip} formatter={unitFormatter('Tags')} />
              <Line
                type="monotone"
                dataKey="total"
                name="Tags"
                stroke={theme.primary}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={3} title="Neu & kombiniert" subtitle="Im gewählten Zeitraum erstmals verwendet">
          <div className="meter-list">
            <MeterRow label="Prompts mit Tag" value={tagged} total={Math.max(data.prompts.total, 1)} color={theme.primary} />
          </div>
          {t.new_list.length ? (
            <div className="chip-row">
              {t.new_list.map((tag) => (
                <span key={tag} className="tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <EmptyHint text="Keine neuen Tags in diesem Zeitraum." />
          )}
          {t.pairs.length > 0 && (
            <ul className="pair-list">
              {t.pairs.map((pair) => (
                <li key={`${pair.a}-${pair.b}`}>
                  <span>
                    {pair.a} <Icon name="add" /> {pair.b}
                  </span>
                  <b>{pair.count}×</b>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </section>
  )
}

function OptimizationSection({ data, theme }: { data: Stats; theme: Theme }) {
  const opt = data.optimization
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  if (!opt) return null
  // Everything below is the provider's own reported figure. Saying so once, in
  // the section head, beats an asterisk on every number — and the difference
  // matters: nobody should read these as our estimate.
  const note =
    `${opt.lifetime_prompts} Prompts optimiert · ${opt.lifetime_attempts} Versuche · ` +
    `${opt.lifetime_repeated} mehrfach · ${formatCost(opt.lifetime_cost)} ` +
    `(${opt.currency}, von der Claude-CLI gemeldet)`
  return (
    <section className="stats-section">
      <SectionHead icon="auto_awesome" title="Prompt-Optimierung" note={note} />
      <div className="stats-grid">
        <ChartCard
          index={0}
          title="Umfang & Kosten"
          subtitle="Im gewählten Zeitraum"
        >
          <dl className="fact-list">
            <div>
              <dt>optimierte Prompts</dt>
              <dd>{formatNumber(opt.prompts_optimized)}</dd>
            </div>
            <div>
              <dt>Versuche</dt>
              <dd>{formatNumber(opt.attempts.value)}</dd>
            </div>
            <div>
              <dt>Kosten gesamt</dt>
              <dd>{formatCost(opt.cost_total)}</dd>
            </div>
            <div>
              <dt>je Prompt</dt>
              <dd>{formatCostOrDash(opt.cost_per_prompt)}</dd>
            </div>
            <div>
              <dt>je Versuch</dt>
              <dd>{formatCostOrDash(opt.cost_per_attempt)}</dd>
            </div>
          </dl>
          {/* Only rendered when there is something to admit — a permanent
              "0 ohne Kostenmeldung" would be noise pretending to be a metric. */}
          {opt.cost_unpriced > 0 && (
            <p className="stats-note">
              {opt.cost_unpriced} Versuch{opt.cost_unpriced === 1 ? '' : 'e'} ohne
              Kostenmeldung der CLI — als „nicht erfasst" geführt, nicht als 0 gewertet.
            </p>
          )}
        </ChartCard>

        <ChartCard index={1} title="Ergebnis" subtitle="Erfolg und Übernahme">
          <div className="streak-row">
            <div className="streak-box">
              <span className="streak-value">{formatPercent(opt.success_rate)}</span>
              <span className="streak-label">Erfolgsquote</span>
            </div>
            <div className="streak-box">
              <span className="streak-value">{formatPercent(opt.accept_rate)}</span>
              <span className="streak-label">Übernahmequote</span>
            </div>
            <div className="streak-box">
              <span className="streak-value">{formatSeconds(opt.avg_duration_s)}</span>
              <span className="streak-label">Ø Dauer</span>
            </div>
          </div>
          <ul className="legend-list">
            <li>
              <i style={{ background: STATUS_COLORS.done }} />
              übernommen
              <b>{opt.applied}</b>
            </li>
            <li>
              <i style={{ background: STATUS_COLORS.queued }} />
              verworfen
              <b>{opt.discarded}</b>
            </li>
            <li>
              <i style={{ background: theme.tertiary }} />
              offen
              <b>{opt.pending}</b>
            </li>
            <li>
              <i style={{ background: STATUS_COLORS.failed }} />
              fehlgeschlagen
              <b>{opt.failed}</b>
            </li>
          </ul>
          {opt.length_factor != null && (
            <p className="stats-note">
              Übernommene Fassungen sind im Median {opt.length_factor.toLocaleString('de-DE')}×
              so lang wie das Original.
            </p>
          )}
        </ChartCard>

        <ChartCard index={2} title="Kosten je Modell" subtitle="Nur erfolgreiche Versuche">
          {opt.by_model.length === 0 ? (
            <p className="stats-note">Kein erfolgreicher Versuch im Zeitraum.</p>
          ) : (
            <ul className="recent-list">
              {opt.by_model.map((row) => (
                <li key={row.model}>
                  <i style={{ background: theme.primary }} />
                  <span className="recent-name">{row.model}</span>
                  <span className="recent-meta">Ø {formatCostOrDash(row.cost_avg)}</span>
                  <time>{formatCost(row.cost)}</time>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        {opt.top_prompts.length > 0 && (
          <ChartCard
            index={3}
            title="Teuerste Prompts"
            subtitle="Einzelwerte je Prompt im Zeitraum"
          >
            <ul className="recent-list">
              {opt.top_prompts.map((row) => (
                <li key={row.prompt_id}>
                  <i style={{ background: theme.tertiary }} />
                  <span className="recent-name">{row.title || `#${row.prompt_id}`}</span>
                  <span className="recent-meta">
                    {row.attempts > 1 ? `${row.attempts} Versuche` : '1 Versuch'}
                  </span>
                  <time>{formatCost(row.cost)}</time>
                </li>
              ))}
            </ul>
          </ChartCard>
        )}

        <ChartCard index={4} wide title="Ausgaben je Intervall" subtitle="Prompt-Optimierungen">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <AreaChart data={opt.cost_series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-opt-cost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.primary} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={theme.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={18} />
              <YAxis {...axis} width={52} tickFormatter={(v) => `$${v}`} />
              <Tooltip {...theme.tooltip} formatter={unitFormatter('Kosten', formatCost)} />
              <Area
                type="monotone"
                dataKey="cost"
                name="Kosten"
                stroke={theme.primary}
                fill="url(#grad-opt-cost)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  )
}

function AiSection({ data, theme }: { data: Stats; theme: Theme }) {
  const ai = data.ai
  const axis = { stroke: theme.textDim, fontSize: 11, tickLine: false, axisLine: false }
  if (!ai) return null
  return (
    <section className="stats-section">
      <SectionHead
        icon="smart_toy"
        title="KI-Runs"
        note={`${ai.lifetime_runs} Runs insgesamt · ${formatCost(ai.lifetime_cost)} Gesamtkosten`}
      />
      <div className="stats-grid">
        <ChartCard index={0} wide title="Kostenentwicklung" subtitle="Claude-Code-Runs je Intervall">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <AreaChart data={ai.cost_series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-cost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.tertiary} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={theme.tertiary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={18} />
              <YAxis {...axis} width={52} tickFormatter={(v) => `$${v}`} />
              <Tooltip {...theme.tooltip} formatter={unitFormatter('Kosten', formatCost)} />
              <Area
                type="monotone"
                dataKey="cost"
                name="Kosten"
                stroke={theme.tertiary}
                fill="url(#grad-cost)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={1} title="Zuverlässigkeit" subtitle="Abgeschlossene Runs im Zeitraum">
          <div className="streak-row">
            <div className="streak-box">
              <span className="streak-value">{formatPercent(ai.success_rate)}</span>
              <span className="streak-label">Erfolgsquote</span>
            </div>
            <div className="streak-box">
              <span className="streak-value">{formatSeconds(ai.avg_duration_s)}</span>
              <span className="streak-label">Ø Laufzeit</span>
            </div>
          </div>
          <ul className="legend-list">
            {ai.by_status.map((row) => (
              <li key={row.status}>
                <i
                  style={{
                    background:
                      row.status === 'succeeded'
                        ? STATUS_COLORS.done
                        : row.status === 'failed'
                          ? STATUS_COLORS.failed
                          : STATUS_COLORS.queued,
                  }}
                />
                {row.status}
                <b>{row.count}</b>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard index={2} title="Kosten & Modelle" subtitle="Im gewählten Zeitraum">
          <dl className="fact-list">
            <div>
              <dt>Kosten</dt>
              <dd>{formatCost(ai.cost_total)}</dd>
            </div>
            <div>
              <dt>je Run</dt>
              <dd>{formatCost(ai.cost_per_run)}</dd>
            </div>
            <div>
              <dt>Runs</dt>
              <dd>{formatNumber(ai.runs.value)}</dd>
            </div>
            <div>
              <dt>Schritte</dt>
              <dd>{formatNumber(ai.steps)}</dd>
            </div>
          </dl>
          <ul className="legend-list">
            {ai.by_model.map((row) => (
              <li key={row.model}>
                <i style={{ background: theme.primary }} />
                {row.model}
                <b>{row.count}</b>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
    </section>
  )
}

export default StatsView
