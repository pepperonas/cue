// Der Ablaufplan als selbst gezeichnetes SVG.
//
// Warum nicht Mermaid: die KI müsste dann Syntax liefern, und ein Tippfehler
// des Modells zerlegt die Grafik ohne Rückfallebene. Hier kommt geprüfte
// Struktur herein (`analysis/schema.py` hat unbekannte IDs und Widersprüche
// schon entfernt), das Zeichnen selbst kann nicht mehr scheitern.
//
// ⚠️ `var(--md-*)` löst in SVG-Präsentationsattributen auf — deshalb folgt die
// Grafik dem Theme ohne eine einzige feste Farbe.
import { layoutGraph, umbrechen, type AnalysisResult } from '../../lib/analysis'

const PRO_ZEILE = 24
const ZEILEN = 2

export function FlowGraph({
  result,
  titel,
  onSelect,
}: {
  result: AnalysisResult
  titel: Map<number, string>
  onSelect?: (promptId: number) => void
}) {
  const graph = layoutGraph(result, titel)
  if (graph.nodes.length === 0) {
    return <p className="muted">Für diesen Vorschlag gibt es nichts zu zeichnen.</p>
  }

  return (
    <div className="flow-wrap">
      <svg
        className="flow"
        viewBox={`0 0 ${graph.width} ${graph.height}`}
        width={graph.width}
        height={graph.height}
        role="img"
        aria-label={`Ablaufplan mit ${graph.nodes.length} Schritten in ${graph.phasen.length} Phasen`}
      >
        <defs>
          <marker
            id="flow-pfeil"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--md-outline)" />
          </marker>
        </defs>

        {graph.phasen.map((phase, i) => (
          <g key={`${phase.name}-${i}`}>
            <text x={phase.x} y={22} className="flow-phase">
              {phase.name}
            </text>
            <line
              x1={phase.x}
              y1={30}
              x2={phase.x + phase.w}
              y2={30}
              stroke="var(--md-outline-variant)"
              strokeWidth={2}
            />
          </g>
        ))}

        {/* Kanten zuerst: sie gehören HINTER die Karten, sonst zieht eine Linie
            quer über den Text, den sie verbinden soll. */}
        {graph.edges.map((kante) => (
          <path
            key={`${kante.von}-${kante.nach}`}
            d={kante.d}
            fill="none"
            stroke="var(--md-outline)"
            strokeWidth={1.5}
            markerEnd="url(#flow-pfeil)"
          >
            {kante.grund ? <title>{kante.grund}</title> : null}
          </path>
        ))}

        {graph.nodes.map((node) => (
          <g
            key={node.id}
            className="flow-node"
            transform={`translate(${node.x} ${node.y})`}
            onClick={onSelect ? () => onSelect(node.id) : undefined}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(node.id)
                    }
                  }
                : undefined
            }
          >
            <rect
              width={node.w}
              height={node.h}
              rx={12}
              fill="var(--md-surface-container-high)"
              stroke="var(--md-outline-variant)"
            />
            <circle cx={16} cy={node.h / 2} r={10} fill="var(--md-secondary-container)" />
            <text x={16} y={node.h / 2} className="flow-rang">
              {node.rang}
            </text>
            {umbrechen(node.label, PRO_ZEILE, ZEILEN).map((zeile, i, alle) => (
              <text
                key={i}
                x={32}
                y={node.h / 2 + (i - (alle.length - 1) / 2) * 13}
                className="flow-label"
              >
                {zeile}
              </text>
            ))}
            <title>{node.label}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}
