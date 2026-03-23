# ZUNDRAL — Game Flowcharts (Current State)

---

## 1. NAVIGATION FLOW

```mermaid
graph LR
    subgraph TOP_BAR[Top Bar - Always Visible]
        POP[Pop 15/50]
        TAX[Taxes]
        RES_W[Wood]
        RES_S[Stone]
        RES_F[Food]
        RES_I[Iron]
        RES_G[Gold]
    end

    subgraph TABS[Main Tabs]
        B[Buildings]
        C[Council]
        A[Army]
        MI[Missions]
        EX[Expeditions]
        LB[Leaderboard]
        FA[Factions]
        BL[Blacksmith]
        TE[Technologies]
    end

    B --> B1[Resource Buildings]
    B --> B2[Town Hall / House]
    B --> B3[Barracks / Tavern]
    B --> B4[Warehouse]

    A --> A1[Mercenaries]
    A --> A2[Regular Army]

    A2 --> A3[Banner List]
    A3 --> A4[Form New Banner]
    A3 --> A5[Edit Banner]
    A3 --> A6[Train / Stop]

    MI --> MI1[Available Missions]
    MI1 --> MI2[Stage Banners]
    MI2 --> MI3[Deploy]

    EX --> EX1[Fund Expedition]
    EX1 --> EX2[Launch]
    EX2 --> EX3[Fortress View]
```

---

## 2. GAME LOOP (1 tick = 1 second)

```mermaid
graph TD
    TICK[Every 1 Second] --> G[Gold from Taxes]
    G --> PROD[Resource Production]
    PROD --> PROD1[Wood += lumberRate]
    PROD --> PROD2[Stone += stoneRate]
    PROD --> PROD3[Iron += ironRate]
    PROD --> PROD4[Food += foodRate]

    PROD4 --> FOOD_CONSUME[Food Consumption]
    FOOD_CONSUME --> |from Farm first| FC1[Farm Storage -= consumption]
    FOOD_CONSUME --> |remainder| FC2[Warehouse Food -= remainder]

    FC2 --> POP_CALC[Population Change]
    POP_CALC --> |food > 0| POP_GROW[Pop += netGrowth]
    POP_CALC --> |food = 0| POP_STARVE[Pop -= 1 starvation]
    POP_GROW --> POP_MIN[Min Pop = 1 always]
    POP_STARVE --> POP_MIN

    POP_MIN --> TRAIN[Banner Training]
    TRAIN --> |per training banner| T1[Pop -= 1]
    TRAIN --> |per training banner| T2[Iron -= unitCost]
    TRAIN --> |per training banner| T3[Squad currentSize += 1]
    T3 --> COMPLETE{recruited >= reqPop?}
    COMPLETE --> |Yes| READY[Banner -> READY]
    COMPLETE --> |No| NEXT_TICK[Wait next tick]

    READY --> MISSIONS_TICK[Mission Tick]
    MISSIONS_TICK --> |elapsed++| M_CHECK{elapsed >= duration?}
    M_CHECK --> |Yes| BATTLE[Run Battle Simulation]
    M_CHECK --> |No| QUEUE_TICK[Training Queue Tick]

    BATTLE --> QUEUE_TICK
    QUEUE_TICK --> SAVE[Auto-save State]
```

---

## 3. RESOURCE SYSTEM

```mermaid
graph LR
    subgraph PRODUCTION[Production Buildings]
        LM[Lumber Mill] --> |workers + level| WOOD[Wood /sec]
        QU[Quarry] --> |workers + level| STONE[Stone /sec]
        FM[Farm] --> |workers + level| FOOD_P[Food /sec]
        IM[Iron Mine] --> |workers + level| IRON[Iron /sec]
    end

    subgraph STORAGE[Storage Flow]
        WOOD --> LM_STORE[Lumber Mill Storage]
        STONE --> QU_STORE[Quarry Storage]
        FOOD_P --> FM_STORE[Farm Storage]
        IRON --> IM_STORE[Iron Mine Storage]

        LM_STORE --> |manual collect| WH_W[Warehouse Wood]
        QU_STORE --> |manual collect| WH_S[Warehouse Stone]
        FM_STORE --> |auto consumed| WH_F[Warehouse Food]
        IM_STORE --> |manual collect| WH_I[Warehouse Iron]
    end

    subgraph TAXES[Gold Income]
        POP[Population] --> |pop / 50| BASE_G[Base Gold]
        TAX_LV[Tax Level] --> |multiplier| BASE_G
        BASE_G --> WH_G[Warehouse Gold]
    end

    subgraph CONSUMPTION[Resource Sinks]
        WH_W --> |building upgrades| UPGRADE[Upgrades]
        WH_S --> |building upgrades| UPGRADE
        WH_F --> |pop food/sec| FEED[Feed Population]
        WH_I --> |training units| RECRUIT[Recruit Soldiers]
        WH_G --> |mercenaries| MERC[Buy Mercenaries]
        WH_G --> |blacksmith| SMITH[Gear Upgrades]
        WH_I --> |blacksmith| SMITH
    end
```

