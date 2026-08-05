import { useState, memo } from 'react';
import { md, alpha } from '../../lib/theme';
import { useGenerationReadiness, useGenerateCanvas } from '../../hooks/useCanvasGeneration';
import PreviewMiniMap from './PreviewMiniMap';

const PANEL_WIDTH = 320;

function Badge({ color, children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 9,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 4,
        background: alpha(color, 0.15),
        color,
      }}
    >
      {children}
    </span>
  );
}

function ProgressBar({ pct, color }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: md.outlineVariant, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${Math.min(pct, 100)}%`,
          borderRadius: 2,
          background: color || '#3BE494',
          transition: 'width 0.3s',
        }}
      />
    </div>
  );
}

function SheetRow({ sheet }) {
  const coverageColor = sheet.coveragePct >= 80 ? '#3BE494' : sheet.coveragePct >= 40 ? '#F39C12' : '#E74C3C';

  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: `1px solid ${md.outlineVariant}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: md.onSurface, fontFamily: 'monospace' }}>
          {sheet.drawingNumber || 'Unknown'}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {sheet.hasOcr ? (
            <Badge color="#3BE494">AI</Badge>
          ) : (
            <Badge color={md.onSurfaceVariant}>Manual</Badge>
          )}
          <Badge color={coverageColor}>{sheet.coveragePct}%</Badge>
        </div>
      </div>

      <ProgressBar pct={sheet.coveragePct} color={coverageColor} />

      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 9, color: md.onSurfaceVariant }}>
        <span>{sheet.entitiesPlaced}/{sheet.entitiesTotal} entities</span>
        <span>{sheet.connectionAnnotations} connections</span>
        {sheet.ocrSuggestions > 0 && (
          <span style={{ color: '#3BE494' }}>{sheet.ocrSuggestions} suggestions</span>
        )}
      </div>
    </div>
  );
}

