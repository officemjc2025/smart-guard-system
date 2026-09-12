/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  ExternalLink,
  PlusCircle,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  AlertCircle,
  History,
} from 'lucide-react';
import type {
  WorkItem,
  WorkItemPriority,
  WorkSourceModule,
} from '../../services/workItemService';
import { subscribeWorkItemsForSource } from '../../services/workItemService';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  findDuplicateActiveWorkItem,
  findLatestCompletedWorkItem,
  isItemOverdue,
  isSupervisor,
} from '../../services/workItemPolicy';
import { formatThaiDateTime } from '../../utils/dateTime';
import WorkItemCreateDialog from './WorkItemCreateDialog';
import WorkItemDetailDialog from './WorkItemDetailDialog';

export interface SourceWorkItemActionProps {
  siteId: string;
  sourceModule: WorkSourceModule;
  sourceRecordId: string;
  sourceLabel: string;
  defaultTitle: string;
  defaultDescription?: string;
  defaultPriority?: WorkItemPriority;
  operatorUid: string;
  operatorName: string;
  role: string;
  onOpenWorkCenter?: (workItemId?: string) => void;
  className?: string;
  compact?: boolean;
}

export default function SourceWorkItemAction({
  siteId,
  sourceModule,
  sourceRecordId,
  sourceLabel,
  defaultTitle,
  defaultDescription = '',
  defaultPriority = 'Normal',
  operatorUid,
  operatorName,
  role,
  onOpenWorkCenter,
  className = '',
  compact = false,
}: SourceWorkItemActionProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  useEffect(() => {
    if (!siteId || !sourceRecordId.trim() || sourceModule === 'General') {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    const unsubscribe = subscribeWorkItemsForSource(
      siteId,
      sourceModule,
      sourceRecordId.trim(),
      fetchedItems => {
        setItems(fetchedItems);
        setIsLoading(false);
        setSelectedItem(prev => {
          if (!prev) return null;
          return fetchedItems.find(i => i.work_item_id === prev.work_item_id) || prev;
        });
      },
      err => {
        console.error('Source WorkItems subscription error:', err);
        setLoadError('ไม่สามารถโหลดงานติดตามได้ กรุณาลองใหม่อีกครั้ง');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [siteId, sourceModule, sourceRecordId]);

  const activeItem = findDuplicateActiveWorkItem(items, sourceModule, sourceRecordId);
  const latestCompleted = findLatestCompletedWorkItem(items, sourceModule, sourceRecordId);

  const handleOpenDetail = (item: WorkItem) => {
    if (onOpenWorkCenter) {
      onOpenWorkCenter(item.work_item_id);
    } else {
      setSelectedItem(item);
      setIsDetailOpen(true);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-slate-400 py-1.5 ${className}`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
        <span>กำลังตรวจสอบสถานะงานติดตาม...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg ${className}`}>
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Case 1: Active Work Item Exists */}
      {activeItem ? (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/80 dark:bg-blue-950/40 p-3.5 flex flex-col gap-2.5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-xs sm:text-sm font-bold text-blue-950 dark:text-blue-100">
                งานติดตาม: {WORK_ITEM_STATUS_LABELS[activeItem.status] || activeItem.status}
              </span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  activeItem.priority === 'Emergency'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300'
                    : activeItem.priority === 'High'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                }`}
              >
                {WORK_ITEM_PRIORITY_LABELS[activeItem.priority] || activeItem.priority}
              </span>
              {isItemOverdue(activeItem) && (
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
                  เกินกำหนด
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleOpenDetail(activeItem)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>เปิดงานติดตาม</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-blue-100 dark:border-blue-900/40">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>
                ผู้รับผิดชอบ: <strong className="text-slate-900 dark:text-slate-100">{activeItem.assigned_to ? (activeItem.assigned_to === operatorUid ? `ตนเอง (${operatorName})` : activeItem.assigned_to) : 'ยังไม่มอบหมาย'}</strong>
              </span>
            </div>
            {activeItem.next_action && (
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-slate-500">ถัดไป:</span>
                <span className="truncate font-semibold text-slate-800 dark:text-slate-200">{activeItem.next_action}</span>
              </div>
            )}
            {activeItem.due_at && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>กำหนดเสร็จ: {formatThaiDateTime(activeItem.due_at)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Case 2: No Active Work Item */
        <div className="flex flex-col gap-2">
          {latestCompleted && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-1.5">
                <History className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  ประวัติงานล่าสุด: <strong className="font-bold">{WORK_ITEM_STATUS_LABELS[latestCompleted.status]}</strong> ({latestCompleted.resolution_summary || 'เสร็จสมบูรณ์'})
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenDetail(latestCompleted)}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer py-1"
              >
                ดูรายละเอียดเดิม
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs sm:text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow cursor-pointer"
            >
              <ClipboardList className="w-4 h-4" />
              <span>ติดตามงานนี้</span>
            </button>
            {latestCompleted && (
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                * รายการนี้เคยมีงานติดตามที่เสร็จสิ้นแล้ว สามารถสร้างงานติดตามใหม่ได้
              </span>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <WorkItemCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        siteId={siteId}
        operatorUid={operatorUid}
        operatorName={operatorName}
        role={role}
        existingItems={items}
        defaultSourceModule={sourceModule}
        defaultSourceRecordId={sourceRecordId}
        defaultSourceLabel={sourceLabel}
        defaultTitle={defaultTitle}
        defaultDescription={defaultDescription}
        defaultPriority={defaultPriority}
        lockSourceContext={true}
        onItemCreated={createdId => {
          setIsCreateOpen(false);
          if (onOpenWorkCenter) {
            onOpenWorkCenter(createdId);
          }
        }}
      />

      {selectedItem && (
        <WorkItemDetailDialog
          isOpen={isDetailOpen}
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedItem(null);
          }}
          item={selectedItem}
          siteId={siteId}
          operatorUid={operatorUid}
          operatorName={operatorName}
          role={role}
          onItemUpdated={updated => setSelectedItem(updated)}
        />
      )}
    </div>
  );
}
