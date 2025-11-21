import React, { useState, useEffect } from "react";

// Types
type TechnologyCategory = 'government' | 'urban' | 'farming' | 'industry';

interface Technology {
  id: string;
  name: string;
  category: TechnologyCategory;
  description: string;
  cost: number;
  status: 'locked' | 'researching' | 'unlocked';
}

interface TechnologiesUIProps {
  isOpen: boolean;
  onClose: () => void;
  skillPoints: number;
  onStartResearch: (techId: string, cost: number) => void;
  onCompleteResearch: (techId: string) => void;
}

interface ResearchingTech {
  techId: string;
  timeRemaining: number; // seconds
}

// Technology definitions
const TECHNOLOGIES: Technology[] = [
  // Government
  { id: 'feudal_contracts', name: 'Feudal Contracts', category: 'government', description: 'Placeholder: improves vassal obligations.', cost: 10, status: 'locked' },
  { id: 'royal_courts', name: 'Royal Courts', category: 'government', description: 'Placeholder: centralises royal authority.', cost: 10, status: 'locked' },
  { id: 'land_surveys', name: 'Land Surveys', category: 'government', description: 'Placeholder: better land management.', cost: 10, status: 'locked' },
  { id: 'tax_offices', name: 'Tax Offices', category: 'government', description: 'Placeholder: improved tax collection.', cost: 10, status: 'locked' },
  { id: 'diplomacy_corps', name: 'Diplomacy Corps', category: 'government', description: 'Placeholder: enhanced diplomatic relations.', cost: 10, status: 'locked' },
  { id: 'legal_code', name: 'Legal Code', category: 'government', description: 'Placeholder: codified laws and justice.', cost: 10, status: 'locked' },
  { id: 'standing_bureaucracy', name: 'Standing Bureaucracy', category: 'government', description: 'Placeholder: permanent administrative structure.', cost: 10, status: 'locked' },
  
  // Urban Development
  { id: 'stone_housing', name: 'Stone Housing', category: 'urban', description: 'Placeholder: sturdier urban homes.', cost: 10, status: 'locked' },
  { id: 'paved_streets', name: 'Paved Streets', category: 'urban', description: 'Placeholder: better urban infrastructure.', cost: 10, status: 'locked' },
  { id: 'public_wells', name: 'Public Wells', category: 'urban', description: 'Placeholder: improved water access.', cost: 10, status: 'locked' },
  { id: 'sewers', name: 'Sewers', category: 'urban', description: 'Placeholder: better sanitation for cities.', cost: 10, status: 'locked' },
  { id: 'guild_districts', name: 'Guild Districts', category: 'urban', description: 'Placeholder: organized craft areas.', cost: 10, status: 'locked' },
  { id: 'city_walls', name: 'City Walls', category: 'urban', description: 'Placeholder: defensive urban structures.', cost: 10, status: 'locked' },
  { id: 'urban_planning', name: 'Urban Planning', category: 'urban', description: 'Placeholder: systematic city development.', cost: 10, status: 'locked' },
  
  // Farming
  { id: 'heavy_plough', name: 'Heavy Plough', category: 'farming', description: 'Placeholder: more efficient tilling.', cost: 10, status: 'locked' },
  { id: 'three_field_rotation', name: 'Three-Field Rotation', category: 'farming', description: 'Placeholder: more reliable harvests.', cost: 10, status: 'locked' },
  { id: 'irrigation', name: 'Irrigation', category: 'farming', description: 'Placeholder: better water management for crops.', cost: 10, status: 'locked' },
  { id: 'selective_breeding', name: 'Selective Breeding', category: 'farming', description: 'Placeholder: improved livestock quality.', cost: 10, status: 'locked' },
  { id: 'orchard_farming', name: 'Orchard Farming', category: 'farming', description: 'Placeholder: specialized fruit cultivation.', cost: 10, status: 'locked' },
  { id: 'watermills', name: 'Watermills', category: 'farming', description: 'Placeholder: mechanical grain processing.', cost: 10, status: 'locked' },
  { id: 'cash_crops', name: 'Cash Crops', category: 'farming', description: 'Placeholder: profitable crop specialization.', cost: 10, status: 'locked' },
  
  // Industry
  { id: 'iron_tools', name: 'Iron Tools', category: 'industry', description: 'Placeholder: better basic tools.', cost: 10, status: 'locked' },
  { id: 'workshops', name: 'Workshops', category: 'industry', description: 'Placeholder: early craft specialisation.', cost: 10, status: 'locked' },
  { id: 'blast_furnace', name: 'Blast Furnace', category: 'industry', description: 'Placeholder: advanced metalworking.', cost: 10, status: 'locked' },
  { id: 'loom_upgrades', name: 'Loom Upgrades', category: 'industry', description: 'Placeholder: improved textile production.', cost: 10, status: 'locked' },
  { id: 'standardised_measures', name: 'Standardised Measures', category: 'industry', description: 'Placeholder: consistent measurement systems.', cost: 10, status: 'locked' },
  { id: 'printing_press', name: 'Printing Press', category: 'industry', description: 'Placeholder: mass information production.', cost: 10, status: 'locked' },
  { id: 'early_mechanics', name: 'Early Mechanics', category: 'industry', description: 'Placeholder: basic mechanical principles.', cost: 10, status: 'locked' },
];

