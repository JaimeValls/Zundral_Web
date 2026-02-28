import React from 'react';

interface AnchoredUnitPickerProps {
    isOpen: boolean;
    onClose: () => void;
    anchorRect: DOMRect | null;
    warehouse: { iron: number };
    onSelectUnit: (unitType: UnitType) => void;
    currentUnitType?: UnitType;
}

type UnitType = 'warrior' | 'militia' | 'longsword' | 'pikemen' | 'light_cavalry' | 'heavy_cavalry' | 'archer' | 'skirmisher' | 'crossbowmen';
type UnitCategory = 'infantry' | 'ranged_infantry' | 'cavalry';

const unitCategory: Record<UnitType, UnitCategory> = {
    militia: 'infantry',
    warrior: 'infantry',
    longsword: 'infantry',
    pikemen: 'infantry',
    archer: 'ranged_infantry',
    skirmisher: 'ranged_infantry',
    crossbowmen: 'ranged_infantry',
    light_cavalry: 'cavalry',
    heavy_cavalry: 'cavalry'
};

const unitDisplayNames: Record<UnitType, string> = {
    warrior: 'Shieldmen',
    militia: 'Militia',
    longsword: 'Longswords',
    pikemen: 'Pikemen',
    light_cavalry: 'Light Cavalry',
    heavy_cavalry: 'Heavy Cavalry',
    archer: 'Archers',
    skirmisher: 'Skirmishers',
    crossbowmen: 'Crossbowmen'
};

const ironCostPerSquad: Record<UnitType, number> = {
    militia: 0,
    warrior: 10,
    longsword: 20,
    pikemen: 15,
    light_cavalry: 25,
    heavy_cavalry: 40,
    archer: 5,
    skirmisher: 8,
    crossbowmen: 15
};

export default function AnchoredUnitPicker({ isOpen, onClose, anchorRect, warehouse, onSelectUnit, currentUnitType }: AnchoredUnitPickerProps) {
    if (!isOpen || !anchorRect) return null;

    // Calculate position
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 640;
    const pickerWidth = isMobile ? Math.min(340, viewportWidth - 24) : 340;
    const pickerHeight = isMobile ? 360 : 400;

    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;

    // Center on mobile if needed, or stick to anchor
    if (isMobile) {
        left = (viewportWidth - pickerWidth) / 2;
    } else {
        // Flip horizontally if too close to right edge
        if (left + pickerWidth > viewportWidth) {
            left = anchorRect.right - pickerWidth;
        }
    }

    // Flip vertically if too close to bottom
    if (top + pickerHeight > viewportHeight) {
        top = anchorRect.top - pickerHeight - 8;
    }

    // Ensure it stays within viewport
    left = Math.max(8, Math.min(left, viewportWidth - pickerWidth - 8));
    top = Math.max(8, Math.min(top, viewportHeight - pickerHeight - 8));

    const categories: { id: UnitCategory; label: string; units: UnitType[] }[] = [
        { id: 'infantry', label: 'Infantry', units: ['militia', 'warrior', 'longsword', 'pikemen'] },
        { id: 'ranged_infantry', label: 'Ranged', units: ['archer', 'skirmisher', 'crossbowmen'] },
        { id: 'cavalry', label: 'Cavalry', units: ['light_cavalry', 'heavy_cavalry'] }
    ];

    const [selectedCategory, setSelectedCategory] = React.useState<UnitCategory>('infantry');

    const currentUnits = categories.find(c => c.id === selectedCategory)?.units || [];

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[55] transition-opacity"
                onClick={onClose}
            />

            {/* Picker */}
            <div
                className="fixed z-[60] bg-slate-900 border border-slate-700 shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-200 rounded-lg"
                style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${pickerWidth}px`,
                    maxHeight: `${pickerHeight}px`
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-3 px-1">
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Select Unit Type</h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded bg-slate-800 text-slate-400 flex items-center justify-center text-xs hover:bg-slate-700 hover:text-slate-300 transition-colors border border-slate-700"
                    >
                        ✕
                    </button>
                </div>

                {/* Category Tabs - Matching Army UI */}
                <div className="flex p-0.5 bg-slate-950 rounded border border-slate-800 mb-3">
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`flex-1 px-2 py-1 text-[9px] rounded font-semibold uppercase tracking-wide transition-colors ${selectedCategory === cat.id
                                ? 'bg-emerald-600 text-white'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>

                {/* Unit Grid - 2 Columns */}
                <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-[240px] pr-1 custom-scrollbar">
                    {currentUnits.map(unitType => {
                        const ironCost = ironCostPerSquad[unitType];
                        const canAfford = warehouse.iron >= ironCost;
                        const isFree = ironCost === 0;
                        const isActive = unitType === currentUnitType;

                        return (
                            <button
                                key={unitType}
                                onClick={() => {
                                    if (canAfford) {
                                        onSelectUnit(unitType);
                                    }
                                }}
                                disabled={!canAfford}
                                className={`relative flex items-center h-12 p-2 rounded-lg border transition-all gap-2 ${isActive
                                    ? 'bg-emerald-900/20 border-emerald-600'
                                    : canAfford
                                        ? 'bg-slate-800 border-slate-700 hover:border-slate-600 active:scale-[0.98]'
                                        : 'bg-slate-900 border-slate-800 opacity-40'
                                    }`}
                            >
                                <span className={`text-lg shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                                    {unitCategory[unitType] === 'ranged_infantry' ? '🏹' : unitCategory[unitType] === 'cavalry' ? '🐴' : '⚔️'}
                                </span>
                                <div className="flex flex-col items-start min-w-0 overflow-hidden flex-1">
                                    <div className="text-[9px] font-semibold text-slate-200 uppercase leading-tight truncate w-full">{unitDisplayNames[unitType]}</div>
                                    <div className={`text-[8px] font-semibold ${isFree ? 'text-emerald-500' : canAfford ? 'text-slate-500' : 'text-red-500'}`}>
                                        {isFree ? 'Free' : `${ironCost} Iron`}
                                    </div>
                                </div>

                                {isActive && (
                                    <div className="absolute top-1 right-1">
                                        <span className="px-1 py-0.5 bg-emerald-600 text-white text-[6px] font-bold uppercase rounded tracking-tight">Active</span>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );

    function formatShort(num: number) {
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return num.toString();
    }
}