---

## 4. BUILDING SYSTEM

```mermaid
graph TD
    subgraph TOWN_HALL[Town Hall - Gate Building]
        TH[Town Hall L1-3]
        TH --> |L1| UNLOCK1[Lumber Mill, Quarry, Farm, Iron Mine, House, Warehouse]
        TH --> |L2| UNLOCK2[Barracks, Tavern]
        TH --> |L2| UNLOCK3[Military Academy]
    end

    subgraph RESOURCE_BUILDINGS[Resource Buildings]
        LM[Lumber Mill] --> |level up| LM_UP[+25% prod, +30% cap per level]
        QU[Quarry] --> |level up| QU_UP[+25% prod, +30% cap per level]
        FM[Farm] --> |level up| FM_UP[+25% prod, +30% cap per level]
        IM[Iron Mine] --> |level up| IM_UP[+25% prod, +30% cap per level]
    end

    subgraph SUPPORT_BUILDINGS[Support Buildings]
        HO[House] --> |level up| HO_UP[+5 pop cap per level]
        WH[Warehouse] --> |level up| WH_UP[+30% all resource caps per level]
        TA[Tavern] --> |level up| TA_UP[+happiness, Festival ability]
    end

    subgraph MILITARY_BUILDINGS[Military Buildings]
        BA[Barracks] --> |level up| BA_UP[Training slots: min level, 3]
        BA --> BA_QUEUE[Training Queue: Mercenaries + Reinforcements]
        MA[Military Academy] --> MA_UP[No gameplay effect yet]
    end

    subgraph COSTS[Upgrade Costs]
        FORMULA[Cost = baseCost x 1.5 ^ level - 1]
        FORMULA --> |paid in| WOOD_STONE[Wood + Stone]
    end
```

---

## 5. RECRUITING / MILITARY SYSTEM

```mermaid
graph TD
    subgraph BANNER_CREATION[Create Banner]
        NEW[+ Form New Banner] --> EMPTY[Empty Banner - 8 squad slots]
        EMPTY --> PICK[Pick Unit Type per Slot]
        PICK --> |Pikemen, Warrior, Archer...| SQUAD[Squad: 0/10]
    end

    subgraph TRAINING[Training Flow]
        IDLE[Banner IDLE] --> |click Train| TRAINING_S[Banner TRAINING]
        TRAINING_S --> |each second| CONSUME[Pop -= 1, Iron -= cost]
        CONSUME --> FILL[Squad currentSize += 1]
        FILL --> CHECK{All squads 10/10?}
        CHECK --> |No| CONSUME
        CHECK --> |Yes| READY_S[Banner READY]
    end

    subgraph UNIT_TYPES[Unit Types Available]
        INF[Infantry]
        INF --> MILITIA[Militia - Free, weak]
        INF --> PIKE[Pikemen - Anti-cavalry]
        INF --> WARRIOR[Warrior/Shieldmen - Balanced]
        INF --> LONG[Longsword - Elite melee]

        RNG[Ranged]
        RNG --> ARCHER[Archer - Cheap ranged]
        RNG --> SKIRM[Skirmisher - Hybrid]
        RNG --> CROSS[Crossbowmen - Elite ranged]

        CAV[Cavalry]
        CAV --> LCAV[Light Cavalry - Fast]
        CAV --> HCAV[Heavy Cavalry - Heavy hitter]
    end

    subgraph MERCENARIES[Mercenary System]
        GOLD_PAY[Pay 50 Gold] --> TEMPLATE[Pick Template]
        TEMPLATE --> T1[Bloody Warriors - 8 Warrior squads]
        TEMPLATE --> T2[Archers - 8 Archer squads]
        TEMPLATE --> T3[Mixed - 4 Warrior + 4 Archer]
        T1 --> ARRIVE[Arrives via Queue]
        T2 --> ARRIVE
        T3 --> ARRIVE
        ARRIVE --> MERC_READY[Banner READY - instant]
    end

    subgraph COMMANDERS[Commander System]
        RECRUIT_CMD[Recruit Commander] --> CMD[Commander]
        CMD --> |assign to banner| BONUS[Attack/Defence Bonus]
        CMD --> ARCH1[Ranged Specialist: +20% ranged]
        CMD --> ARCH2[Melee Specialist: +20% melee]
        CMD --> ARCH3[Balanced: +10% both]
        CMD --> |gains XP from battles| LEVEL_UP[Level 1-99]
    end
```

