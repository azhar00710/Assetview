import { useState } from 'react';
import { useTagDocuments } from '../../hooks/useApi';
import { C, M3, SC, STC } from '../../data/constants';

/**
 * TagDocumentPanel — Phase 0.5 Digital Index
 *
 * Shows linked P&ID documents for a selected equipment tag.
 * Appears as a side panel when an equipment tag is selected in the 3D viewer.
 *
 * Props:
 *   tag        — selected equipment tag string (e.g. "CV-019S")
 *   onClose    — callback to close the panel
 *   onOpenPnid — callback(doc) when user clicks a document to open it
 */
export default function TagDocumentPanel({ tag, onClose, onOpenPnid }) {
  const { data: documents, isLoading, error } = useTagDocuments(tag);
  const [expandedId, setExpandedId] = useState(null);

  if (!tag) return null;

  return (
    <div
      className="w-72 flex flex-col border-l border-white/[0.08] overflow-hidden shrink-0"
      style={{ background: M3.surfaceContainer }}
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-wide" style={{ color: M3.primary }}>
            LINKED DOCUMENTS
          </div>
          <div className="text-sm font-semibold mt-0.5 truncate" style={{ color: M3.onSurface }}>
            {tag}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 cursor-pointer shrink-0"
          style={{ color: M3.onSurfaceVariant }}
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="px-3 py-8 text-center">
            <div
              className="inline-block w-5 h-5 border-2 rounded-full animate-spin"
              style={{ borderColor: `${M3.primary}33`, borderTopColor: M3.primary }}
            />
            <div className="text-[11px] mt-2" style={{ color: M3.onSurfaceVariant }}>
              Loading documents...
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-6 text-center">
            <div className="text-[11px]" style={{ color: M3.error }}>
              Failed to load documents
            </div>
            <div className="text-[10px] mt-1" style={{ color: M3.onSurfaceVariant }}>
              {error.message}
            </div>
          </div>
        )}

        {!isLoading && !error && documents?.length === 0 && (
          <div className="px-3 py-8 text-center">
            <div className="text-2xl mb-2 opacity-30">&#128196;</div>
            <div className="text-[11px]" style={{ color: M3.onSurfaceVariant }}>
              No linked documents found for
            </div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: M3.onSurface }}>
              {tag}
            </div>
          </div>
        )}

        {!isLoading && documents?.length > 0 && (
          <div className="py-1">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                isExpanded={expandedId === doc.id}
                onToggle={() => setExpandedId(expandedId === doc.id ? null : doc.id)}
                onOpen={() => onOpenPnid?.(doc)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer summary */}
      {!isLoading && documents?.length > 0 && (
        <div
          className="px-3 py-2 border-t border-white/[0.06] shrink-0"
          style={{ background: `${M3.primary}08` }}
        >
          <div className="text-[9px]" style={{ color: M3.onSurfaceVariant }}>
            {documents.length} document{documents.length !== 1 ? 's' : ''} linked to {tag}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentCard({ doc, isExpanded, onToggle, onOpen }) {
  const typeColor = docTypeColor(doc.documentType);
  const statusColor = STC[doc.status] || M3.onSurfaceVariant;

  return (
    <div
      className="mx-2 my-1 rounded-lg border border-white/[0.06] overflow-hidden"
      style={{ background: M3.surfaceContainerHigh }}
    >
      {/* Card header — clickable to expand */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-1 h-8 rounded-full shrink-0"
            style={{ background: typeColor }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold truncate" style={{ color: M3.onSurface }}>
                {doc.documentRef || doc.drawingNumber || 'Untitled'}
              </span>
              <span
                className="text-[8px] px-1.5 rounded-full shrink-0"
                style={{ background: `${typeColor}20`, color: typeColor }}
              >
                {formatDocType(doc.documentType)}
              </span>
            </div>
            {doc.title && (
              <div className="text-[10px] truncate mt-0.5" style={{ color: M3.onSurfaceVariant }}>
                {doc.title}
              </div>
            )}
          </div>
          <span
            className="text-[10px] shrink-0 transition-transform"
            style={{
              color: M3.onSurfaceVariant,
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            &#9654;
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-2.5 pt-0.5 border-t border-white/[0.04]">
          <div className="space-y-1 mb-2.5">
            {doc.pageNumber != null && (
              <DetailRow label="Page" value={doc.pageNumber} />
            )}
            {doc.status && (
              <DetailRow
                label="Status"
                value={
                  <span style={{ color: statusColor }}>
                    {(doc.status || '').replace(/_/g, ' ')}
                  </span>
                }
              />
            )}
            {doc.revision && (
              <DetailRow label="Revision" value={`Rev ${doc.revision}`} />
            )}
            {doc.regionXPct != null && doc.regionYPct != null && (
              <DetailRow
                label="Region"
                value={`${Number(doc.regionXPct).toFixed(0)}%, ${Number(doc.regionYPct).toFixed(0)}%`}
              />
            )}
            {doc.systemCode && (
              <DetailRow
                label="System"
                value={
                  <span style={{ color: SC[doc.systemType] || M3.onSurface }}>
                    {doc.systemCode}
                  </span>
                }
              />
            )}
          </div>

          <button
            onClick={onOpen}
            className="w-full py-1.5 rounded-md text-[11px] font-semibold cursor-pointer transition-colors"
            style={{
              background: `${M3.primary}15`,
              color: M3.primary,
              border: `1px solid ${M3.primary}30`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = `${M3.primary}25`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = `${M3.primary}15`)}
          >
            Open P&ID
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span style={{ color: M3.onSurfaceVariant }}>{label}</span>
      <span style={{ color: M3.onSurface }}>{value}</span>
    </div>
  );
}

function docTypeColor(type) {
  switch (type) {
    case 'pnid':      return M3.primary;
    case 'isometric':  return M3.secondary;
    case 'datasheet':  return M3.tertiary;
    case 'manual':     return M3.warning;
    default:           return M3.onSurfaceVariant;
  }
}

function formatDocType(type) {
  switch (type) {
    case 'pnid':      return 'P&ID';
    case 'isometric':  return 'ISO';
    case 'datasheet':  return 'DS';
    case 'manual':     return 'MAN';
    default:           return (type || '').toUpperCase();
  }
}
