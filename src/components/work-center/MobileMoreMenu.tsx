import React from 'react';
import {
  Users,
  Key,
  AlertTriangle,
  Search,
  Settings,
  Shield,
  RefreshCw,
  X,
} from 'lucide-react';
import type { TabType } from '../../App';

interface MobileMoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  userRole: string;
}

export default function MobileMoreMenu({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  userRole,
}: MobileMoreMenuProps) {
  if (!isOpen) return null;

  const isManagerOrAdmin = ['Admin', 'Manager'].includes(userRole);

  const menuItems = [
    {
      tab: 'contractors' as TabType,
      label: 'ช่างรับเหมา',
      sublabel: 'Contractor Logs',
      icon: Users,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    {
      tab: 'keys' as TabType,
      label: 'กุญแจ',
      sublabel: 'Key Control',
      icon: Key,
      color: 'text-red-400 bg-red-500/10 border-red-500/20',
    },
    {
      tab: 'incidents' as TabType,
      label: 'แจ้งเหตุ',
      sublabel: 'Incident Reports',
      icon: AlertTriangle,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    },
    {
      tab: 'history' as TabType,
      label: 'สืบค้นย้อนหลัง',
      sublabel: 'Search History',
      icon: Search,
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    },
    {
      tab: 'vehicleOperations' as TabType,
      label: 'คิวและวิเคราะห์รถ',
      sublabel: 'Vehicle Operations',
      icon: RefreshCw,
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    },
    ...(isManagerOrAdmin
      ? [
          {
            tab: 'settings' as TabType,
            label: 'ตั้งค่าระบบ',
            sublabel: 'Master Config',
            icon: Settings,
            color: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
          },
          {
            tab: 'admin' as TabType,
            label: 'แผงแอดมิน',
            sublabel: 'Admin Panel',
            icon: Shield,
            color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
          },
        ]
      : []),
  ];

  const handleSelect = (tab: TabType) => {
    onSelectTab(tab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-xs lg:hidden animate-fade-in">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-lg rounded-t-3xl border-t border-slate-700 bg-slate-900 p-6 text-white shadow-2xl pb-10">
        {/* Drag handle pill */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-700" />

        <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-black tracking-tight text-white">
              เมนูการปฏิบัติงานเพิ่มเติม
            </h3>
            <p className="text-xs text-slate-400 font-medium">
              เลือกเมนูที่ต้องการเปิดใช้งาน
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="ปิดเมนู"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => handleSelect(item.tab)}
                className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all ${
                  isActive
                    ? 'border-blue-500 bg-blue-600/20 shadow-md ring-1 ring-blue-500'
                    : 'border-slate-800 bg-slate-800/60 hover:border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border ${item.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <span
                    className={`block text-xs font-black ${
                      isActive ? 'text-blue-400' : 'text-slate-100'
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {item.sublabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
