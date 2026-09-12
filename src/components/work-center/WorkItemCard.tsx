import React from 'react';
import {
  Car,
  Users,
  Key,
  MapPin,
  AlertTriangle,
  ClipboardList,
  Clock,
  UserCheck,
  Calendar,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import type { WorkItem, WorkSourceModule } from '../../services/workItemService';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_SOURCE_MODULE_LABELS,
  isItemOverdue,
} from '../../services/workItemPolicy';
import { formatThaiDateTime } from '../../utils/dateTime';

interface WorkItemCardProps {
  key?: React.Key;
  item: WorkItem;
  isSelected?: boolean;
  onClick: () => void;
}

const sourceIconMap: Record<WorkSourceModule, React.ComponentType<{ className?: string }>> = {
  General: ClipboardList,
  Vehicle: Car,
  Contractor: Users,
  Key: Key,
  Patrol: MapPin,
  Incident: AlertTriangle,
};

const sourceColorMap: Record<WorkSourceModule, string> = {
  General: 'text-slate-600 bg-slate-100 border-slate-200',
  Vehicle: 'text-blue-700 bg-blue-50 border-blue-200',
  Contractor: 'text-amber-700 bg-amber-50 border-amber-200',
  Key: 'text-rose-700 bg-rose-50 border-rose-200',
  Patrol: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Incident: 'text-red-700 bg-red-50 border-red-200',
};

const statusBadgeMap: Record<
  WorkItem['status'],
  { label: string; style: string }
> = {
  Open: {
    label: WORK_ITEM_STATUS_LABELS.Open,
    style: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  Acknowledged: {
    label: WORK_ITEM_STATUS_LABELS.Acknowledged,
    style: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  InProgress: {
    label: WORK_ITEM_STATUS_LABELS.InProgress,
    style: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  Waiting: {
    label: WORK_ITEM_STATUS_LABELS.Waiting,
    style: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  Resolved: {
    label: WORK_ITEM_STATUS_LABELS.Resolved,
    style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  Closed: {
    label: WORK_ITEM_STATUS_LABELS.Closed,
    style: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

const priorityBadgeMap: Record<
  WorkItem['priority'],
  { label: string; style: string }
> = {
  Low: {
    label: WORK_ITEM_PRIORITY_LABELS.Low,
    style: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  Normal: {
    label: WORK_ITEM_PRIORITY_LABELS.Normal,
    style: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  High: {
    label: WORK_ITEM_PRIORITY_LABELS.High,
    style: 'bg-amber-100 text-amber-800 border-amber-300 font-bold',
  },
  Emergency: {
    label: WORK_ITEM_PRIORITY_LABELS.Emergency,
    style: 'bg-red-600 text-white border-red-700 font-black shadow-xs animate-pulse',
  },
};

/**
 * Formats the source label for card display, prioritizing human-readable labels
 * (e.g. incident type, contractor name, room number) over long technical UUIDs.
 */
function formatCardSourceLabel(sourceLabel?: string, moduleLabel?: string): string {
  if (!sourceLabel) return '';
  let trimmed = sourceLabel.trim();

  // If label contains parentheses with readable text, extract that:
  // e.g. "เหตุการณ์: INC_dc03cf90-700b-4f2a-a1de-9f4469114870 (น้ำท่วม/ท่อแตก)" -> "น้ำท่วม/ท่อแตก"
  const parenMatch = trimmed.match(/^(?:.*:\s*)?[A-Za-z0-9_.-]{8,}\s*\((.+)\)$/);
  if (parenMatch && parenMatch[1]) {
    trimmed = parenMatch[1].trim();
  }

  // Strip redundant module prefix if present (e.g. "ผู้รับเหมา: บ.เอซี" -> "บ.เอซี")
  if (moduleLabel) {
    trimmed = trimmed.replace(new RegExp(`^${moduleLabel}:\\s*`), '');
  }

  // Truncate raw technical UUID if still present without readable label:
  // e.g. "INC_dc03cf90-700b-4f2a-a1de-9f4469114870" -> "INC_dc03...4870"
  const uuidMatch = trimmed.match(/([A-Za-z0-9_]*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F-]{4,})/);
  if (uuidMatch && uuidMatch[1]) {
    const fullUuid = uuidMatch[1];
    const shortUuid = fullUuid.length > 14 ? `${fullUuid.slice(0, 8)}...${fullUuid.slice(-4)}` : fullUuid;
    trimmed = trimmed.replace(fullUuid, shortUuid);
  }

  return trimmed;
}

export default function WorkItemCard({
  item,
  isSelected,
  onClick,
}: WorkItemCardProps) {
  const SourceIcon = sourceIconMap[item.source_module] || ClipboardList;
  const sourceColor = sourceColorMap[item.source_module] || sourceColorMap.General;
  const statusBadge = statusBadgeMap[item.status] || statusBadgeMap.Open;
  const priorityBadge = priorityBadgeMap[item.priority] || priorityBadgeMap.Normal;
  const overdue = isItemOverdue(item);
  const moduleLabel = WORK_SOURCE_MODULE_LABELS[item.source_module];
  const displaySourceLabel = formatCardSourceLabel(item.source_label, moduleLabel);

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col justify-between rounded-2xl border bg-white p-4 sm:p-5 shadow-xs transition-all cursor-pointer hover:shadow-md active:scale-[0.99] select-none ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div>
        {/* Top bar: Source badge + Status badge + Priority */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span
              title={item.source_record_id ? `รหัสอ้างอิง: ${item.source_record_id}` : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${sourceColor}`}
            >
              <SourceIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{moduleLabel}</span>
              {displaySourceLabel && (
                <span className="text-xs opacity-90 font-normal truncate max-w-[200px] sm:max-w-xs">
                  • {displaySourceLabel}
                </span>
              )}
            </span>

            <span
              className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold ${priorityBadge.style}`}
            >
              {priorityBadge.label}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-black text-red-700">
                <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <span>เกินกำหนด</span>
              </span>
            )}
            <span
              className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold ${statusBadge.style}`}
            >
              {statusBadge.label}
            </span>
          </div>
        </div>

        {/* Title & Description preview */}
        <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition-colors">
          {item.title}
        </h3>

        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-slate-600 font-normal leading-relaxed">
            {item.description}
          </p>
        )}

        {/* Next Action Pill if present */}
        {item.next_action && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-2.5 text-sm text-blue-950">
            <ArrowRight className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
            <span className="font-semibold leading-snug line-clamp-2">
              ต่อไป: {item.next_action}
            </span>
          </div>
        )}
      </div>

      {/* Footer metadata */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          {/* Assignee */}
          <div className="flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
            {item.assigned_to ? (
              <span className="font-bold text-slate-800">
                {item.assigned_to === item.opened_by
                  ? item.opened_by_name
                  : item.assigned_to}
              </span>
            ) : (
              <span className="italic text-slate-500">ยังไม่มอบหมาย</span>
            )}
          </div>

          {/* Due date if set */}
          {item.due_at && (
            <div
              className={`flex items-center gap-1.5 ${
                overdue ? 'font-bold text-red-700' : 'text-slate-600'
              }`}
            >
              <Calendar className="h-4 w-4 shrink-0" />
              <span>{formatThaiDateTime(item.due_at)}</span>
            </div>
          )}
        </div>

        {/* Last activity timestamp */}
        <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>{formatThaiDateTime(item.last_activity_at || item.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}
