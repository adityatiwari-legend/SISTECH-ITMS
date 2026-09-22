# ITMS — UI/UX Design System

## 1. Design Objective

ITMS should look and behave like a modern intelligent traffic command center.

The interface must communicate:
- Real-time control
- Intelligence
- Safety
- Emergency priority
- Geographic awareness
- System reliability

The map is the primary operational surface.

## 2. Design Direction

Style:

- Dark
- Technical
- Minimal
- High information density
- Clean
- Modern
- Operational
- Subtle glass panels

Avoid:
- Generic SaaS dashboard appearance
- Excessive gradients
- Excessive glassmorphism
- Decorative 3D elements
- Excessive animation
- Gaming-style UI

## 3. Color System

### Base

```text
Background: #080B12
Panel:      #0F141D
Border:     #202938
Text:       #F4F7FA
Muted:      #8B95A7
```

### Semantic

```text
Success:    #22C55E
Warning:    #F59E0B
Critical:   #EF4444
Emergency:  #FF3B30
AI:         #8B5CF6
Info:       #38BDF8
```

Use emergency red only for genuine emergency states.

## 4. Typography

Primary:

```text
Inter
```

Technical/monospace:

```text
JetBrains Mono
```

Use monospace for:
- Vehicle IDs
- Signal IDs
- Coordinates
- Timestamps
- Logs
- Simulation values

## 5. Application Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ ITMS                  Simulation: LIVE       System ● ONLINE │
├──────────┬───────────────────────────────────────────┬───────┤
│ SIDEBAR  │               LIVE MAP                    │ EVENT │
│          │                                           │ PANEL │
│ Overview │                                           │       │
│ Traffic  │                                           │       │
│ Emerg.   │                                           │       │
│ Signals  │                                           │       │
│ Corridor │                                           │       │
│ Simulator│                                           │       │
│ Analytics│                                           │       │
├──────────┴───────────────────────────────────────────┴───────┤
│ KPIs │ Active EV │ Avg Speed │ Congestion │ Corridors │ ETA  │
└──────────────────────────────────────────────────────────────┘
```

## 6. Navigation

```text
COMMAND CENTER

Overview

LIVE OPERATIONS
  Traffic
  Emergencies
  Signals
  Corridors

SIMULATION
  Simulator
  Scenarios

ANALYTICS
  Traffic Analytics
  Emergency Analytics
  AI Decision Trace
  Reports

SYSTEM
  Network
  Settings
```

## 7. Command Center

Primary objective:

> Show what is happening right now.

The live map should occupy approximately 60–70% of the main content area.

## 8. Map Layers

```text
Roads
Traffic density
Vehicles
Emergency vehicles
Signals
Hospitals
Green corridors
Congestion
```

## 9. Traffic Visualization

```text
Low       → Green
Moderate  → Yellow
High      → Orange
Critical  → Red
```

Use subtle road overlays rather than flooding the entire map with saturated colors.

## 10. Vehicle Visualization

Normal vehicles:
- Small
- Low opacity
- Smooth movement

Emergency vehicles:
- Larger icon
- Glow
- Direction indicator
- Route line
- High visual priority

## 11. Green Corridor

Show:
- Route line
- Active signal nodes
- Signal timing state
- Emergency vehicle position
- Direction of movement

The corridor should animate as it moves.

## 12. Emergency Panel

```text
ACTIVE EMERGENCY

AMB-104
AMBULANCE

Priority
CRITICAL

Destination
City Hospital

ETA
08:42

Distance
4.8 km

Corridor
ACTIVE

Intersections
7

[VIEW ROUTE]
[OPTIMIZATION DETAILS]
```

## 13. AI Decision Panel

Show:

```text
Traffic Forecast
████████░░ 82%

Route Confidence
91%

Predicted Delay
+1.2 min

Corridor Status
OPTIMIZED

Last Recalculation
3 sec ago
```

The purpose is to make AI behavior explainable.

## 14. Signal Details

```text
SIGNAL I-104

Current
GREEN

Remaining
08 sec

Next
YELLOW

Mode
CORRIDOR PRIORITY

Emergency
AMB-104