const TECHNOLOGY_RESEARCH_TIME = 30; // seconds

export default function TechnologiesUI({ isOpen, onClose, skillPoints, onStartResearch, onCompleteResearch }: TechnologiesUIProps) {
  const [activeTab, setActiveTab] = useState<TechnologyCategory>('government');
  const [technologies, setTechnologies] = useState<Technology[]>(TECHNOLOGIES);
  const [researching, setResearching] = useState<ResearchingTech[]>([]);

  // Countdown timer for all researching technologies
  useEffect(() => {
    if (researching.length === 0) return;

    const interval = setInterval(() => {
      setResearching(prev => {
        const updated = prev.map(tech => ({
          ...tech,
          timeRemaining: Math.max(0, tech.timeRemaining - 1),
        }));

        // Find completed technologies
        const completed = updated.filter(tech => tech.timeRemaining <= 0);
        
        // Mark as unlocked and remove from researching
        completed.forEach(completedTech => {
          setTechnologies(prevTechs => 
            prevTechs.map(tech => 
              tech.id === completedTech.techId 
                ? { ...tech, status: 'unlocked' as const }
                : tech
            )
          );
          onCompleteResearch(completedTech.techId);
        });

        // Return only those still researching
        return updated.filter(tech => tech.timeRemaining > 0);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [researching, onCompleteResearch]);

  if (!isOpen) return null;

  const currentList = technologies.filter(tech => tech.category === activeTab);
  const researchingTechs = researching.map(rt => {
    const tech = technologies.find(t => t.id === rt.techId);
    return tech ? { ...tech, timeRemaining: rt.timeRemaining } : null;
  }).filter(Boolean) as (Technology & { timeRemaining: number })[];

  const handleResearch = (tech: Technology) => {
    if (skillPoints < tech.cost) return;
    if (tech.status !== 'locked') return;

    // Pay cost
    onStartResearch(tech.id, tech.cost);

    // Update technology status
    setTechnologies(prev => 
      prev.map(t => 
        t.id === tech.id 
          ? { ...t, status: 'researching' as const }
          : t
      )
    );

    // Add to researching list
    setResearching(prev => [...prev, {
      techId: tech.id,
      timeRemaining: TECHNOLOGY_RESEARCH_TIME,
    }]);
  };

  const getCategoryName = (category: TechnologyCategory) => {
    switch (category) {
      case 'government': return 'Government';
      case 'urban': return 'Urban Development';
      case 'farming': return 'Farming';
      case 'industry': return 'Industry';
    }
  };

  const formatInt = (n: number) => Math.floor(n).toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-slate-900 border border-slate-800 flex flex-col overflow-hidden">
        {/* TOP BAR */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-xl font-bold">TECHNOLOGIES – Realm Research</h2>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            X
          </button>
        </div>

        {/* Skill Points Display */}
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-800/50">
          <div className="text-sm font-semibold text-slate-300">
            Skill Points: {formatInt(skillPoints)}
          </div>
        </div>

        {/* BODY: Two columns */}
        <div className="flex-1 overflow-hidden flex gap-4 p-4">
          {/* LEFT COLUMN: Technologies List */}
          <div className="w-1/2 flex flex-col">
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col overflow-hidden">
              {/* Title bar with tabs inside */}
              <div className="p-3 border-b border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-300">Technologies</h3>
                </div>
                {/* Tabs inside the left card */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setActiveTab('government')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${
                      activeTab === 'government'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    Government
                  </button>
                  <button
                    onClick={() => setActiveTab('urban')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${
                      activeTab === 'urban'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    Urban Development
                  </button>
                  <button
                    onClick={() => setActiveTab('farming')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${
                      activeTab === 'farming'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    Farming
                  </button>
                  <button
                    onClick={() => setActiveTab('industry')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${
                      activeTab === 'industry'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    Industry
                  </button>
                </div>
              </div>
              
              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {currentList.map((tech) => {
                    const isResearching = tech.status === 'researching';
                    const isUnlocked = tech.status === 'unlocked';
                    const canResearch = skillPoints >= tech.cost && tech.status === 'locked';
                    
                    return (
                      <div
                        key={tech.id}
                        className="rounded-lg border border-slate-600 bg-slate-900 p-3"
                      >
                        <div className="space-y-2">
                          {/* Technology name */}
                          <div className="font-semibold">
                            {tech.name}
                          </div>
                          
                          {/* Description */}
                          <div className="text-xs text-slate-400">
                            {tech.description}
                          </div>
                          
                          {/* Cost */}
                          <div className="text-xs">
                            <span className="text-slate-400">Cost: </span>
                            <span className={skillPoints >= tech.cost ? 'text-emerald-400' : 'text-red-400'}>
                              {formatInt(tech.cost)} Skill Points
                            </span>
                          </div>
                          
                          {/* Status and button */}
                          {isUnlocked ? (
                            <div className="text-xs text-emerald-400 font-semibold">
                              Unlocked
                            </div>
                          ) : isResearching ? (
                            <div className="space-y-1">
                              <div className="text-xs text-amber-400">
                                In progress
                              </div>
                              <button
                                disabled
                                className="w-full px-3 py-2 rounded bg-slate-700 text-slate-400 text-sm font-semibold cursor-not-allowed"
                              >
                                Researching…
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {!canResearch && (
                                <div className="text-xs text-red-400">
                                  Not enough Skill Points
                                </div>
                              )}
                              <button
                                onClick={() => handleResearch(tech)}
                                disabled={!canResearch}
                                className="w-full px-3 py-2 rounded bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Consumes 10 Skill Points and starts research"
                              >
                                RESEARCH
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Technologies in Progress */}
          <div className="w-1/2 flex flex-col">
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col overflow-hidden">
              {/* Title bar */}
              <div className="p-3 border-b border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300">Technologies in Progress</h3>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {researchingTechs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm text-center">
                    <div>
                      <div>No technologies in progress.</div>
                      <div className="mt-2">Select a technology on the left and press RESEARCH to begin.</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {researchingTechs.map((tech) => (
                      <div key={tech.id} className="rounded-lg border border-slate-600 bg-slate-900 p-4 space-y-3">
                        {/* Technology name */}
                        <div className="font-semibold text-lg">{tech.name}</div>
                        
                        {/* Category */}
                        <div className="text-sm text-slate-400">
                          Category: {getCategoryName(tech.category)}
                        </div>
                        
                        {/* Target status */}
                        <div className="text-sm text-slate-300">
                          Researching (Cost already paid)
                        </div>
                        
                        {/* Timer */}
                        <div className="text-sm text-slate-300">
                          Time remaining: {tech.timeRemaining}s
                        </div>
                        
                        {/* Progress bar */}
                        <div className="space-y-2">
                          <div className="h-4 rounded bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-sky-500 transition-all duration-300"
                              style={{ width: `${((TECHNOLOGY_RESEARCH_TIME - tech.timeRemaining) / TECHNOLOGY_RESEARCH_TIME) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

