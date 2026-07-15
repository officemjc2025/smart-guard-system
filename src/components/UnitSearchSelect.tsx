/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useUnits } from '../hooks/useUnits';
import { UnitRecord } from '../types';

interface UnitSearchSelectProps {
  value?: string; // current room_number or input value
  selectedUnitId?: string; // currently selected unit_id
  onSelect: (unit: UnitRecord | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  siteId?: string;
  error?: string;
  allowManualEntry?: boolean;
}

function normalizeUnitSearch(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\/\-.]/g, '');
}

export const UnitSearchSelect: React.FC<UnitSearchSelectProps> = ({
  value = '',
  selectedUnitId = '',
  onSelect,
  label = 'ค้นหาห้องชุด / ยูนิต',
  placeholder = 'พิมพ์เพื่อค้นหาเลขห้อง, ชื่อเจ้าของ หรือเบอร์โทร...',
  required = false,
  disabled = false,
  error = '',
  allowManualEntry = false,
}) => {
  const { units, loading, error: fetchError, refresh } = useUnits();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep query in sync with value prop if not focused
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setQuery(value);
    }
  }, [value]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter units
  const filteredUnits = React.useMemo(() => {
    if (!query.trim()) {
      return units;
    }

    const normQ = normalizeUnitSearch(query);
    return units.filter((u) => {
      const roomNum = u.room_number || '';
      const roomCode = u.room_code || '';
      const unitId = u.unit_id || '';
      const owner = u.owner_name || '';
      const phone = u.phone || '';
      const text = u.searchable_text || '';
      const key = u.search_key || '';

      // Normalize fields
      const normRoomNum = normalizeUnitSearch(roomNum);
      const normRoomCode = normalizeUnitSearch(roomCode);
      const normUnitId = normalizeUnitSearch(unitId);
      const normOwner = normalizeUnitSearch(owner);
      const normPhone = normalizeUnitSearch(phone);
      const normText = normalizeUnitSearch(text);
      const normKey = normalizeUnitSearch(key);

      return (
        normRoomNum.includes(normQ) ||
        normRoomCode.includes(normQ) ||
        normUnitId.includes(normQ) ||
        normOwner.includes(normQ) ||
        normPhone.includes(normQ) ||
        normText.includes(normQ) ||
        normKey.includes(normQ)
      );
    });
  }, [units, query]);

  // Limit matches to first 20
  const displayedUnits = React.useMemo(() => {
    return filteredUnits.slice(0, 20);
  }, [filteredUnits]);

  // Check if current query exactly matches any visible/loaded room number
  const hasExactMatch = React.useMemo(() => {
    const normalizedQ = normalizeUnitSearch(query);
    if (!normalizedQ) return true;
    return units.some(u => normalizeUnitSearch(u.room_number) === normalizedQ);
  }, [units, query]);

  // Reset highlighted index when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [displayedUnits]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    const totalCount = displayedUnits.length + (allowManualEntry && query.trim() && !hasExactMatch ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        setHighlightedIndex((prev) => (prev + 1) % (totalCount || 1));
        e.preventDefault();
        break;
      case 'ArrowUp':
        setHighlightedIndex((prev) => (prev - 1 + (totalCount || 1)) % (totalCount || 1));
        e.preventDefault();
        break;
      case 'Enter':
        e.preventDefault();
        if (totalCount === 0) return;

        // Check if the highlighted index belongs to the manual entry fallback
        if (allowManualEntry && query.trim() && !hasExactMatch && highlightedIndex === displayedUnits.length) {
          handleSelectManual();
        } else if (displayedUnits[highlightedIndex]) {
          handleSelectUnit(displayedUnits[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        e.preventDefault();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const handleSelectUnit = (unit: UnitRecord) => {
    onSelect(unit);
    setQuery(unit.room_number);
    setIsOpen(false);
  };

  const handleSelectManual = () => {
    onSelect({
      unit_id: '',
      room_number: query.trim(),
      room_code: '',
      floor: '',
      owner_name: '',
      phone: '',
      email: '',
      occupancy_status: '',
      searchable_text: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQuery('');
    onSelect(null);
    inputRef.current?.focus();
    setIsOpen(true);
  };

  // Find selected unit label
  const selectedUnit = units.find(u => u.unit_id === selectedUnitId);
  const displayLabel = selectedUnit ? `ห้อง ${selectedUnit.room_number}` : query;

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-slate-300 font-bold mb-1.5 text-xs">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}

      {/* Input Group */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="w-5 h-5 text-slate-400" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={isOpen ? query : displayLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setQuery(query); // show what user has been typing
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={`w-full h-14 pl-12 pr-12 bg-slate-900 border ${
            error ? 'border-rose-500' : 'border-slate-800'
          } rounded-2xl text-[17px] text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
            error ? 'focus:ring-rose-500/20' : 'focus:ring-indigo-500/20'
          } focus:border-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
        />

        <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 transition-colors cursor-pointer"
          >
            <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="mt-1 text-xs font-bold text-rose-500">{error}</p>}

      {/* Dropdown Container */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 w-full bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl mt-1.5 max-h-80 overflow-y-auto overflow-x-hidden backdrop-blur-xl">
          
          {/* Firestore Fetch Error */}
          {fetchError && (
            <div className="p-4 border-b border-rose-500/20 bg-rose-500/5">
              <div className="flex items-start gap-2.5 text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold">เกิดข้อผิดพลาดในการโหลดข้อมูลห้องชุด</p>
                  <p className="text-xs text-rose-500/80 mt-0.5">{fetchError.message}</p>
                  <button
                    type="button"
                    onClick={() => refresh()}
                    className="mt-2 text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-bold transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3 animate-pulse" /> ลองใหม่อีกครั้ง
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="p-4 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
              <span>กำลังโหลดข้อมูลห้องชุด...</span>
            </div>
          )}

          {/* Results List */}
          {!loading && (
            <ul className="divide-y divide-slate-900">
              {displayedUnits.map((unit, index) => {
                const isSelected = selectedUnitId === unit.unit_id;
                const isHighlighted = index === highlightedIndex;

                return (
                  <li
                    key={unit.unit_id}
                    onClick={() => handleSelectUnit(unit)}
                    className={`px-4 py-3 cursor-pointer transition-colors flex items-center justify-between min-h-[56px] ${
                      isHighlighted ? 'bg-slate-800/40 text-white' : 'text-slate-300'
                    } ${isSelected ? 'bg-indigo-600/10' : ''} hover:bg-slate-800/20`}
                  >
                    <div className="flex-1 pr-4">
                      <div className="text-[17px] font-bold text-slate-100 flex items-center gap-2">
                        <span>ห้อง {unit.room_number}</span>
                        {unit.floor && (
                          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-normal">
                            ชั้น {unit.floor}
                          </span>
                        )}
                        {unit.occupancy_status && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                            unit.occupancy_status === 'ว่าง' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                          }`}>
                            {unit.occupancy_status}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-[15px] text-slate-400 mt-0.5">
                        {unit.owner_name && <span>เจ้าของ: {unit.owner_name}</span>}
                        {unit.phone && <span className="ml-2.5 pl-2.5 border-l border-slate-800">โทร: {unit.phone}</span>}
                      </div>

                      {unit.room_code && (
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">
                          รหัส: {unit.room_code}
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <Check className="w-5 h-5 text-indigo-500 shrink-0 ml-2" />
                    )}
                  </li>
                );
              })}

              {/* Manual Entry Fallback Action */}
              {allowManualEntry && query.trim() && !hasExactMatch && (
                <li
                  onClick={handleSelectManual}
                  className={`px-4 py-3 cursor-pointer transition-colors min-h-[56px] border-t border-dashed border-slate-800/60 ${
                    highlightedIndex === displayedUnits.length ? 'bg-slate-800/40 text-white font-bold' : 'text-indigo-400'
                  }`}
                >
                  <div className="text-[17px] font-bold">
                    ไม่พบห้อง — ใช้เลขห้องที่พิมพ์
                  </div>
                  <div className="text-[15px] text-slate-400 mt-0.5">
                    กดเลือกเพื่อใช้ห้องชุด "{query.trim()}" และบันทึกแบบป้อนข้อมูลเอง
                  </div>
                </li>
              )}

              {/* Empty State (when manual entry is disabled and no matching units found) */}
              {displayedUnits.length === 0 && (!allowManualEntry || !query.trim()) && (
                <div className="p-8 text-center text-slate-500">
                  <p className="text-[17px] font-bold">ไม่พบข้อมูลห้องชุด</p>
                  <p className="text-xs text-slate-600 mt-1">กรุณาลองป้อนข้อมูลอื่น หรือติดต่อนิติบุคคลเพื่อลงทะเบียนข้อมูลห้องชุด</p>
                </div>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