Queue
12 vehicles
```

## 15. Traffic Page

Show:
- Total vehicles
- Average speed
- Queue length
- Congestion
- Traffic map
- Congested road list
- Traffic trend

## 16. Emergency Page

List active emergencies:

```text
AMB-104
Ambulance
CRITICAL
ETA 08:42
CORRIDOR ACTIVE
```

Clicking opens the detailed route.

## 17. Corridor Page

Display:
- Corridor ID
- Emergency vehicle
- Signals
- Start time
- ETA
- Distance
- Status
- Optimization state

## 18. Signals Page

Table:

```text
Signal
Location
State
Queue
Mode
Emergency
```

## 19. Simulator Page

```text
┌────────────────────────────────────────────┐
│ SIMULATION                                 │
├────────────────────────────────────────────┤
│                                            │
│                  LIVE MAP                  │
│                                            │
│        🚑 → 🟢 → 🟢 → 🟢                  │
│                                            │
├────────────────────────────────────────────┤
│ ▶ Start   ⏸ Pause   ↻ Reset               │
│ Speed: 1x 2x 5x 10x                       │
└────────────────────────────────────────────┘
```

## 20. Scenario Builder

Fields:

```text
Emergency Type
Origin
Destination
Traffic Level
Time
Weather (future)
Mode
```

Action:

```text
RUN SCENARIO
```

## 21. Baseline vs ITMS

```text
┌──────────────────────┬──────────────────────┐
│ BASELINE             │ ITMS                 │
├──────────────────────┼──────────────────────┤
│ ETA                  │ ETA                  │
│ Average Delay        │ Average Delay        │
│ Queue                │ Queue                │
│ Average Speed        │ Average Speed        │
│ Signal Changes       │ Signal Changes       │
└──────────────────────┴──────────────────────┘
```

Do not hard-code these values.

## 22. Analytics Page

KPIs:
- Emergency trips
- Average response time
- Time saved
- Corridors created
- Average traffic delay
- Average speed

Charts:
- Response time
- Delay
- Queue
- Speed
- Throughput

## 23. AI Decision Trace

Timeline:

```text
14:32:01
Emergency AMB-104 detected.

14:32:02
Route calculated.

14:32:03
Traffic prediction generated.

14:32:04
I-103 predicted HIGH congestion.

14:32:05
Corridor optimization triggered.

14:32:06
7 signals scheduled.

14:32:10
Corridor recalculated.
```

## 24. Emergency Activation Flow

```text
+ NEW EMERGENCY
        ↓
Select type
        ↓
Select origin
        ↓
Select destination
        ↓
Set priority
        ↓
CREATE
        ↓
DETECTED
        ↓
ROUTING
        ↓
PREDICTING
        ↓
CORRIDOR PLANNING
        ↓
CORRIDOR ACTIVE
```

## 25. Emergency State Machine

```text
DETECTED
   ↓
ROUTING
   ↓
PREDICTING
   ↓
CORRIDOR PLANNING
   ↓
CORRIDOR ACTIVE
   ↓
RE-OPTIMIZING
   ↓
ARRIVED
```

Failure path:

```text
ERROR
 ↓
SAFE FALLBACK
 ↓
NORMAL SIGNAL CONTROL
```

## 26. Interaction Rules

Clicking a road:
- Traffic
- Speed
- Queue
- Capacity
- Prediction

Clicking a signal:
- Current phase
- Next phase
- Queue
- Emergency status

Clicking an emergency:
- Vehicle
- Route
- ETA
- Destination
- Priority
- Corridor
- AI decisions

Clicking a corridor:
- Signals
- Timeline
- Predicted arrival
- Signal schedule
- Traffic impact

## 27. Motion

Use motion to communicate:
- Vehicle movement
- Signal transitions
- Corridor movement
- State changes
- Alerts

Avoid animation that exists only for decoration.

## 28. Responsive Strategy

Desktop is the primary target because this is a command-center application.

Tablet:
- Collapsible sidebar
- Map remains dominant
- Panels become drawers

Mobile:
- Operational monitoring only
- Map + emergency state
- Detailed analytics can be secondary

## 29. Accessibility

- Do not rely only on color.
- Provide text labels for signal states.
- Maintain readable contrast.
- Support keyboard navigation for critical controls.
- Use clear emergency status labels.

## 30. UX Priority

Always prioritize:

```text
1. ACTIVE EMERGENCY
2. GREEN CORRIDOR
3. TRAFFIC CONDITIONS
4. SIGNAL STATES
5. AI DECISIONS
6. ANALYTICS
```

## 31. Design Principle

The operator should understand the state of the city within seconds.

The interface should answer:

1. Is there an emergency?
2. Where is it?
3. Where is it going?
4. What route is being used?
5. Is the green corridor active?
6. Which signals are involved?
7. What is the AI doing?
8. Is normal traffic being affected?
9. Is the system operating safely?