---

## 6. MISSION SYSTEM

```mermaid
graph TD
    subgraph AVAILABLE[Mission Board]
        POOL[20 Mission Pool] --> SHOW[3 Random Missions Shown]
        SHOW --> M1[Mission: Name + Difficulty + Enemies]
    end

    subgraph DEPLOY[Deploy Phase]
        M1 --> SELECT[Select Banner to Stage]
        SELECT --> |banner must be READY| STAGED[Banner Staged]
        STAGED --> SEND[Click Deploy]
        SEND --> RUNNING[Mission RUNNING - 3 sec timer]
    end

    subgraph BATTLE[Battle Resolution]
        RUNNING --> |elapsed >= duration| SIM[Battle Simulator]
        SIM --> PHASE1[Phase 1: Skirmish - Ranged fire]
        PHASE1 --> PHASE2[Phase 2: Melee - Main combat]
        PHASE2 --> PHASE3[Phase 3: Pursuit - Cavalry chase]
        PHASE3 --> RESULT{Victory?}
    end

    subgraph OUTCOME[Outcomes]
        RESULT --> |Win| VICTORY[Rewards Pending]
        RESULT --> |Lose| DEFEAT[Mission Available Again]
        VICTORY --> CLAIM[Claim Rewards]
        CLAIM --> LOOT[Gold + Wood + Stone + Food + Iron]
        CLAIM --> XP_GAIN[Banner XP + Commander XP]
        CLAIM --> SCORE[Leaderboard Score Updated]
        DEFEAT --> LOSSES[Banner takes casualties]
        LOSSES --> REINFORCE{Squad damaged?}
        REINFORCE --> |Yes| REPAIR[Reinforce: retrain lost units]
    end
```

---

## 7. EXPEDITION SYSTEM (Partial)

```mermaid
graph TD
    subgraph FUNDING[Funding Phase]
        EXP[Expedition Available] --> FUND[Contribute Resources]
        FUND --> NEED[Need: 500 Wood, 250 Stone, 1000 Food, 5 Pop]
        NEED --> |all met| LAUNCH_READY[Ready to Launch]
    end

    subgraph TRAVEL[Launch]
        LAUNCH_READY --> GO[Launch - 3 sec travel]
        GO --> ARRIVE[Arrive at Location]
    end

    subgraph FORTRESS[Fortress Management]
        ARRIVE --> FORT[Fortress Initialized]
        FORT --> FB1[Wall]
        FORT --> FB2[Gatehouse]
        FORT --> FB3[Watch Post]
        FORT --> FB4[Barracks]
        FORT --> FB5[Stable]
        FORT --> FB6[Storehouse]
        FORT --> GARRISON[Assign Garrison Banners]
    end

    subgraph INCOMPLETE[Not Yet Implemented]
        SIEGE[Siege Battles - partial]
        WAVES[Enemy Waves - not active]
        EXPAND[Build & Expand - placeholder]
    end

    FORTRESS --> INCOMPLETE

    style INCOMPLETE fill:#ff6b6b,color:#fff
    style SIEGE fill:#ff6b6b,color:#fff
    style WAVES fill:#ff6b6b,color:#fff
    style EXPAND fill:#ff6b6b,color:#fff
```

---

## 8. SYSTEMS STATUS OVERVIEW

```mermaid
graph LR
    subgraph DONE[Working Systems]
        style DONE fill:#2ecc71,color:#fff
        R[Resources]
        P[Population]
        BU[Buildings]
        AR[Army/Banners]
        MI[Missions]
        LE[Leaderboard]
        BX[Banner XP]
    end

    subgraph PARTIAL[Partially Working]
        style PARTIAL fill:#f39c12,color:#fff
        BS[Blacksmith]
        CM[Commanders]
        MR[Mercenaries]
        EX[Expeditions]
    end

    subgraph PLACEHOLDER[UI Only - No Effects]
        style PLACEHOLDER fill:#e74c3c,color:#fff
        TE[Technologies - 28 techs]
        FA[Factions - 30 perks]
        MA[Military Academy]
    end
```