function GenerateCanvasPanel({ systemId, onClose }) {
  const [dryRun, setDryRun] = useState(false);
  const { data: readiness, isLoading } = useGenerationReadiness(systemId);
  const generateMutation = useGenerateCanvas();

  const handleGenerate = () => {
    generateMutation.mutate({ systemId, dryRun });
  };

  const overallColor = (readiness?.overallCoverage || 0) >= 80
    ? '#3BE494'
    : (readiness?.overallCoverage || 0) >= 40
    ? '#F39C12'
    : '#E74C3C';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        background: md.surfaceContainerLow,
        borderRight: `1px solid ${md.outlineVariant}`,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: `1px solid ${md.outlineVariant}`,
          background: md.surfaceContainer,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: md.onSurface, letterSpacing: '0.02em' }}>
          Generate Canvas
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: md.onSurfaceVariant,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 24, color: md.onSurfaceVariant, fontSize: 11 }}>
            Checking readiness...
          </div>
        ) : readiness ? (
          <>
            {/* Overall readiness */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Overall Readiness
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: overallColor }}>
                  {readiness.overallCoverage}%
                </span>
              </div>
              <ProgressBar pct={readiness.overallCoverage} color={overallColor} />
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: md.onSurfaceVariant }}>
                <span>{readiness.totalPlaced}/{readiness.totalEntities} entities</span>
                <span>{readiness.totalConnections} connections</span>
              </div>
            </div>

            {/* Per-sheet breakdown */}
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Sheets ({readiness.sheets?.length || 0})
              </span>
            </div>

            {readiness.sheets?.map(sheet => (
              <SheetRow key={sheet.pnidId} sheet={sheet} />
            ))}

            {/* Warnings */}
            {readiness.missingConnections?.length > 0 && (
              <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: alpha('#F39C12', 0.1) }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#F39C12', display: 'block', marginBottom: 4 }}>
                  Missing
                </span>
                {readiness.missingConnections.map((msg, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#F39C12', opacity: 0.8, paddingLeft: 8 }}>
                    {msg}
                  </div>
                ))}
              </div>
            )}

            {/* Generation result */}
            {generateMutation.isSuccess && (
              <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: alpha('#3BE494', 0.1) }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#3BE494', display: 'block', marginBottom: 4 }}>
                  {dryRun ? 'Preview' : 'Generated'}
                </span>
                <div style={{ fontSize: 9, color: '#3BE494' }}>
                  {generateMutation.data.edgesCreated} edges, {generateMutation.data.layoutPositions} positions
                </div>
                {generateMutation.data.warnings?.map((w, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#F39C12', marginTop: 2 }}>{w}</div>
                ))}
              </div>
            )}

            {/* Line list validation results */}
            {generateMutation.isSuccess && generateMutation.data.validation && (
              <div style={{ marginTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Line List Validation
                </span>

                {/* Matched connections */}
                <div style={{ marginTop: 6, padding: 6, borderRadius: 4, background: alpha('#3BE494', 0.08) }}>
                  <div style={{ fontSize: 9, color: '#3BE494', fontWeight: 600 }}>
                    {generateMutation.data.validation.matched}/{generateMutation.data.validation.total} connections match line list
                  </div>
                </div>

                {/* Validation warnings */}
                {generateMutation.data.validation.warnings?.length > 0 && (
                  <div style={{ marginTop: 4, padding: 6, borderRadius: 4, background: alpha('#F39C12', 0.08) }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#F39C12', marginBottom: 2 }}>
                      Unmatched Connections
                    </div>
                    {generateMutation.data.validation.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 8, color: '#F39C12', opacity: 0.8, paddingLeft: 6 }}>{w}</div>
                    ))}
                  </div>
                )}

                {/* Suggested missing connections */}
                {generateMutation.data.validation.suggestions?.length > 0 && (
                  <div style={{ marginTop: 4, padding: 6, borderRadius: 4, background: alpha('#2D33E0', 0.08) }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#2D33E0', marginBottom: 2 }}>
                      Suggested Connections ({generateMutation.data.validation.suggestions.length})
                    </div>
                    {generateMutation.data.validation.suggestions.slice(0, 5).map((s, i) => (
                      <div key={i} style={{ fontSize: 8, color: '#2D33E0', opacity: 0.8, paddingLeft: 6 }}>
                        {s.fromTag} → {s.toTag} (line {s.lineTag})
                      </div>
                    ))}
                    {generateMutation.data.validation.suggestions.length > 5 && (
                      <div style={{ fontSize: 8, color: '#2D33E0', opacity: 0.5, paddingLeft: 6, marginTop: 2 }}>
                        +{generateMutation.data.validation.suggestions.length - 5} more...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mini-map preview after dry-run */}
            {generateMutation.isSuccess && dryRun && generateMutation.data.preview && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Layout Preview
                  </span>
                </div>
                <PreviewMiniMap
                  positions={generateMutation.data.preview.positions}
                  edges={generateMutation.data.preview.edges}
                  width={PANEL_WIDTH - 24}
                  height={180}
                />
                <button
                  onClick={() => {
                    generateMutation.mutate({ systemId, dryRun: false });
                  }}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: `1px solid #3BE494`,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: alpha('#3BE494', 0.15),
                    color: '#3BE494',
                    transition: 'all 0.15s',
                  }}
                >
                  Apply — Generate Canvas
                </button>
              </div>
            )}

            {generateMutation.isError && (
              <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: alpha('#E74C3C', 0.1) }}>
                <span style={{ fontSize: 10, color: '#E74C3C' }}>
                  {generateMutation.error?.message || 'Generation failed'}
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 24, color: md.onSurfaceVariant, fontSize: 11 }}>
            No data available
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: `1px solid ${md.outlineVariant}`,
          background: md.surfaceContainer,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: md.onSurfaceVariant, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            style={{ accentColor: '#3BE494', width: 12, height: 12 }}
          />
          Preview only (dry run)
        </label>

        <button
          onClick={handleGenerate}
          disabled={!readiness?.canGenerate || generateMutation.isPending}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.02em',
            cursor: readiness?.canGenerate ? 'pointer' : 'not-allowed',
            background: readiness?.canGenerate ? '#3BE494' : md.outlineVariant,
            color: readiness?.canGenerate ? '#0D1F17' : md.onSurfaceVariant,
            opacity: generateMutation.isPending ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          {generateMutation.isPending
            ? 'Generating...'
            : dryRun
            ? 'Preview Canvas'
            : 'Generate Canvas'}
        </button>

        {!readiness?.canGenerate && readiness && (
          <span style={{ fontSize: 9, color: md.onSurfaceVariant, textAlign: 'center' }}>
            Place at least 2 entities and 1 connection to generate
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(GenerateCanvasPanel);
